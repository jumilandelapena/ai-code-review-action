export interface Claims {
  sub: string;
  /** Expiry as seconds since the Unix epoch (RFC 7519). */
  exp: number;
  /** Issued-at as seconds since the Unix epoch. */
  iat: number;
}

export function decodeClaims(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1] as string, "base64url").toString("utf8")) as Claims;
  } catch {
    return null;
  }
}
