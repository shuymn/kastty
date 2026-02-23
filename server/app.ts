import { Hono } from "hono";
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { parseClientMessage } from "../protocol/messages.ts";
import { hostValidation, originValidation, tokenValidation } from "../security/middleware.ts";
import type { ClientConnection, SessionManager } from "../session/session-manager.ts";

export interface ServerOptions {
  session: SessionManager;
  token: string;
  port: number;
  staticDir: string;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export function createApp(options: ServerOptions) {
  const app = new Hono();

  app.use(hostValidation(options.port));
  app.use(originValidation(options.port));
  app.use("/", tokenValidation(options.token));
  app.use("/ws", tokenValidation(options.token));

  let currentWs: WSContext | null = null;

  options.session.onExit((code) => {
    if (currentWs) {
      currentWs.send(JSON.stringify({ t: "exit", code }));
      currentWs.close();
      currentWs = null;
    }
  });

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
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

      onMessage(evt, ws) {
        const { data } = evt;
        if (data instanceof ArrayBuffer) {
          options.session.write(new Uint8Array(data));
        } else if (typeof data === "string") {
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

      onClose() {
        options.session.disconnect();
        currentWs = null;
      },
    })),
  );

  app.get("/*", serveStatic({ root: options.staticDir }));

  return { app, websocket };
}
