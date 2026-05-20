import type { ServerWebSocket } from "bun";
import type { EditorClient, EditorSessionManager } from "../editor/editor-session-manager.ts";
import { parseClientMessage, type ServerMessage } from "../protocol/messages.ts";
import { isValidToken, validateRequest } from "../security/middleware.ts";
import type { ClientConnection, SessionManager } from "../session/session-manager.ts";

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
}

type WsData = { kind: "main" } | { kind: "editor" };

export function createServer(options: ServerOptions) {
  const wsClients = new Map<ServerWebSocket<WsData>, ClientConnection>();
  const editorClients = new Map<ServerWebSocket<WsData>, EditorClient>();

  options.session.onExit((code) => {
    for (const ws of wsClients.keys()) {
      ws.send(JSON.stringify({ t: "exit", code } satisfies ServerMessage));
      ws.close();
    }
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

    if (url.pathname === "/ws") {
      if (!isValidToken(url, options.token)) {
        return new Response("Forbidden", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { kind: "main" } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    if (url.pathname === "/editor-ws") {
      if (!options.editor) {
        return new Response("Not Found", { status: 404 });
      }
      if (!isValidToken(url, options.token)) {
        return new Response("Forbidden", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { kind: "editor" } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  };

  const handleControlMessage = (
    ws: ServerWebSocket<WsData>,
    raw: string,
    handlers: {
      onResize: (cols: number, rows: number) => void;
      onEditorOpen?: (content: string) => void;
    },
  ): void => {
    try {
      const msg = parseClientMessage(raw);
      switch (msg.t) {
        case "resize":
          handlers.onResize(msg.cols, msg.rows);
          break;
        case "ping":
          ws.send(JSON.stringify({ t: "pong", ts: msg.ts } satisfies ServerMessage));
          break;
        case "editor-open":
          // Editor launch requests are valid only when the route supplies a handler.
          handlers.onEditorOpen?.(msg.content);
          break;
      }
    } catch {
      // invalid protocol message, ignore
    }
  };

  const registerEditorClient = (ws: ServerWebSocket<WsData>): void => {
    const editor = options.editor;
    if (!editor) {
      ws.close();
      return;
    }
    // The editor PTY is launched lazily, when the client sends `editor-open`
    // carrying the buffer text. Connecting alone only registers the client.
    const client: EditorClient = {
      send(data: Uint8Array) {
        ws.send(data);
      },
      notify(message: ServerMessage) {
        ws.send(JSON.stringify(message));
      },
      close() {
        ws.close();
      },
    };
    editorClients.set(ws, client);
  };

  const messageEditor = (ws: ServerWebSocket<WsData>, data: string | Buffer): void => {
    const editor = options.editor;
    const client = editorClients.get(ws);
    if (!editor || !client) return;
    if (typeof data !== "string") {
      editor.write(client, new Uint8Array(data));
      return;
    }
    handleControlMessage(ws, data, {
      onResize: (cols, rows) => editor.resize(client, cols, rows),
      onEditorOpen: (content) => {
        void editor.open(client, content);
      },
    });
  };

  const websocket = {
    open(ws: ServerWebSocket<WsData>) {
      if (ws.data.kind === "editor") {
        registerEditorClient(ws);
        return;
      }
      try {
        const client: ClientConnection = {
          send(data: Uint8Array) {
            ws.send(data);
          },
        };
        const replayData = options.session.connect(client);
        wsClients.set(ws, client);

        ws.send(JSON.stringify({ t: "hello" } satisfies ServerMessage));

        if (replayData.length > 0) {
          ws.send(replayData);
        }
      } catch {
        ws.close(1008, "Connection rejected");
      }
    },

    message(ws: ServerWebSocket<WsData>, data: string | Buffer) {
      if (ws.data.kind === "editor") {
        messageEditor(ws, data);
        return;
      }
      if (typeof data !== "string") {
        options.session.write(new Uint8Array(data));
      } else {
        handleControlMessage(ws, data, { onResize: (cols, rows) => options.session.resize(cols, rows) });
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.kind === "editor") {
        const client = editorClients.get(ws);
        if (client) {
          options.editor?.disconnect(client);
          editorClients.delete(ws);
        }
        return;
      }
      const client = wsClients.get(ws);
      if (!client) return;
      options.session.disconnect(client);
      wsClients.delete(ws);
    },
  };

  return { fetch, websocket };
}
