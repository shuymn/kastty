import type { ServerWebSocket } from "bun";
import { parseClientMessage } from "../protocol/messages.ts";
import { isValidToken, validateRequest } from "../security/middleware.ts";
import type { ClientConnection, SessionManager } from "../session/session-manager.ts";

export interface ServerOptions {
  session: SessionManager;
  token: string;
  port: number;
  wasmBuffer?: ArrayBuffer;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export function createServer(options: ServerOptions) {
  let currentWs: ServerWebSocket | null = null;

  options.session.onExit((code) => {
    if (currentWs) {
      currentWs.send(JSON.stringify({ t: "exit", code }));
      currentWs.close();
      currentWs = null;
    }
  });

  const fetch = (req: Request, server: { upgrade(req: Request): boolean }): Response | undefined => {
    const forbidden = validateRequest(req, options.port);
    if (forbidden) return forbidden;

    const url = new URL(req.url);

    if (url.pathname === "/ghostty-vt.wasm" && options.wasmBuffer) {
      return new Response(options.wasmBuffer, {
        headers: { "Content-Type": "application/wasm" },
      });
    }

    if (url.pathname === "/ws") {
      if (!isValidToken(req, options.token)) {
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
            ws.send(toArrayBuffer(data));
          },
        };
        const replayData = options.session.connect(client);
        currentWs = ws;

        ws.send(JSON.stringify({ t: "hello", readonly: options.session.isReadonly() }));

        if (replayData.length > 0) {
          ws.send(toArrayBuffer(replayData));
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
              break;
            case "ping":
              ws.send(JSON.stringify({ t: "pong", ts: msg.ts }));
              break;
          }
        } catch {
          // invalid protocol message, ignore
        }
      }
    },

    close() {
      options.session.disconnect();
      currentWs = null;
    },
  };

  return { fetch, websocket };
}
