import { describe, expect, it } from "bun:test";
import {
  AttachClient,
  type AttachClientOptions,
  type ConnectionState,
  MAX_INPUT_FRAME_BYTES,
  splitInput,
} from "./attach-client.ts";
import { attachedMessage, FakeTerminal, socketFactory } from "./testing.ts";

function setup(options: Partial<AttachClientOptions> = {}) {
  const { sockets, createSocket } = socketFactory();
  const log: string[] = [];
  const terminals: FakeTerminal[] = [];
  const states: ConnectionState[] = [];
  const titles: string[] = [];
  const errors: string[] = [];
  const editors: string[] = [];

  const client = new AttachClient({
    url: "ws://127.0.0.1:8080/attach/main",
    token: "secret",
    createSocket,
    createTerminal(config) {
      const terminal = new FakeTerminal(config, log);
      terminals.push(terminal);
      return terminal;
    },
    onStateChange: (state) => states.push(state),
    onTitle: (title) => titles.push(title),
    onError: (message) => errors.push(message),
    onEditor: (id) => editors.push(id),
    ...options,
  });
  client.connect();
  const socket = sockets[0];
  if (!socket) throw new Error("no socket created");

  const terminal = () => {
    const created = terminals[0];
    if (!created) throw new Error("no terminal created");
    return created;
  };
  const attach = () => {
    socket.receiveText(attachedMessage());
    socket.receiveBinary("SNAPSHOT");
  };

  return { client, sockets, socket, log, terminals, terminal, attach, states, titles, errors, editors };
}

describe("AttachClient", () => {
  it("attaches with the protocol and auth subprotocols over binary frames", () => {
    const { socket, states } = setup();

    expect(socket.url).toBe("ws://127.0.0.1:8080/attach/main");
    expect(socket.protocols).toEqual(["kastty.v1", "kastty.auth.secret"]);
    expect(socket.binaryType).toBe("arraybuffer");
    expect(states).toEqual(["connecting"]);
  });

  it("creates the terminal at the host size with the view config, then writes the snapshot", () => {
    const { socket, log, terminal, states, titles } = setup();

    socket.receiveText(attachedMessage({ title: "vim" }));
    socket.receiveBinary("SNAPSHOT");
    socket.receiveBinary("live");

    expect(terminal().config).toEqual({ cols: 80, rows: 24, fontFamily: "", scrollback: 50000 });
    expect(log).toEqual(["create 80x24", "write SNAPSHOT", "write live"]);
    expect(states).toEqual(["connecting", "connected"]);
    expect(titles).toEqual(["vim"]);
  });

  it("drops terminal replies emitted during write but sends typed input as UTF-8", () => {
    const { socket, terminal, attach } = setup();
    attach();

    socket.receiveBinary("\x1b[6n");
    terminal().type("ls 日本語\r");

    expect(socket.sentInput).toEqual(["ls 日本語\r"]);
  });

  it("splits input larger than the host's message limit into frames sent in order", () => {
    const { socket, terminal, attach } = setup();
    attach();

    const paste = "x".repeat(MAX_INPUT_FRAME_BYTES * 2 + 5);
    terminal().type(paste);

    expect(socket.sentInput.map((frame) => frame.length)).toEqual([MAX_INPUT_FRAME_BYTES, MAX_INPUT_FRAME_BYTES, 5]);
    expect(socket.sentInput.join("")).toBe(paste);
  });

  it("splits input only between UTF-8 characters", () => {
    const bytes = new TextEncoder().encode("ab日本語x");
    const frames = splitInput(bytes, 4);
    const decoder = new TextDecoder("utf-8", { fatal: true });

    expect(frames.map((frame) => decoder.decode(frame))).toEqual(["ab", "日", "本", "語x"]);
  });

  it("does not send input while canSendInput is false", () => {
    let allowed = false;
    const { socket, terminal, attach } = setup({ canSendInput: () => allowed });
    attach();

    terminal().type("muted");
    allowed = true;
    terminal().type("sent");

    expect(socket.sentInput).toEqual(["sent"]);
  });

  it("follows host size changes without applying its own container size", () => {
    const { socket, log, terminal, attach } = setup();
    attach();

    terminal().containerResized({ cols: 50, rows: 10 });
    socket.receiveText({ t: "size", cols: 120, rows: 40 });

    expect(log).toEqual(["create 80x24", "write SNAPSHOT", "resize 120x40"]);
  });

  it("reports the container size on attach and only when the proposal changes", () => {
    const { socket, terminal, attach } = setup();
    attach();

    expect(socket.sentText).toEqual(['{"t":"resize","cols":100,"rows":30}']);

    terminal().containerResized({ cols: 100, rows: 30 });
    terminal().containerResized(undefined);
    terminal().containerResized({ cols: 90, rows: 30 });
    terminal().containerResized({ cols: 90, rows: 30 });

    expect(socket.sentText).toEqual(['{"t":"resize","cols":100,"rows":30}', '{"t":"resize","cols":90,"rows":30}']);
  });

  it("resets the terminal on snapshot and writes the following frame into it", () => {
    const { socket, log, attach } = setup();
    attach();

    socket.receiveText({ t: "snapshot" });
    socket.receiveBinary("RESYNC");

    expect(log).toEqual(["create 80x24", "write SNAPSHOT", "reset", "write RESYNC"]);
  });

  it("reports title, editor, and error messages", () => {
    const { socket, attach, titles, editors, errors } = setup();
    attach();

    socket.receiveText({ t: "title", title: "htop" });
    socket.receiveText({ t: "editor", id: "editor-1" });
    socket.receiveText({ t: "error", message: "No editor configured: set $VISUAL or $EDITOR" });

    expect(titles).toEqual(["zsh", "htop"]);
    expect(editors).toEqual(["editor-1"]);
    expect(errors).toEqual(["No editor configured: set $VISUAL or $EDITOR"]);
  });

  it("sends open-editor only once attached", () => {
    const { client, socket, attach } = setup();

    client.requestEditor();
    attach();
    client.requestEditor();

    expect(socket.sentText.filter((text) => text.includes("open-editor"))).toEqual(['{"t":"open-editor"}']);
  });

  it.each([
    ["an unknown message", '{"t":"hello"}'],
    ["a mistyped message", '{"t":"size","cols":"80","rows":24}'],
    ["terminal data before attached", null],
  ])("treats %s as a protocol error and drops the connection", (_name, frame) => {
    const { socket, errors, terminals } = setup();

    if (frame) {
      socket.receiveText(frame);
    } else {
      socket.receiveBinary("early");
    }
    socket.receiveText(attachedMessage());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("Protocol error: ");
    expect(socket.closeRequested).toBe(true);
    expect(terminals).toHaveLength(0);
  });

  it("shows the disconnected state on close and does not reconnect", () => {
    const { client, socket, sockets, terminal, attach, states } = setup();
    attach();

    socket.receiveText({ t: "exit", code: 0 });
    socket.closeFromHost();
    client.connect();
    terminal().type("after close");

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
    expect(sockets).toHaveLength(1);
    expect(socket.sentInput).toEqual([]);
    expect(terminal().disposed).toBe(false);
  });

  it("reports a socket that cannot be created and stays disconnected", () => {
    const errors: string[] = [];
    const states: ConnectionState[] = [];
    const client = new AttachClient({
      url: "ws://127.0.0.1:8080/attach/main",
      token: "bad token",
      createSocket: () => {
        throw new SyntaxError("invalid subprotocol");
      },
      createTerminal: (config) => new FakeTerminal(config),
      onStateChange: (state) => states.push(state),
      onError: (message) => errors.push(message),
    });

    client.connect();

    expect(states).toEqual(["connecting", "disconnected"]);
    expect(errors).toEqual(["Failed to connect: SyntaxError: invalid subprotocol"]);
  });
});
