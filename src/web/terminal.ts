export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface TerminalHandle {
  write(data: Uint8Array): void;
  dispose(): void;
}
