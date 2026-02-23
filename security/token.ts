const TOKEN_BYTES = 16;
const MASK_REPLACEMENT = "****";

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function maskToken(input: string, token: string): string {
  return input.replaceAll(token, MASK_REPLACEMENT);
}
