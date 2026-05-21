import { z } from "zod";

export class ProtocolError extends Error {
  override readonly name = "ProtocolError";
}

const ResizeMessageSchema = z.object({
  t: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

const PingMessageSchema = z.object({
  t: z.literal("ping"),
  ts: z.number(),
});

const EditorOpenMessageSchema = z.object({
  t: z.literal("editor-open"),
  // Buffer text size is bounded by the WebSocket transport (maxPayloadLength),
  // so the schema itself does not cap content length.
  content: z.string(),
});

const ClientMessageSchema = z.discriminatedUnion("t", [
  ResizeMessageSchema,
  PingMessageSchema,
  EditorOpenMessageSchema,
]);

const HelloMessageSchema = z.object({
  t: z.literal("hello"),
});

const ExitMessageSchema = z.object({
  t: z.literal("exit"),
  code: z.number(),
});

const ErrorMessageSchema = z.object({
  t: z.literal("error"),
  message: z.string(),
});

const PongMessageSchema = z.object({
  t: z.literal("pong"),
  ts: z.number(),
});

const ServerMessageSchema = z.discriminatedUnion("t", [
  HelloMessageSchema,
  ExitMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
]);

export type ResizeMessage = z.infer<typeof ResizeMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type EditorOpenMessage = z.infer<typeof EditorOpenMessageSchema>;

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type ExitMessage = z.infer<typeof ExitMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

function parseMessage<T>(json: string, schema: z.ZodType<T>, label: string): T {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProtocolError(`Invalid JSON: ${json}`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ProtocolError(`Invalid ${label} message: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseClientMessage(json: string): ClientMessage {
  return parseMessage(json, ClientMessageSchema, "client");
}

export function parseServerMessage(json: string): ServerMessage {
  return parseMessage(json, ServerMessageSchema, "server");
}

/**
 * Exhaustive handler map for client messages, keyed by the `t` discriminant.
 * Every message type must be handled (use an explicit no-op to ignore one);
 * adding a member to {@link ClientMessage} then fails to compile at each call
 * site until it is handled.
 */
type MessageHandlers<T extends { t: string }> = { [M in T as M["t"]]: (message: M) => void };

export type ClientMessageHandlers = MessageHandlers<ClientMessage>;

/** Exhaustive handler map for server messages. See {@link ClientMessageHandlers}. */
export type ServerMessageHandlers = MessageHandlers<ServerMessage>;

/**
 * Parse a raw client frame and route it to the matching handler. Malformed
 * frames are surfaced via `onInvalid` (when given) and otherwise swallowed; any
 * non-{@link ProtocolError} is rethrown so real bugs are not hidden.
 */
function parseForDispatch<T>(
  raw: string,
  parse: (json: string) => T,
  onInvalid?: (error: ProtocolError) => void,
): T | undefined {
  try {
    return parse(raw);
  } catch (error) {
    if (error instanceof ProtocolError) {
      onInvalid?.(error);
      return undefined;
    }
    throw error;
  }
}

export function dispatchClientMessage(
  raw: string,
  handlers: ClientMessageHandlers,
  onInvalid?: (error: ProtocolError) => void,
): void {
  const message = parseForDispatch(raw, parseClientMessage, onInvalid);
  if (!message) return;
  switch (message.t) {
    case "resize":
      handlers.resize(message);
      return;
    case "ping":
      handlers.ping(message);
      return;
    case "editor-open":
      handlers["editor-open"](message);
      return;
    default: {
      const _exhaustive: never = message;
      throw new ProtocolError(`Unhandled client message: ${(_exhaustive as { t: string }).t}`);
    }
  }
}

/**
 * Parse a raw server frame and route it to the matching handler. See
 * {@link dispatchClientMessage} for the error-handling contract.
 */
export function dispatchServerMessage(
  raw: string,
  handlers: ServerMessageHandlers,
  onInvalid?: (error: ProtocolError) => void,
): void {
  const message = parseForDispatch(raw, parseServerMessage, onInvalid);
  if (!message) return;
  switch (message.t) {
    case "hello":
      handlers.hello(message);
      return;
    case "exit":
      handlers.exit(message);
      return;
    case "error":
      handlers.error(message);
      return;
    case "pong":
      handlers.pong(message);
      return;
    default: {
      const _exhaustive: never = message;
      throw new ProtocolError(`Unhandled server message: ${(_exhaustive as { t: string }).t}`);
    }
  }
}
