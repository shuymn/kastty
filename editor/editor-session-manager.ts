import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "../protocol/messages.ts";
import type { PtyAdapter } from "../pty/adapter.ts";
import { buildEditorSpawn, type EditorEnv, resolveEditorCommand } from "./resolve.ts";

/**
 * Transport-agnostic view of the browser-side editor overlay connection. The
 * WebSocket route implements this over a `ServerWebSocket`; tests implement it
 * in-memory.
 */
export interface EditorClient {
  /** Send raw editor PTY output as a binary frame. */
  send(data: Uint8Array): void;
  /** Send a JSON control message (hello/exit/error). */
  notify(message: ServerMessage): void;
  /** Close the underlying connection. */
  close(): void;
}

export interface EditorSessionManagerOptions {
  createPty: () => PtyAdapter;
  env: EditorEnv;
  createTempFile?: (content: string) => Promise<string>;
  removeTempFile?: (path: string) => Promise<void>;
  logger?: (message: string) => void;
}

interface ActiveSession {
  client: EditorClient;
  pty: PtyAdapter | null;
  tmpFile: string | null;
  closing: boolean;
}

async function defaultCreateTempFile(content: string): Promise<string> {
  const path = join(tmpdir(), `kastty-editor-${crypto.randomUUID()}.txt`);
  // The buffer may contain secrets (tokens, command history), so create the
  // file owner-only and exclusively (`wx`) so it is never readable by other
  // local users and never reuses a pre-existing path. (`Bun.write` ignores the
  // `mode` option, so node:fs is used here.)
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
  return path;
}

async function defaultRemoveTempFile(path: string): Promise<void> {
  await unlink(path);
}

/**
 * Owns the single editor overlay PTY session, independently from the main
 * `SessionManager`. At most one session may be active at a time.
 */
export class EditorSessionManager {
  private readonly createPty: () => PtyAdapter;
  private readonly env: EditorEnv;
  private readonly createTempFile: (content: string) => Promise<string>;
  private readonly removeTempFile: (path: string) => Promise<void>;
  private readonly logger: (message: string) => void;
  private active: ActiveSession | null = null;

  constructor(options: EditorSessionManagerOptions) {
    this.createPty = options.createPty;
    this.env = options.env;
    this.createTempFile = options.createTempFile ?? defaultCreateTempFile;
    this.removeTempFile = options.removeTempFile ?? defaultRemoveTempFile;
    this.logger = options.logger ?? ((message) => console.error(message));
  }

  hasActiveSession(): boolean {
    return this.active !== null;
  }

  /**
   * Attempt to open an editor overlay for `client`, seeding the temporary file
   * with `content` (the extracted main-terminal buffer text; may be empty).
   * Rejects (via an `error` control message followed by close) when a session
   * is already active or no editor is configured.
   */
  async open(client: EditorClient, content: string): Promise<void> {
    if (this.active) {
      if (this.active.client === client) return;
      client.notify({ t: "error", message: "An editor overlay is already open" });
      client.close();
      return;
    }

    const editor = resolveEditorCommand(this.env);
    if (!editor) {
      client.notify({ t: "error", message: "No editor configured: set $VISUAL or $EDITOR" });
      client.close();
      return;
    }

    // Reserve the slot synchronously, before the first await, so a second
    // concurrent connection cannot race past the active-session guard.
    const session: ActiveSession = { client, pty: null, tmpFile: null, closing: false };
    this.active = session;

    let tmpFile: string;
    try {
      tmpFile = await this.createTempFile(content);
    } catch (error) {
      if (session.closing || this.active !== session) return;
      this.active = null;
      this.logger(`editor: failed to create temporary file: ${String(error)}`);
      client.notify({ t: "error", message: "Failed to create editor temporary file" });
      client.close();
      return;
    }
    session.tmpFile = tmpFile;

    if (session.closing || this.active !== session) {
      await this.cleanupTempFile(session);
      return;
    }

    try {
      const pty = this.createPty();
      session.pty = pty;
      const { command, args } = buildEditorSpawn(editor, tmpFile);
      pty.onData((data) => {
        session.client.send(data);
      });
      pty.onExit((code) => {
        this.handleExit(session, code);
      });
      pty.start(command, args);
    } catch (error) {
      session.pty?.destroy();
      session.pty = null;
      await this.cleanupTempFile(session);
      if (session.closing || this.active !== session) return;
      this.active = null;
      this.logger(`editor: failed to launch editor: ${String(error)}`);
      client.notify({ t: "error", message: "Failed to launch editor" });
      client.close();
      return;
    }

    if (session.closing || this.active !== session) return;
    client.notify({ t: "hello" });
  }

  write(client: EditorClient, data: string | Uint8Array): void {
    if (!this.active || this.active.client !== client) return;
    this.active.pty?.write(data);
  }

  resize(client: EditorClient, cols: number, rows: number): void {
    if (!this.active || this.active.client !== client) return;
    this.active.pty?.resize(cols, rows);
  }

  /** Called when the client connection closes; tears the session down. */
  disconnect(client: EditorClient): void {
    const session = this.active;
    if (!session || session.client !== client || session.closing) return;
    session.closing = true;
    session.pty?.destroy();
    void this.cleanupTempFile(session);
    this.active = null;
  }

  private handleExit(session: ActiveSession, code: number): void {
    if (session.closing) return;
    session.closing = true;
    session.client.notify({ t: "exit", code });
    session.client.close();
    void this.cleanupTempFile(session);
    if (this.active === session) {
      this.active = null;
    }
  }

  private async cleanupTempFile(session: ActiveSession): Promise<void> {
    const path = session.tmpFile;
    if (!path) return;
    session.tmpFile = null;
    try {
      await this.removeTempFile(path);
    } catch (error) {
      this.logger(`editor: failed to remove temporary file ${path}: ${String(error)}`);
    }
  }
}
