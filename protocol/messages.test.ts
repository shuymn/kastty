import { describe, expect, it } from "bun:test";
import {
  parseClientMessage,
  parseServerMessage,
  ProtocolError,
  type ClientMessage,
  type ServerMessage,
} from "./messages.ts";

describe("parseClientMessage", () => {
  describe("resize", () => {
    it("parses a valid resize message", () => {
      const msg = parseClientMessage('{"t":"resize","cols":120,"rows":40}');
      expect(msg).toEqual({ t: "resize", cols: 120, rows: 40 });
    });

    it("rejects resize with missing cols", () => {
      expect(() =>
        parseClientMessage('{"t":"resize","rows":40}')
      ).toThrow(ProtocolError);
    });

    it("rejects resize with missing rows", () => {
      expect(() =>
        parseClientMessage('{"t":"resize","cols":120}')
      ).toThrow(ProtocolError);
    });

    it("rejects resize with non-integer cols", () => {
      expect(() =>
        parseClientMessage('{"t":"resize","cols":"wide","rows":40}')
      ).toThrow(ProtocolError);
    });

    it("rejects resize with non-integer rows", () => {
      expect(() =>
        parseClientMessage('{"t":"resize","cols":120,"rows":true}')
      ).toThrow(ProtocolError);
    });
  });

  describe("readonly", () => {
    it("parses a valid readonly message (enabled)", () => {
      const msg = parseClientMessage('{"t":"readonly","enabled":true}');
      expect(msg).toEqual({ t: "readonly", enabled: true });
    });

    it("parses a valid readonly message (disabled)", () => {
      const msg = parseClientMessage('{"t":"readonly","enabled":false}');
      expect(msg).toEqual({ t: "readonly", enabled: false });
    });

    it("rejects readonly with missing enabled", () => {
      expect(() =>
        parseClientMessage('{"t":"readonly"}')
      ).toThrow(ProtocolError);
    });

    it("rejects readonly with non-boolean enabled", () => {
      expect(() =>
        parseClientMessage('{"t":"readonly","enabled":"yes"}')
      ).toThrow(ProtocolError);
    });
  });

  describe("ping", () => {
    it("parses a valid ping message", () => {
      const msg = parseClientMessage('{"t":"ping","ts":1700000000}');
      expect(msg).toEqual({ t: "ping", ts: 1700000000 });
    });

    it("rejects ping with missing ts", () => {
      expect(() => parseClientMessage('{"t":"ping"}')).toThrow(ProtocolError);
    });

    it("rejects ping with non-number ts", () => {
      expect(() =>
        parseClientMessage('{"t":"ping","ts":"now"}')
      ).toThrow(ProtocolError);
    });
  });

  describe("discriminator routing", () => {
    it("routes resize to ResizeMessage", () => {
      const msg = parseClientMessage('{"t":"resize","cols":80,"rows":24}');
      expect(msg.t).toBe("resize");
      if (msg.t === "resize") {
        expect(msg.cols).toBe(80);
        expect(msg.rows).toBe(24);
      }
    });

    it("routes readonly to ReadonlyMessage", () => {
      const msg = parseClientMessage('{"t":"readonly","enabled":true}');
      expect(msg.t).toBe("readonly");
      if (msg.t === "readonly") {
        expect(msg.enabled).toBe(true);
      }
    });

    it("routes ping to PingMessage", () => {
      const msg = parseClientMessage('{"t":"ping","ts":12345}');
      expect(msg.t).toBe("ping");
      if (msg.t === "ping") {
        expect(msg.ts).toBe(12345);
      }
    });
  });

  describe("invalid payloads", () => {
    it("rejects unknown message type", () => {
      expect(() =>
        parseClientMessage('{"t":"unknown","data":1}')
      ).toThrow(ProtocolError);
    });

    it("rejects message with no t field", () => {
      expect(() =>
        parseClientMessage('{"cols":120,"rows":40}')
      ).toThrow(ProtocolError);
    });

    it("rejects invalid JSON", () => {
      expect(() => parseClientMessage("not json")).toThrow(ProtocolError);
    });

    it("rejects empty string", () => {
      expect(() => parseClientMessage("")).toThrow(ProtocolError);
    });

    it("strips unknown properties", () => {
      const msg = parseClientMessage(
        '{"t":"resize","cols":80,"rows":24,"extra":"field"}'
      );
      expect(msg).toEqual({ t: "resize", cols: 80, rows: 24 });
      expect((msg as Record<string, unknown>)["extra"]).toBeUndefined();
    });
  });
});

describe("parseServerMessage", () => {
  describe("hello", () => {
    it("parses a valid hello message", () => {
      const msg = parseServerMessage('{"t":"hello","readonly":false}');
      expect(msg).toEqual({ t: "hello", readonly: false });
    });

    it("parses hello with readonly true", () => {
      const msg = parseServerMessage('{"t":"hello","readonly":true}');
      expect(msg).toEqual({ t: "hello", readonly: true });
    });

    it("rejects hello with missing readonly", () => {
      expect(() => parseServerMessage('{"t":"hello"}')).toThrow(ProtocolError);
    });
  });

  describe("exit", () => {
    it("parses a valid exit message", () => {
      const msg = parseServerMessage('{"t":"exit","code":0}');
      expect(msg).toEqual({ t: "exit", code: 0 });
    });

    it("parses exit with non-zero code", () => {
      const msg = parseServerMessage('{"t":"exit","code":1}');
      expect(msg).toEqual({ t: "exit", code: 1 });
    });

    it("rejects exit with missing code", () => {
      expect(() => parseServerMessage('{"t":"exit"}')).toThrow(ProtocolError);
    });

    it("rejects exit with non-number code", () => {
      expect(() =>
        parseServerMessage('{"t":"exit","code":"zero"}')
      ).toThrow(ProtocolError);
    });
  });

  describe("error", () => {
    it("parses a valid error message", () => {
      const msg = parseServerMessage(
        '{"t":"error","message":"connection refused"}'
      );
      expect(msg).toEqual({ t: "error", message: "connection refused" });
    });

    it("rejects error with missing message", () => {
      expect(() => parseServerMessage('{"t":"error"}')).toThrow(ProtocolError);
    });

    it("rejects error with non-string message", () => {
      expect(() =>
        parseServerMessage('{"t":"error","message":42}')
      ).toThrow(ProtocolError);
    });
  });

  describe("pong", () => {
    it("parses a valid pong message", () => {
      const msg = parseServerMessage('{"t":"pong","ts":1700000000}');
      expect(msg).toEqual({ t: "pong", ts: 1700000000 });
    });

    it("rejects pong with missing ts", () => {
      expect(() => parseServerMessage('{"t":"pong"}')).toThrow(ProtocolError);
    });

    it("rejects pong with non-number ts", () => {
      expect(() =>
        parseServerMessage('{"t":"pong","ts":"now"}')
      ).toThrow(ProtocolError);
    });
  });

  describe("discriminator routing", () => {
    it("routes hello to HelloMessage", () => {
      const msg = parseServerMessage('{"t":"hello","readonly":false}');
      expect(msg.t).toBe("hello");
      if (msg.t === "hello") {
        expect(msg.readonly).toBe(false);
      }
    });

    it("routes exit to ExitMessage", () => {
      const msg = parseServerMessage('{"t":"exit","code":0}');
      expect(msg.t).toBe("exit");
      if (msg.t === "exit") {
        expect(msg.code).toBe(0);
      }
    });

    it("routes error to ErrorMessage", () => {
      const msg = parseServerMessage(
        '{"t":"error","message":"fail"}'
      );
      expect(msg.t).toBe("error");
      if (msg.t === "error") {
        expect(msg.message).toBe("fail");
      }
    });

    it("routes pong to PongMessage", () => {
      const msg = parseServerMessage('{"t":"pong","ts":99}');
      expect(msg.t).toBe("pong");
      if (msg.t === "pong") {
        expect(msg.ts).toBe(99);
      }
    });
  });

  describe("invalid payloads", () => {
    it("rejects unknown message type", () => {
      expect(() =>
        parseServerMessage('{"t":"unknown","data":1}')
      ).toThrow(ProtocolError);
    });

    it("rejects message with no t field", () => {
      expect(() =>
        parseServerMessage('{"code":0}')
      ).toThrow(ProtocolError);
    });

    it("rejects invalid JSON", () => {
      expect(() => parseServerMessage("{bad}")).toThrow(ProtocolError);
    });

    it("rejects empty string", () => {
      expect(() => parseServerMessage("")).toThrow(ProtocolError);
    });

    it("strips unknown properties", () => {
      const msg = parseServerMessage(
        '{"t":"exit","code":0,"extra":"field"}'
      );
      expect(msg).toEqual({ t: "exit", code: 0 });
      expect((msg as Record<string, unknown>)["extra"]).toBeUndefined();
    });
  });
});

describe("ProtocolError", () => {
  it("is an instance of Error", () => {
    const err = new ProtocolError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProtocolError);
  });

  it("has a message", () => {
    const err = new ProtocolError("invalid message");
    expect(err.message).toBe("invalid message");
  });

  it("has the name ProtocolError", () => {
    const err = new ProtocolError("test");
    expect(err.name).toBe("ProtocolError");
  });
});
