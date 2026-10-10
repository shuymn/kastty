import { describe, expect, it } from "bun:test";
import { startApp } from "./app.ts";
import { ALREADY_OPEN_MESSAGE } from "./editor-overlay.ts";
import { CONNECTING_TAB_PREFIX, DISCONNECTED_TAB_PREFIX } from "./tab-title.ts";
import { attachedMessage, FakeTerminal, socketFactory } from "./testing.ts";

const EDITOR_SHORTCUT = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, code: "KeyE" };

function setup() {
  const { sockets, createSocket } = socketFactory();
  const terminals: { target: "main" | "editor"; terminal: FakeTerminal }[] = [];
  const overlayVisible: boolean[] = [];
  const toasts: string[] = [];
  const titles: string[] = [];

  const app = startApp({
    token: "secret",
    attachUrl: (sessionId) => `ws://127.0.0.1:8080/attach/${sessionId}`,
    createSocket,
    createTerminal(target, config) {
      const terminal = new FakeTerminal(config);
      terminals.push({ target, terminal });
      return terminal;
    },
    setOverlayVisible: (visible) => overlayVisible.push(visible),
    showToast: (message) => toasts.push(message),
    setTitle: (title) => titles.push(title),
  });

  const socketFor = (sessionId: string) => {
    const socket = sockets.find((candidate) => candidate.url.endsWith(`/attach/${sessionId}`));
    if (!socket) throw new Error(`no socket for ${sessionId}`);
    return socket;
  };
  const terminalFor = (target: "main" | "editor") => {
    const found = terminals.find((entry) => entry.target === target);
    if (!found) throw new Error(`no ${target} terminal`);
    return found.terminal;
  };

  const main = socketFor("main");
  main.receiveText(attachedMessage({ title: "zsh" }));
  main.receiveBinary("SNAPSHOT");

  return { app, sockets, main, socketFor, terminalFor, terminals, overlayVisible, toasts, titles };
}

describe("startApp", () => {
  it("shows the connection state and terminal title in the tab title", () => {
    const { main, titles } = setup();

    main.receiveText({ t: "title", title: "vim" });
    main.closeFromHost();

    expect(titles).toEqual([
      `${CONNECTING_TAB_PREFIX} kastty`,
      `${CONNECTING_TAB_PREFIX} zsh`,
      "zsh",
      "vim",
      `${DISCONNECTED_TAB_PREFIX} vim`,
    ]);
  });

  it("asks the main session for an editor on Ctrl+Shift+E and ignores other keys", () => {
    const { app, main } = setup();

    expect(app.handleKeydown({ ...EDITOR_SHORTCUT, shiftKey: false })).toBe(false);
    expect(app.handleKeydown({ ...EDITOR_SHORTCUT, altKey: true })).toBe(false);
    expect(app.handleKeydown(EDITOR_SHORTCUT)).toBe(true);

    expect(main.sentText).toContain('{"t":"open-editor"}');
  });

  it("shows open-editor errors from the host as a toast", () => {
    const { app, main, toasts, sockets } = setup();

    app.handleKeydown(EDITOR_SHORTCUT);
    main.receiveText({ t: "error", message: "No editor configured: set $VISUAL or $EDITOR" });

    expect(toasts).toEqual(["No editor configured: set $VISUAL or $EDITOR"]);
    expect(sockets).toHaveLength(1);
  });

  it("attaches the overlay to the editor session and returns to the main terminal when it closes", () => {
    const { app, main, socketFor, terminalFor, overlayVisible, toasts } = setup();

    app.handleKeydown(EDITOR_SHORTCUT);
    main.receiveText({ t: "editor", id: "editor-1" });
    const editor = socketFor("editor-1");
    expect(editor.protocols).toEqual(["kastty.v1", "kastty.auth.secret"]);
    expect(overlayVisible).toEqual([true]);

    editor.receiveText(attachedMessage({ id: "editor-1", kind: "editor" }));
    editor.receiveBinary("EDITOR SNAPSHOT");
    terminalFor("editor").type(":wq\r");
    terminalFor("main").type("ignored while the overlay is open");

    expect(app.handleKeydown(EDITOR_SHORTCUT)).toBe(true);
    expect(toasts).toEqual([ALREADY_OPEN_MESSAGE]);
    expect(main.sentText.filter((text) => text.includes("open-editor"))).toHaveLength(1);

    editor.receiveText({ t: "exit", code: 0 });
    editor.closeFromHost();
    terminalFor("main").type("back");

    expect(editor.sentInput).toEqual([":wq\r"]);
    expect(main.sentInput).toEqual(["back"]);
    expect(overlayVisible).toEqual([true, false]);
    expect(terminalFor("editor").disposed).toBe(true);
    expect(terminalFor("main").focused).toBe(true);
    expect(toasts).toEqual([ALREADY_OPEN_MESSAGE]);
  });

  it("reports an editor command that cannot run, even before it attached", () => {
    const { app, main, socketFor, overlayVisible, toasts } = setup();

    app.handleKeydown(EDITOR_SHORTCUT);
    main.receiveText({ t: "editor", id: "editor-1" });
    socketFor("editor-1").receiveText({ t: "exit", code: 127 });
    socketFor("editor-1").closeFromHost();

    expect(toasts).toEqual(["Editor command failed (exit 127): check $VISUAL / $EDITOR"]);
    expect(overlayVisible).toEqual([true, false]);
  });

  it("does not blame the editor for other exit codes, such as kastty ending it", () => {
    const { app, main, socketFor, toasts } = setup();

    app.handleKeydown(EDITOR_SHORTCUT);
    main.receiveText({ t: "editor", id: "editor-1" });
    socketFor("editor-1").receiveText(attachedMessage({ id: "editor-1", kind: "editor" }));
    socketFor("editor-1").receiveText({ t: "exit", code: 129 });
    socketFor("editor-1").closeFromHost();

    expect(toasts).toEqual([]);
  });

  it("closes the overlay when the editor session cannot be attached", () => {
    const { app, main, socketFor, terminals, overlayVisible } = setup();

    app.handleKeydown(EDITOR_SHORTCUT);
    main.receiveText({ t: "editor", id: "editor-1" });
    socketFor("editor-1").closeFromHost();

    expect(overlayVisible).toEqual([true, false]);
    expect(terminals.map((entry) => entry.target)).toEqual(["main"]);
    expect(app.handleKeydown(EDITOR_SHORTCUT)).toBe(true);
    expect(main.sentText.filter((text) => text.includes("open-editor"))).toHaveLength(2);
  });
});
