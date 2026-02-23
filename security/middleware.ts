import { createMiddleware } from "hono/factory";

const FORBIDDEN_RESPONSE = { status: 403 } as const;

export function hostValidation(port: number) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return createMiddleware(async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowed.has(host)) {
      return c.text("Forbidden", FORBIDDEN_RESPONSE);
    }
    await next();
  });
}

export function originValidation(port: number) {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  return createMiddleware(async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !allowed.has(origin)) {
      return c.text("Forbidden", FORBIDDEN_RESPONSE);
    }
    await next();
  });
}

export function tokenValidation(token: string) {
  return createMiddleware(async (c, next) => {
    const t = c.req.query("t");
    if (t !== token) {
      return c.text("Forbidden", FORBIDDEN_RESPONSE);
    }
    await next();
  });
}
