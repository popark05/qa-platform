import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const AUTH_ROLES = ["admin", "author", "reviewer", "executor", "viewer"] as const;
export type AuthRole = typeof AUTH_ROLES[number];
export interface AuthContext { sub: string; tenantId: string; roles: AuthRole[] }
export interface AuthConfig { mode: "disabled" | "required"; secret?: string; issuer?: string; audience?: string }
interface JwtClaims {
  sub?: unknown; tenant_id?: unknown; roles?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown;
  iss?: unknown; aud?: unknown;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthenticationError extends Error {
  constructor(message = "invalid_bearer_token") { super(message); this.name = "AuthenticationError"; }
}

export function verifyBearerToken(header: string | undefined, config: AuthConfig): AuthContext {
  if (!header?.startsWith("Bearer ")) throw new AuthenticationError("bearer_token_required");
  if (!config.secret || Buffer.byteLength(config.secret) < 32) throw new AuthenticationError("authentication_not_configured");
  const parts = header.slice(7).trim().split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new AuthenticationError();
  let jwtHeader: { alg?: unknown; typ?: unknown };
  let claims: JwtClaims;
  try {
    jwtHeader = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown };
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JwtClaims;
  } catch { throw new AuthenticationError(); }
  if (jwtHeader.alg !== "HS256" || (jwtHeader.typ !== undefined && jwtHeader.typ !== "JWT")) throw new AuthenticationError();
  const expected = createHmac("sha256", config.secret).update(parts[0] + "." + parts[1]).digest();
  const supplied = Buffer.from(parts[2]!, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AuthenticationError();
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) throw new AuthenticationError("token_expired");
  if (typeof claims.nbf === "number" && claims.nbf > now) throw new AuthenticationError("token_not_yet_valid");
  if (typeof claims.iat !== "undefined" && (typeof claims.iat !== "number" || claims.iat > now + 60)) throw new AuthenticationError();
  if (config.issuer && claims.iss !== config.issuer) throw new AuthenticationError();
  if (config.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(config.audience)) throw new AuthenticationError();
  }
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 200) throw new AuthenticationError();
  if (typeof claims.tenant_id !== "string" || !uuidPattern.test(claims.tenant_id)) throw new AuthenticationError();
  if (!Array.isArray(claims.roles) || claims.roles.length === 0 ||
      !claims.roles.every((role) => typeof role === "string" && AUTH_ROLES.includes(role as AuthRole))) throw new AuthenticationError();
  return { sub: claims.sub, tenantId: claims.tenant_id, roles: [...new Set(claims.roles)] as AuthRole[] };
}
export function hasAnyRole(auth: AuthContext, roles: AuthRole[]): boolean {
  return auth.roles.includes("admin") || roles.some((role) => auth.roles.includes(role));
}

declare module "fastify" {
  interface FastifyRequest { auth: AuthContext | null }
}
