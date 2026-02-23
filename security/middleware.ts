const FORBIDDEN = () => new Response("Forbidden", { status: 403 });

export function isValidHost(req: Request, port: number): boolean {
  const host = req.headers.get("host");
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function isValidOrigin(req: Request, port: number): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function isValidToken(req: Request, token: string): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("t") === token;
}

export function validateRequest(req: Request, port: number): Response | null {
  if (!isValidHost(req, port)) return FORBIDDEN();
  if (!isValidOrigin(req, port)) return FORBIDDEN();
  return null;
}
