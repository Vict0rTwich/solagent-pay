import { createHmac, timingSafeEqual } from "node:crypto";

// Compact JWS tokens (JWT, HS256) for the session and sign-in cookies. Only this exact header is accepted, so there
// is no algorithm to negotiate: no "none", no confusing an HMAC key for a public one.

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export interface TokenClaims {
  /** What the token is for; a token for one purpose is never accepted for another. */
  aud: string;
  /** Unix seconds. */
  iat: number;
  /** Unix seconds. */
  exp: number;
  [claim: string]: unknown;
}

function mac(key: Buffer, input: string): Buffer {
  return createHmac("sha256", key).update(input).digest();
}

export function signToken(claims: TokenClaims, key: Buffer): string {
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${body}.${mac(key, body).toString("base64url")}`;
}

/** The token's claims if this server signed it, for `audience`, and it hasn't expired. */
export function verifyToken(token: string, key: Buffer, audience: string, now = Date.now()): TokenClaims | null {
  const [header, payload, signature, ...extra] = token.split(".");
  if (header !== HEADER || !payload || !signature || extra.length > 0) return null;
  const expected = mac(key, `${header}.${payload}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  const { aud, iat, exp } = claims as Partial<TokenClaims>;
  if (aud !== audience || typeof iat !== "number" || typeof exp !== "number" || exp * 1000 <= now) return null;
  return claims as TokenClaims;
}
