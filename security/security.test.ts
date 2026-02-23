import { describe, expect, it } from "bun:test";
import { isValidHost, isValidOrigin, isValidToken } from "./middleware.ts";
import { generateToken, maskToken } from "./token.ts";

function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe("generateToken", () => {
  it("generates a token with at least 32 hex characters", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{32,}$/);
  });

  it("generates unique tokens on each call", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe("maskToken", () => {
  it("masks token value in a string", () => {
    const token = "abcdef1234567890abcdef1234567890";
    const input = `http://127.0.0.1:3000/?t=${token}`;
    const result = maskToken(input, token);
    expect(result).not.toContain(token);
    expect(result).toContain("****");
  });

  it("returns the original string when token is not present", () => {
    const token = "abcdef1234567890abcdef1234567890";
    const input = "no token here";
    const result = maskToken(input, token);
    expect(result).toBe("no token here");
  });

  it("masks all occurrences of the token", () => {
    const token = "abcdef1234567890abcdef1234567890";
    const input = `token=${token}&check=${token}`;
    const result = maskToken(input, token);
    expect(result).not.toContain(token);
  });
});

describe("isValidHost", () => {
  it("allows request with Host 127.0.0.1:<port>", () => {
    expect(isValidHost(req("http://x/test", { Host: "127.0.0.1:3000" }), 3000)).toBe(true);
  });

  it("allows request with Host localhost:<port>", () => {
    expect(isValidHost(req("http://x/test", { Host: "localhost:3000" }), 3000)).toBe(true);
  });

  it("rejects request with invalid Host header", () => {
    expect(isValidHost(req("http://x/test", { Host: "evil.com:3000" }), 3000)).toBe(false);
  });

  it("rejects request with mismatched port", () => {
    expect(isValidHost(req("http://x/test", { Host: "127.0.0.1:9999" }), 3000)).toBe(false);
  });

  it("rejects request with no Host header", () => {
    expect(isValidHost(req("http://x/test"), 3000)).toBe(false);
  });
});

describe("isValidOrigin", () => {
  it("allows request with no Origin header (non-browser)", () => {
    expect(isValidOrigin(req("http://x/test"), 3000)).toBe(true);
  });

  it("allows request with Origin http://127.0.0.1:<port>", () => {
    expect(isValidOrigin(req("http://x/test", { Origin: "http://127.0.0.1:3000" }), 3000)).toBe(true);
  });

  it("allows request with Origin http://localhost:<port>", () => {
    expect(isValidOrigin(req("http://x/test", { Origin: "http://localhost:3000" }), 3000)).toBe(true);
  });

  it("rejects request with external Origin", () => {
    expect(isValidOrigin(req("http://x/test", { Origin: "http://evil.com" }), 3000)).toBe(false);
  });

  it("rejects request with Origin on different port", () => {
    expect(isValidOrigin(req("http://x/test", { Origin: "http://127.0.0.1:9999" }), 3000)).toBe(false);
  });
});

describe("isValidToken", () => {
  const token = "a".repeat(32);

  it("allows request with valid token in query parameter", () => {
    expect(isValidToken(req(`http://x/test?t=${token}`), token)).toBe(true);
  });

  it("rejects request with missing token", () => {
    expect(isValidToken(req("http://x/test"), token)).toBe(false);
  });

  it("rejects request with wrong token", () => {
    expect(isValidToken(req("http://x/test?t=wrong-token"), token)).toBe(false);
  });

  it("rejects request with empty token parameter", () => {
    expect(isValidToken(req("http://x/test?t="), token)).toBe(false);
  });
});
