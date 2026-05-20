import type { ServerWebSocket } from "bun";
import type { EditorClient, EditorSessionManager } from "../editor/editor-session-manager.ts";
import { dispatchClientMessage, type PingMessage, type ServerMessage } from "../protocol/messages.ts";
import { isValidToken, validateRequest } from "../security/middleware.ts";
import type { ClientConnection, SessionManager } from "../session/session-manager.ts";

/**
 * Maximum size of a single inbound WebSocket frame. This is the size guard for
 * `editor-open` payloads (the full normal buffer can be large), so the protocol
 * schema itself leaves `content` unbounded and relies on this transport limit.
 *
 * Bun applies one limit per handler, and `createServer()` serves both `/ws` and
 * `/editor-ws` from a single handler, so this is shared by both routes. 32 MiB
 * covers realistic editor snapshots — a few MiB at the default scrollback, and
 * still ample for `--scrollback 200000` — including JSON/UTF-8 serialization
 * overhead, while keeping the main terminal channel bounded.
 */
export const MAX_WS_PAYLOAD_BYTES = 32 * 1024 * 1024;

export interface StaticAsset {
  body: string | ArrayBuffer;
  contentType: string;
  cacheControl?: string;
}

export interface ServerOptions {
  session: SessionManager;
  token: string;
  port: number;
  assets?: Map<string, StaticAsset>;
  editor?: EditorSessionManager;
  /**
   * Maximum inbound WebSocket frame size, applied to the returned `websocket`
   * handler so every `Bun.serve()` caller enforces the same limit. Defaults to
   * {@link MAX_WS_PAYLOAD_BYTES}. Shared by `/ws` and `/editor-ws` (Bun applies
   * one limit per handler).
   */
  maxPayloadLength?: number;
}

/**
 * One end of a WebSocket route (`/ws` or `/editor-ws`). Each channel owns its
 * own client registry and translates raw frames into manager calls, so the
 * top-level handlers route by `ws.data.channel` instead of branching on a kind
 * discriminant. The resolved channel is stored on `ws.data` at upgrade time.
 */
interface Channel {
  open(ws: ServerWebSocket<WsData>): void;
  message(ws: ServerWebSocket<WsData>, data: string | Buffer): void;
  close(ws: ServerWebSocket<WsData>): void;
  /** Notify (optionally) and close every connection on this channel. */
  closeAll(message?: ServerMessage): void;
}

interface WsData {
  channel: Channel;
}

function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

function sendServerMessage(ws: ServerWebSocket<WsData>, message: ServerMessage): void {
  ws.send(serializeServerMessage(message));
}

function sendPong(ws: ServerWebSocket<WsData>, message: PingMessage): void {
  sendServerMessage(ws, { t: "pong", ts: message.ts });
}

/**
 * Close every socket, optionally sending one final control message first. Does
 * not mutate any registry — the `close` handler owns deletion (and the editor
 * teardown), so closing here and removing there keeps teardown exactly-once.
 */
function closeAllSockets(sockets: Iterable<ServerWebSocket<WsData>>, message?: ServerMessage): void {
  const serializedMessage = message ? serializeServerMessage(message) : undefined;
  for (const ws of sockets) {
    if (serializedMessage) ws.send(serializedMessage);
    ws.close();
  }
}

function createMainChannel(session: SessionManager): Channel {
  const clients = new Map<ServerWebSocket<WsData>, ClientConnection>();
  return {
    open(ws) {
      try {
        const client: ClientConnection = {
          send(data: Uint8Array) {
            ws.send(data);
          },
        };
        const replayData = session.connect(client);
        clients.set(ws, client);

        sendServerMessage(ws, { t: "hello" });

        if (replayData.length > 0) {
          ws.send(replayData);
        }
      } catch {
        ws.close(1008, "Connection rejected");
      }
    },
    message(ws, data) {
      if (typeof data !== "string") {
        session.write(new Uint8Array(data));
        return;
      }
      // No onInvalid: malformed control frames on the main channel are
      // swallowed silently (unchanged behavior).
      dispatchClientMessage(data, {
        resize: (m) => session.resize(m.cols, m.rows),
        ping: (m) => sendPong(ws, m),
        "editor-open": () => {}, // ignored on the main terminal channel
      });
    },
    close(ws) {
      const client = clients.get(ws);
      if (!client) return;
      session.disconnect(client);
      clients.delete(ws);
    },
    closeAll(message) {
      closeAllSockets(clients.keys(), message);
    },
  };
}

function createEditorChannel(editor: EditorSessionManager): Channel {
  const clients = new Map<ServerWebSocket<WsData>, EditorClient>();
  return {
    open(ws) {
      // The editor PTY is launched lazily, when the client sends `editor-open`
      // carrying the buffer text. Connecting alone only registers the client.
      const client: EditorClient = {
        send(data: Uint8Array) {
          ws.send(data);
        },
        notify(message: ServerMessage) {
          sendServerMessage(ws, message);
        },
        close() {
          ws.close();
        },
      };
      clients.set(ws, client);
    },
    message(ws, data) {
      const client = clients.get(ws);
      if (!client) return;
      if (typeof data !== "string") {
        editor.write(client, new Uint8Array(data));
        return;
      }
      dispatchClientMessage(
        data,
        {
          resize: (m) => editor.resize(client, m.cols, m.rows),
          ping: (m) => sendPong(ws, m),
          "editor-open": (m) => {
            void editor.open(client, m.content);
          },
        },
        // A malformed editor control payload (e.g. a type mismatch) would
        // otherwise be dropped silently, leaving the overlay stuck connecting.
        () => {
          client.notify({ t: "error", message: "Invalid editor request" });
          client.close();
        },
      );
    },
    close(ws) {
      const client = clients.get(ws);
      if (!client) return;
      editor.disconnect(client);
      clients.delete(ws);
    },
    closeAll(message) {
      closeAllSockets(clients.keys(), message);
    },
  };
}

export function createServer(options: ServerOptions) {
  const mainChannel = createMainChannel(options.session);
  const editorChannel = options.editor ? createEditorChannel(options.editor) : undefined;

  const channelFor = (pathname: string): Channel | undefined => {
    if (pathname === "/ws") return mainChannel;
    if (pathname === "/editor-ws") return editorChannel; // undefined when no editor
    return undefined;
  };

  options.session.onExit((code) => {
    mainChannel.closeAll({ t: "exit", code });
    // Tear down any open editor overlay too: otherwise its PTY and temp file
    // stay alive waiting on a client disconnect that may never come. Closing is
    // enough — the `close` handler runs `disconnect()` and removes the entry, so
    // teardown happens exactly once (mirroring the main-client path above).
    editorChannel?.closeAll();
  });

  const fetch = (
    req: Request,
    server: { upgrade(req: Request, options?: { data: WsData }): boolean },
  ): Response | undefined => {
    const forbidden = validateRequest(req, options.port);
    if (forbidden) return forbidden;

    const url = new URL(req.url);

    const asset = options.assets?.get(url.pathname);
    if (asset) {
      const headers: Record<string, string> = { "Content-Type": asset.contentType };
      if (asset.cacheControl) headers["Cache-Control"] = asset.cacheControl;
      return new Response(asset.body, { headers });
    }

    const channel = channelFor(url.pathname);
    if (!channel) return new Response("Not Found", { status: 404 });

    if (!isValidToken(url, options.token)) {
      return new Response("Forbidden", { status: 403 });
    }
    const upgraded = server.upgrade(req, { data: { channel } });
    if (upgraded) return undefined;
    return new Response("WebSocket upgrade failed", { status: 500 });
  };

  const websocket = {
    open: (ws: ServerWebSocket<WsData>) => ws.data.channel.open(ws),
    message: (ws: ServerWebSocket<WsData>, data: string | Buffer) => ws.data.channel.message(ws, data),
    close: (ws: ServerWebSocket<WsData>) => ws.data.channel.close(ws),

    // Carried on the handler so every Bun.serve() caller (prod and tests)
    // enforces the same inbound frame limit without threading it separately.
    maxPayloadLength: options.maxPayloadLength ?? MAX_WS_PAYLOAD_BYTES,
  };

  return { fetch, websocket };
}
