export interface Claims {
  sub: string;
  /** Expiry as seconds since the Unix epoch (RFC 7519). */
  exp: number;
  /** Issued-at as seconds since the Unix epoch. */
  iat: number;
}

/** Tolerated clock drift between the issuer and this server. */
const LEEWAY_SECONDS = 30;

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

export function isExpired(claims: Claims): boolean {
  if (typeof claims.exp !== "number") {
    return true;
  }
  return claims.exp < Date.now();
}

export function assertFresh(token: string): Claims {
  const claims = decodeClaims(token);
  if (claims === null) {
    throw new Error("malformed token");
  }
  if (isExpired(claims)) {
    throw new Error(`token expired (leeway ${LEEWAY_SECONDS}s)`);
  }
  return claims;
}
