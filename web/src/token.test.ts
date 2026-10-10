import { describe, expect, it } from "bun:test";
import { resolveToken, TOKEN_STORAGE_KEY, type TokenEnvironment } from "./token.ts";

function setup(options: { hash?: string; stored?: string; storageThrows?: boolean } = {}) {
  const items = new Map<string, string>();
  if (options.stored !== undefined) items.set(TOKEN_STORAGE_KEY, options.stored);
  const location = { hash: options.hash ?? "", pathname: "/", search: "?x=1" };
  const replaced: string[] = [];

  const env: TokenEnvironment = {
    location,
    history: {
      replaceState(_data, _unused, url) {
        replaced.push(String(url));
        location.hash = "";
      },
    },
    storage() {
      if (options.storageThrows) throw new DOMException("blocked", "SecurityError");
      return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
          items.set(key, value);
        },
      };
    },
  };
  return { env, items, replaced };
}

describe("resolveToken", () => {
  it("takes the token from the fragment, stores it, and removes it from the URL", () => {
    const { env, items, replaced } = setup({ hash: "#abc123" });

    expect(resolveToken(env)).toBe("abc123");
    expect(items.get(TOKEN_STORAGE_KEY)).toBe("abc123");
    expect(replaced).toEqual(["/?x=1"]);
  });

  it("reuses the stored token after the fragment is gone (reload)", () => {
    const { env } = setup({ hash: "#abc123" });
    resolveToken(env);

    expect(resolveToken(env)).toBe("abc123");
  });

  it("prefers a new fragment over a stored token", () => {
    const { env, items } = setup({ hash: "#new", stored: "old" });

    expect(resolveToken(env)).toBe("new");
    expect(items.get(TOKEN_STORAGE_KEY)).toBe("new");
  });

  it("returns null when there is no fragment and nothing stored", () => {
    const { env, replaced } = setup();

    expect(resolveToken(env)).toBeNull();
    expect(replaced).toEqual([]);
  });

  it("still uses and removes the fragment when storage is unavailable", () => {
    const { env, replaced } = setup({ hash: "#abc123", storageThrows: true });

    expect(resolveToken(env)).toBe("abc123");
    expect(replaced).toEqual(["/?x=1"]);
    expect(resolveToken(env)).toBeNull();
  });
});
