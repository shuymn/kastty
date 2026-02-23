import { z } from "zod";

export class ProtocolError extends Error {
  override readonly name = "ProtocolError";
}

const ResizeMessageSchema = z.object({
  t: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

const ReadonlyMessageSchema = z.object({
  t: z.literal("readonly"),
  enabled: z.boolean(),
});

const PingMessageSchema = z.object({
  t: z.literal("ping"),
  ts: z.number(),
});

const ClientMessageSchema = z.discriminatedUnion("t", [ResizeMessageSchema, ReadonlyMessageSchema, PingMessageSchema]);

const HelloMessageSchema = z.object({
  t: z.literal("hello"),
  readonly: z.boolean(),
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
export type ReadonlyMessage = z.infer<typeof ReadonlyMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;

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
