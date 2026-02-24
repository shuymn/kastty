import type { ConnectionState } from "./terminal.ts";

export interface UIControlsDeps {
  sendReadonly(enabled: boolean): void;
  setFontSize(size: number): void;
}

export interface UIControlsState {
  connectionState: ConnectionState;
  fontSize: number;
  readonly: boolean;
}

export type StateListener = (state: UIControlsState) => void;

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 72;

export class UIControls {
  private connectionState: ConnectionState = "disconnected";
  private fontSize: number;
  private readonlyEnabled = false;
  private readonly deps: UIControlsDeps;
  private readonly listeners: StateListener[] = [];

  constructor(deps: UIControlsDeps, initialFontSize: number) {
    this.deps = deps;
    this.fontSize = initialFontSize;
  }

  getState(): UIControlsState {
    return {
      connectionState: this.connectionState,
      fontSize: this.fontSize,
      readonly: this.readonlyEnabled,
    };
  }

  setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.notifyListeners();
  }

  increaseFontSize(): void {
    if (this.fontSize >= MAX_FONT_SIZE) return;
    this.fontSize += 1;
    this.deps.setFontSize(this.fontSize);
    this.notifyListeners();
  }

  decreaseFontSize(): void {
    if (this.fontSize <= MIN_FONT_SIZE) return;
    this.fontSize -= 1;
    this.deps.setFontSize(this.fontSize);
    this.notifyListeners();
  }

  toggleReadonly(): void {
    this.readonlyEnabled = !this.readonlyEnabled;
    this.deps.sendReadonly(this.readonlyEnabled);
    this.notifyListeners();
  }

  isReadonly(): boolean {
    return this.readonlyEnabled;
  }

  onStateChange(listener: StateListener): void {
    this.listeners.push(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
