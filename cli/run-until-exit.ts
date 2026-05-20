/** Subset of {@link SessionManager} that {@link runUntilExit} drives. */
export interface ExitSource {
  onExit(callback: (exitCode: number) => void): void;
  destroy(): void;
}

/** Subset of Bun's `Server` that {@link runUntilExit} drives. */
export interface StoppableServer {
  stop(): void;
}

/** Signal seam: `process` in production, an in-memory fake in tests. */
export interface SignalSource {
  on(signal: "SIGINT" | "SIGTERM", handler: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", handler: () => void): void;
}

/** POSIX convention: a signal-terminated process exits with 128 + signal number (SIGINT = 2). */
const SIGNAL_EXIT_CODE = 128 + 2;

/**
 * Block until the session ends, then resolve with the process exit code.
 *
 * The teardown order is load-bearing and differs by trigger:
 * - PTY exit: the process is already gone, so only stop the server.
 * - SIGINT/SIGTERM: destroy the session (kill the PTY) *before* stopping the
 *   server.
 *
 * Whichever fires first wins; `settle` is idempotent so the loser is a no-op,
 * and both signal listeners are removed once settled so nothing leaks.
 */
export function runUntilExit(
  session: ExitSource,
  server: StoppableServer,
  signals: SignalSource = process,
): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    let serverStopped = false;
    const stopServer = () => {
      if (serverStopped) return;
      serverStopped = true;
      server.stop();
    };
    function handleSignal(): void {
      session.destroy();
      stopServer();
      settle(SIGNAL_EXIT_CODE);
    }

    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      signals.off("SIGINT", handleSignal);
      signals.off("SIGTERM", handleSignal);
      resolve(code);
    };

    session.onExit((code) => {
      stopServer();
      settle(code);
    });

    signals.on("SIGINT", handleSignal);
    signals.on("SIGTERM", handleSignal);
  });
}
