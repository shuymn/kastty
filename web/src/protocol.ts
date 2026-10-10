/**
 * Attach protocol (ADR 0017). Binary frames carry terminal bytes; text frames
 * carry JSON control messages discriminated by `t`. The validators mirror
 * internal/protocol and are checked against the shared fixtures in
 * internal/protocol/testdata/messages.json.
 */

export const SUBPROTOCOL = "kastty.v1";
export const AUTH_SUBPROTOCOL_PREFIX = "kastty.auth.";
export const MAX_DIMENSION = 65535;

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

export type SessionKind = "main" | "editor";

export interface Size {
  cols: number;
  rows: number;
}

export interface ViewConfig {
  fontFamily: string;
  /** Scrollback in lines (`--scrollback`). */
  scrollback: number;
}

export type HostMessage =
  | { t: "attached"; session: { id: string; kind: SessionKind }; size: Size; title: string; view: ViewConfig }
  | { t: "snapshot" }
  | { t: "size"; cols: number; rows: number }
  | { t: "title"; title: string }
  | { t: "editor"; id: string }
  | { t: "error"; message: string }
  | { t: "exit"; code: number };

export type ViewMessage = { t: "resize"; cols: number; rows: number } | { t: "open-editor" };

export class ProtocolError extends Error {
  override name = "ProtocolError";
}

type Fields = Record<string, unknown>;

function object(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${path} must be an object`);
  }
  return value as Fields;
}

function string(fields: Fields, key: string, path = key): string {
  const value = fields[key];
  if (typeof value !== "string") throw new ProtocolError(`${path} must be a string`);
  return value;
}

function integer(fields: Fields, key: string, min: number, max: number, path = key): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ProtocolError(`${path} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function size(fields: Fields, path = ""): Size {
  return {
    cols: integer(fields, "cols", 1, MAX_DIMENSION, `${path}cols`),
    rows: integer(fields, "rows", 1, MAX_DIMENSION, `${path}rows`),
  };
}

/**
 * Parse a host-to-view text frame. Unknown `t` values and mistyped fields
 * throw {@link ProtocolError} instead of being ignored; unknown extra fields
 * are dropped, as the Go decoder does.
 */
export function parseHostMessage(raw: string): HostMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolError("not JSON");
  }
  const fields = object(value, "message");
  const t = string(fields, "t");

  switch (t) {
    case "attached": {
      const session = object(fields.session, "session");
      const kind = string(session, "kind", "session.kind");
      if (kind !== "main" && kind !== "editor") throw new ProtocolError(`unknown session kind "${kind}"`);
      const view = object(fields.view, "view");
      return {
        t,
        session: { id: string(session, "id", "session.id"), kind },
        size: size(object(fields.size, "size"), "size."),
        title: string(fields, "title"),
        view: {
          fontFamily: string(view, "fontFamily", "view.fontFamily"),
          scrollback: integer(view, "scrollback", 0, INT32_MAX, "view.scrollback"),
        },
      };
    }
    case "snapshot":
      return { t };
    case "size":
      return { t, ...size(fields) };
    case "title":
      return { t, title: string(fields, "title") };
    case "editor":
      return { t, id: string(fields, "id") };
    case "error":
      return { t, message: string(fields, "message") };
    case "exit":
      return { t, code: integer(fields, "code", INT32_MIN, INT32_MAX) };
  }
  throw new ProtocolError(`unknown host message "${t}"`);
}

/** Encode a view-to-host text frame with the canonical key order. */
export function encodeViewMessage(message: ViewMessage): string {
  switch (message.t) {
    case "resize":
      return JSON.stringify({ t: message.t, cols: message.cols, rows: message.rows });
    case "open-editor":
      return JSON.stringify({ t: message.t });
  }
}
