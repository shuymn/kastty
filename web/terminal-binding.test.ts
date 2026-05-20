import { describe, expect, it, mock } from "bun:test";
import type { GhosttyTerminalAddon } from "./ghostty-adapter.ts";
import type { ConnectionState } from "./terminal.ts";
import {
  type BindableClient,
  type BindableFitAddon,
  bindClientToTerminal,
  type TerminalAdapter,
} from "./terminal-binding.ts";

function makeAdapter() {
  let dataCallback: ((data: string) => void) | null = null;
  let resizeCallback: ((cols: number, rows: number) => void) | null = null;
  const dataDispose = mock(() => {});
  const resizeDispose = mock(() => {});
  const focus = mock(() => {});
  const loadAddon = mock((_addon: GhosttyTerminalAddon) => {});
  const adapter: TerminalAdapter = {
    onData(callback) {
      dataCallback = callback;
      return { dispose: dataDispose };
    },
    onResize(callback) {
      resizeCallback = callback;
      return { dispose: resizeDispose };
    },
    loadAddon,
    focus,
  };
  return {
    adapter,
    focus,
    loadAddon,
    dataDispose,
    resizeDispose,
    fireData(data: string) {
      dataCallback?.(data);
    },
    fireResize(cols: number, rows: number) {
      resizeCallback?.(cols, rows);
    },
  };
}

function makeClient() {
  const stateCallbacks: Array<(state: ConnectionState) => void> = [];
  const sentInputs: Uint8Array[] = [];
  const sentResizes: Array<{ cols: number; rows: number }> = [];
  const client: BindableClient = {
    sendInput(data) {
      sentInputs.push(data instanceof Uint8Array ? data : new Uint8Array(data));
    },
    sendResize(cols, rows) {
      sentResizes.push({ cols, rows });
    },
    onStateChange(callback) {
      stateCallbacks.push(callback);
    },
  };
  return {
    client,
    sentInputs,
    sentResizes,
    emitState(state: ConnectionState) {
      for (const callback of stateCallbacks) callback(state);
    },
  };
}

function makeFitAddon(): BindableFitAddon {
  return {
    activate() {},
    dispose: mock(() => {}),
    fit: mock(() => {}),
    observeResize: mock(() => {}),
  };
}

describe("bindClientToTerminal", () => {
  it("sends terminal input as encoded bytes", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon: makeFitAddon() });

    adapterHarness.fireData("abc");

    expect(clientHarness.sentInputs).toEqual([new TextEncoder().encode("abc")]);
  });

  it("drops input when shouldSendInput returns false and sends when it returns true", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    let allow = false;
    bindClientToTerminal({
      adapter: adapterHarness.adapter,
      client: clientHarness.client,
      fitAddon: makeFitAddon(),
      shouldSendInput: () => allow,
    });

    adapterHarness.fireData("muted");
    expect(clientHarness.sentInputs).toHaveLength(0);

    allow = true;
    adapterHarness.fireData("live");
    expect(clientHarness.sentInputs).toEqual([new TextEncoder().encode("live")]);
  });

  it("always sends input when no guard is provided", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon: makeFitAddon() });

    adapterHarness.fireData("x");
    adapterHarness.fireData("y");

    expect(clientHarness.sentInputs).toHaveLength(2);
  });

  it("tracks and forwards resize events", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon: makeFitAddon() });

    adapterHarness.fireResize(120, 40);

    expect(clientHarness.sentResizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("loads the fit addon and performs an initial fit and observeResize", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon });

    expect(adapterHarness.loadAddon).toHaveBeenCalledWith(fitAddon);
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(fitAddon.observeResize).toHaveBeenCalledTimes(1);
  });

  it("fits, resends the latest size, and focuses on connect", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon });

    adapterHarness.fireResize(100, 30);
    clientHarness.sentResizes.length = 0;
    (fitAddon.fit as ReturnType<typeof mock>).mockClear();

    clientHarness.emitState("connected");

    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(clientHarness.sentResizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(adapterHarness.focus).toHaveBeenCalledTimes(1);
  });

  it("does not resend size on connect when no resize was seen", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon });

    clientHarness.emitState("connected");

    expect(fitAddon.fit).toHaveBeenCalled();
    expect(adapterHarness.focus).toHaveBeenCalledTimes(1);
    expect(clientHarness.sentResizes).toHaveLength(0);
  });

  it("skips connect-time focus when shouldFocus returns false", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    bindClientToTerminal({
      adapter: adapterHarness.adapter,
      client: clientHarness.client,
      fitAddon,
      shouldFocus: () => false,
    });

    adapterHarness.fireResize(100, 30);
    clientHarness.sentResizes.length = 0;
    (fitAddon.fit as ReturnType<typeof mock>).mockClear();

    clientHarness.emitState("connected");

    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    expect(clientHarness.sentResizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(adapterHarness.focus).not.toHaveBeenCalled();
  });

  it("ignores non-connected states", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    bindClientToTerminal({ adapter: adapterHarness.adapter, client: clientHarness.client, fitAddon });
    (fitAddon.fit as ReturnType<typeof mock>).mockClear();

    clientHarness.emitState("connecting");
    clientHarness.emitState("disconnected");

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(adapterHarness.focus).not.toHaveBeenCalled();
    expect(clientHarness.sentResizes).toHaveLength(0);
  });

  it("disposes the data sub, resize sub, and fit addon on dispose", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    const binding = bindClientToTerminal({
      adapter: adapterHarness.adapter,
      client: clientHarness.client,
      fitAddon,
    });

    binding.dispose();

    expect(adapterHarness.dataDispose).toHaveBeenCalledTimes(1);
    expect(adapterHarness.resizeDispose).toHaveBeenCalledTimes(1);
    expect(fitAddon.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores connected state changes after dispose", () => {
    const adapterHarness = makeAdapter();
    const clientHarness = makeClient();
    const fitAddon = makeFitAddon();
    const binding = bindClientToTerminal({
      adapter: adapterHarness.adapter,
      client: clientHarness.client,
      fitAddon,
    });

    adapterHarness.fireResize(100, 30);
    binding.dispose();
    clientHarness.sentResizes.length = 0;
    (fitAddon.fit as ReturnType<typeof mock>).mockClear();

    clientHarness.emitState("connected");

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(clientHarness.sentResizes).toHaveLength(0);
    expect(adapterHarness.focus).not.toHaveBeenCalled();
  });
});
