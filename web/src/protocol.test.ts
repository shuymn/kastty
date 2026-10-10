import { describe, expect, it } from "bun:test";
import { encodeViewMessage, type HostMessage, ProtocolError, parseHostMessage, type ViewMessage } from "./protocol.ts";

interface Fixtures {
  hostToView: { valid: { raw: string; message: HostMessage }[]; invalid: string[] };
  viewToHost: { valid: { raw: string; message: ViewMessage }[]; invalid: string[] };
}

// Shared with the Go decoder so both ends agree on the wire format.
const fixtures: Fixtures = await Bun.file(
  new URL("../../internal/protocol/testdata/messages.json", import.meta.url),
).json();

describe("parseHostMessage", () => {
  it.each(fixtures.hostToView.valid.map((fixture) => [fixture.raw, fixture.message] as const))(
    "decodes %s",
    (raw, message) => {
      expect(parseHostMessage(raw)).toEqual(message);
    },
  );

  it.each(fixtures.hostToView.invalid.map((raw) => [raw]))("rejects %p", (raw) => {
    expect(() => parseHostMessage(raw)).toThrow(ProtocolError);
  });

  it("drops unknown extra fields like the Go decoder", () => {
    expect(parseHostMessage('{"t":"title","title":"x","extra":1}')).toEqual({ t: "title", title: "x" });
  });
});

describe("encodeViewMessage", () => {
  it.each(fixtures.viewToHost.valid.map((fixture) => [fixture.raw, fixture.message] as const))(
    "encodes %s",
    (raw, message) => {
      expect(encodeViewMessage(message)).toBe(raw);
    },
  );

  it("emits canonical key order regardless of the input object", () => {
    expect(encodeViewMessage({ rows: 24, cols: 80, t: "resize" } as ViewMessage)).toBe(
      '{"t":"resize","cols":80,"rows":24}',
    );
  });
});
