import type { ServerWebSocket } from "bun";
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
}

export function createServer(options: ServerOptions) {
  const wsClients = new Map<ServerWebSocket, ClientConnection>();

  options.session.onExit((code) => {
    for (const ws of wsClients.keys()) {
      ws.send(JSON.stringify({ t: "exit", code } satisfies ServerMessage));
      ws.close();
    }
  });

  const fetch = (req: Request, server: { upgrade(req: Request): boolean }): Response | undefined => {
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
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  };

  const websocket = {
    open(ws: ServerWebSocket) {
      try {
        const client: ClientConnection = {
          send(data: Uint8Array) {
            ws.send(data);
          },
        };
        const replayData = options.session.connect(client);
        wsClients.set(ws, client);

        ws.send(JSON.stringify({ t: "hello", readonly: options.session.isReadonly() } satisfies ServerMessage));

        if (replayData.length > 0) {
          ws.send(replayData);
        }
      } catch {
        ws.close(1008, "Connection rejected");
      }
    },

    message(ws: ServerWebSocket, data: string | Buffer) {
      if (typeof data !== "string") {
        options.session.write(new Uint8Array(data));
      } else {
        try {
          const msg = parseClientMessage(data);
          switch (msg.t) {
            case "resize":
              options.session.resize(msg.cols, msg.rows);
              break;
            case "readonly":
              options.session.setReadonly(msg.enabled);
              for (const peer of wsClients.keys()) {
                peer.send(JSON.stringify({ t: "readonly", enabled: msg.enabled } satisfies ServerMessage));
              }
              break;
            case "ping":
              ws.send(JSON.stringify({ t: "pong", ts: msg.ts } satisfies ServerMessage));
              break;
          }
        } catch {
          // invalid protocol message, ignore
        }
      }
    },

    close(ws: ServerWebSocket) {
      const client = wsClients.get(ws);
      if (!client) return;
      options.session.disconnect(client);
      wsClients.delete(ws);
    },
  };

  return { fetch, websocket };
}
