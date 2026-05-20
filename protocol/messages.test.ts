import { describe, expect, it } from "bun:test";
import {
  type ClientMessage,
  type ClientMessageHandlers,
  dispatchClientMessage,
  dispatchServerMessage,
  ProtocolError,
  parseClientMessage,
  parseServerMessage,
  type ServerMessage,
  type ServerMessageHandlers,
} from "./messages.ts";

describe("parseClientMessage", () => {
  describe("resize", () => {
    it("parses a valid resize message", () => {
      const msg = parseClientMessage('{"t":"resize","cols":120,"rows":40}');
      expect(msg).toEqual({ t: "resize", cols: 120, rows: 40 });
    });

    it("rejects resize with missing cols", () => {
      expect(() => parseClientMessage('{"t":"resize","rows":40}')).toThrow(ProtocolError);
    });

    it("rejects resize with missing rows", () => {
      expect(() => parseClientMessage('{"t":"resize","cols":120}')).toThrow(ProtocolError);
    });

    it("rejects resize with non-integer cols", () => {
      expect(() => parseClientMessage('{"t":"resize","cols":"wide","rows":40}')).toThrow(ProtocolError);
    });

    it("rejects resize with non-integer rows", () => {
      expect(() => parseClientMessage('{"t":"resize","cols":120,"rows":true}')).toThrow(ProtocolError);
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
      expect(() => parseClientMessage('{"t":"ping","ts":"now"}')).toThrow(ProtocolError);
    });
  });

  describe("editor-open", () => {
    it("parses a valid editor-open message", () => {
      const msg = parseClientMessage('{"t":"editor-open","content":"hello\\nworld\\n"}');
      expect(msg).toEqual({ t: "editor-open", content: "hello\nworld\n" });
    });

    it("parses editor-open with empty content", () => {
      const msg = parseClientMessage('{"t":"editor-open","content":""}');
      expect(msg).toEqual({ t: "editor-open", content: "" });
    });

    it("rejects editor-open with missing content", () => {
      expect(() => parseClientMessage('{"t":"editor-open"}')).toThrow(ProtocolError);
    });

    it("rejects editor-open with non-string content", () => {
      expect(() => parseClientMessage('{"t":"editor-open","content":42}')).toThrow(ProtocolError);
    });

    it("parses editor-open with large content (size is bounded by the transport, not the schema)", () => {
      const large = "a".repeat(2_000_000);
      const msg = parseClientMessage(JSON.stringify({ t: "editor-open", content: large }));
      expect(msg).toEqual({ t: "editor-open", content: large });
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

    it("routes ping to PingMessage", () => {
      const msg = parseClientMessage('{"t":"ping","ts":12345}');
      expect(msg.t).toBe("ping");
      if (msg.t === "ping") {
        expect(msg.ts).toBe(12345);
      }
    });

    it("routes editor-open to EditorOpenMessage", () => {
      const msg = parseClientMessage('{"t":"editor-open","content":"buffer"}');
      expect(msg.t).toBe("editor-open");
      if (msg.t === "editor-open") {
        expect(msg.content).toBe("buffer");
      }
    });
  });

  describe("invalid payloads", () => {
    it("rejects unknown message type", () => {
      expect(() => parseClientMessage('{"t":"unknown","data":1}')).toThrow(ProtocolError);
    });

    it("rejects removed readonly message type", () => {
      expect(() => parseClientMessage('{"t":"readonly","enabled":true}')).toThrow(ProtocolError);
    });

    it("rejects message with no t field", () => {
      expect(() => parseClientMessage('{"cols":120,"rows":40}')).toThrow(ProtocolError);
    });

    it("rejects invalid JSON", () => {
      expect(() => parseClientMessage("not json")).toThrow(ProtocolError);
    });

    it("rejects empty string", () => {
      expect(() => parseClientMessage("")).toThrow(ProtocolError);
    });

    it("strips unknown properties", () => {
      const msg = parseClientMessage('{"t":"resize","cols":80,"rows":24,"extra":"field"}');
      expect(msg).toEqual({ t: "resize", cols: 80, rows: 24 });
      expect((msg as Record<string, unknown>).extra).toBeUndefined();
    });
  });
});

describe("parseServerMessage", () => {
  describe("hello", () => {
    it("parses a valid hello message", () => {
      const msg = parseServerMessage('{"t":"hello"}');
      expect(msg).toEqual({ t: "hello" });
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
      expect(() => parseServerMessage('{"t":"exit","code":"zero"}')).toThrow(ProtocolError);
    });
  });

  describe("error", () => {
    it("parses a valid error message", () => {
      const msg = parseServerMessage('{"t":"error","message":"connection refused"}');
      expect(msg).toEqual({ t: "error", message: "connection refused" });
    });

    it("rejects error with missing message", () => {
      expect(() => parseServerMessage('{"t":"error"}')).toThrow(ProtocolError);
    });

    it("rejects error with non-string message", () => {
      expect(() => parseServerMessage('{"t":"error","message":42}')).toThrow(ProtocolError);
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
      expect(() => parseServerMessage('{"t":"pong","ts":"now"}')).toThrow(ProtocolError);
    });
  });

  describe("discriminator routing", () => {
    it("routes hello to HelloMessage", () => {
      const msg = parseServerMessage('{"t":"hello"}');
      expect(msg.t).toBe("hello");
    });

    it("routes exit to ExitMessage", () => {
      const msg = parseServerMessage('{"t":"exit","code":0}');
      expect(msg.t).toBe("exit");
      if (msg.t === "exit") {
        expect(msg.code).toBe(0);
      }
    });

    it("routes error to ErrorMessage", () => {
      const msg = parseServerMessage('{"t":"error","message":"fail"}');
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
      expect(() => parseServerMessage('{"t":"unknown","data":1}')).toThrow(ProtocolError);
    });

    it("rejects removed readonly message type", () => {
      expect(() => parseServerMessage('{"t":"readonly","enabled":true}')).toThrow(ProtocolError);
    });

    it("rejects message with no t field", () => {
      expect(() => parseServerMessage('{"code":0}')).toThrow(ProtocolError);
    });

    it("rejects invalid JSON", () => {
      expect(() => parseServerMessage("{bad}")).toThrow(ProtocolError);
    });

    it("rejects empty string", () => {
      expect(() => parseServerMessage("")).toThrow(ProtocolError);
    });

    it("strips unknown properties", () => {
      const msg = parseServerMessage('{"t":"exit","code":0,"extra":"field"}');
      expect(msg).toEqual({ t: "exit", code: 0 });
      expect((msg as Record<string, unknown>).extra).toBeUndefined();
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

// Build a handler map whose every entry records the message it received, so a
// test can assert exactly one handler ran (and with what payload). Exhaustive
// by construction; omitting a key would be a compile error (not runtime-testable).
function recordingClientHandlers() {
  const calls: ClientMessage[] = [];
  const handlers: ClientMessageHandlers = {
    resize: (m) => calls.push(m),
    ping: (m) => calls.push(m),
    "editor-open": (m) => calls.push(m),
  };
  return { handlers, calls };
}

function recordingServerHandlers() {
  const calls: ServerMessage[] = [];
  const handlers: ServerMessageHandlers = {
    hello: (m) => calls.push(m),
    exit: (m) => calls.push(m),
    error: (m) => calls.push(m),
    pong: (m) => calls.push(m),
  };
  return { handlers, calls };
}

describe("dispatchClientMessage", () => {
  it("routes resize to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingClientHandlers();
    dispatchClientMessage('{"t":"resize","cols":120,"rows":40}', handlers);
    expect(calls).toEqual([{ t: "resize", cols: 120, rows: 40 }]);
  });

  it("routes ping to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingClientHandlers();
    dispatchClientMessage('{"t":"ping","ts":12345}', handlers);
    expect(calls).toEqual([{ t: "ping", ts: 12345 }]);
  });

  it("routes editor-open to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingClientHandlers();
    dispatchClientMessage('{"t":"editor-open","content":"buffer\\n"}', handlers);
    expect(calls).toEqual([{ t: "editor-open", content: "buffer\n" }]);
  });

  it("passes a ProtocolError to onInvalid on malformed JSON", () => {
    const { handlers, calls } = recordingClientHandlers();
    const errors: ProtocolError[] = [];
    dispatchClientMessage("not json", handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("passes a ProtocolError to onInvalid on schema mismatch", () => {
    const { handlers, calls } = recordingClientHandlers();
    const errors: ProtocolError[] = [];
    dispatchClientMessage('{"t":"resize","cols":1}', handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("passes a ProtocolError to onInvalid on unknown message type", () => {
    const { handlers, calls } = recordingClientHandlers();
    const errors: ProtocolError[] = [];
    dispatchClientMessage('{"t":"unknown"}', handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("swallows invalid frames silently when onInvalid is omitted", () => {
    for (const raw of ["not json", '{"t":"resize","cols":1}', '{"t":"unknown"}']) {
      const { handlers, calls } = recordingClientHandlers();
      expect(() => dispatchClientMessage(raw, handlers)).not.toThrow();
      expect(calls).toEqual([]);
    }
  });

  it("propagates handler errors without calling onInvalid", () => {
    const thrown = new ProtocolError("handler failed");
    const { handlers } = recordingClientHandlers();
    const errors: ProtocolError[] = [];
    handlers.resize = () => {
      throw thrown;
    };

    expect(() =>
      dispatchClientMessage('{"t":"resize","cols":120,"rows":40}', handlers, (error) => errors.push(error)),
    ).toThrow(thrown);
    expect(errors).toEqual([]);
  });
});

describe("dispatchServerMessage", () => {
  it("routes hello to its handler", () => {
    const { handlers, calls } = recordingServerHandlers();
    dispatchServerMessage('{"t":"hello"}', handlers);
    expect(calls).toEqual([{ t: "hello" }]);
  });

  it("routes exit to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingServerHandlers();
    dispatchServerMessage('{"t":"exit","code":0}', handlers);
    expect(calls).toEqual([{ t: "exit", code: 0 }]);
  });

  it("routes error to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingServerHandlers();
    dispatchServerMessage('{"t":"error","message":"boom"}', handlers);
    expect(calls).toEqual([{ t: "error", message: "boom" }]);
  });

  it("routes pong to its handler with the parsed payload", () => {
    const { handlers, calls } = recordingServerHandlers();
    dispatchServerMessage('{"t":"pong","ts":999}', handlers);
    expect(calls).toEqual([{ t: "pong", ts: 999 }]);
  });

  it("passes a ProtocolError to onInvalid on malformed JSON", () => {
    const { handlers, calls } = recordingServerHandlers();
    const errors: ProtocolError[] = [];
    dispatchServerMessage("not json", handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("passes a ProtocolError to onInvalid on schema mismatch", () => {
    const { handlers, calls } = recordingServerHandlers();
    const errors: ProtocolError[] = [];
    dispatchServerMessage('{"t":"exit"}', handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("passes a ProtocolError to onInvalid on unknown message type", () => {
    const { handlers, calls } = recordingServerHandlers();
    const errors: ProtocolError[] = [];
    dispatchServerMessage('{"t":"unknown"}', handlers, (error) => errors.push(error));
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("swallows invalid frames silently when onInvalid is omitted", () => {
    for (const raw of ["not json", '{"t":"exit"}', '{"t":"unknown"}']) {
      const { handlers, calls } = recordingServerHandlers();
      expect(() => dispatchServerMessage(raw, handlers)).not.toThrow();
      expect(calls).toEqual([]);
    }
  });

  it("propagates handler errors without calling onInvalid", () => {
    const thrown = new Error("handler failed");
    const { handlers } = recordingServerHandlers();
    const errors: ProtocolError[] = [];
    handlers.hello = () => {
      throw thrown;
    };

    expect(() => dispatchServerMessage('{"t":"hello"}', handlers, (error) => errors.push(error))).toThrow(thrown);
    expect(errors).toEqual([]);
  });
});
