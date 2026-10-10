export const TOKEN_STORAGE_KEY = "kastty.token";

export interface TokenEnvironment {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState">;
  /** Resolved lazily: reading `window.sessionStorage` itself throws when storage is blocked. */
  storage: () => Pick<Storage, "getItem" | "setItem">;
}

/**
 * Resolve the attach token (ADR 0017). The CLI opens `/#<token>` so the token
 * never reaches the server log or a Referer; it is kept in sessionStorage for
 * reloads and removed from the address bar. Returns null when there is none.
 */
export function resolveToken(env: TokenEnvironment): string | null {
  const fromHash = env.location.hash.slice(1);
  if (fromHash) {
    try {
      env.storage().setItem(TOKEN_STORAGE_KEY, fromHash);
    } catch {
      // Without storage the token still works until the next reload.
    }
    env.history.replaceState(null, "", env.location.pathname + env.location.search);
    return fromHash;
  }

  try {
    return env.storage().getItem(TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
