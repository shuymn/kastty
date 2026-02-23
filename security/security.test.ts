import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { hostValidation, originValidation, tokenValidation } from "./middleware.ts";
import { generateToken, maskToken } from "./token.ts";

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

describe("hostValidation", () => {
  function createApp(port: number) {
    const app = new Hono();
    app.use(hostValidation(port));
    app.get("/test", (c) => c.text("ok"));
    return app;
  }

  it("allows request with Host 127.0.0.1:<port>", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Host: "127.0.0.1:3000" } });
    expect(res.status).toBe(200);
  });

  it("allows request with Host localhost:<port>", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Host: "localhost:3000" } });
    expect(res.status).toBe(200);
  });

  it("rejects request with invalid Host header", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Host: "evil.com:3000" } });
    expect(res.status).toBe(403);
  });

  it("rejects request with mismatched port", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Host: "127.0.0.1:9999" } });
    expect(res.status).toBe(403);
  });

  it("rejects request with no Host header", async () => {
    const app = createApp(3000);
    const res = await app.request("http://no-host/test");
    expect(res.status).toBe(403);
  });
});

describe("originValidation", () => {
  function createApp(port: number) {
    const app = new Hono();
    app.use(originValidation(port));
    app.get("/test", (c) => c.text("ok"));
    return app;
  }

  it("allows request with no Origin header (non-browser)", async () => {
    const app = createApp(3000);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows request with Origin http://127.0.0.1:<port>", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Origin: "http://127.0.0.1:3000" } });
    expect(res.status).toBe(200);
  });

  it("allows request with Origin http://localhost:<port>", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Origin: "http://localhost:3000" } });
    expect(res.status).toBe(200);
  });

  it("rejects request with external Origin", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Origin: "http://evil.com" } });
    expect(res.status).toBe(403);
  });

  it("rejects request with Origin on different port", async () => {
    const app = createApp(3000);
    const res = await app.request("/test", { headers: { Origin: "http://127.0.0.1:9999" } });
    expect(res.status).toBe(403);
  });
});

describe("tokenValidation", () => {
  const token = "a".repeat(32);

  function createApp(t: string) {
    const app = new Hono();
    app.use(tokenValidation(t));
    app.get("/test", (c) => c.text("ok"));
    return app;
  }

  it("allows request with valid token in query parameter", async () => {
    const app = createApp(token);
    const res = await app.request(`/test?t=${token}`);
    expect(res.status).toBe(200);
  });

  it("rejects request with missing token", async () => {
    const app = createApp(token);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("rejects request with wrong token", async () => {
    const app = createApp(token);
    const res = await app.request("/test?t=wrong-token");
    expect(res.status).toBe(403);
  });

  it("rejects request with empty token parameter", async () => {
    const app = createApp(token);
    const res = await app.request("/test?t=");
    expect(res.status).toBe(403);
  });
});
