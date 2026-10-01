/**
 * Correction-pass item 1 — Master-SRS §26 freezes: short-expiry JWT +
 * rotatable refresh token + Argon2id + Redis-backed session + device/IP
 * metadata + login history, as ONE integrated requirement. This is not an
 * Owner decision to make — it is already frozen. Redis (via this port) is
 * the SOLE authoritative truth for "is this access token's session still
 * active". No second authoritative active-session truth exists in
 * PostgreSQL: `user_refresh_token` / `platform_admin_refresh_token` still
 * exist, but only as the long-lived refresh-secret rotation/reuse-detection
 * ledger — they record "which refresh secret may mint a new access token",
 * never "is this access token currently valid". That second question is
 * answered ONLY by this port, every time, on every authenticated request
 * (see JwtStrategy). A DB refresh-token row always carries the Redis
 * `sessionId` it belongs to; revoking the Redis session is what actually
 * ends a login — revoking the DB row is bookkeeping for the rotation chain,
 * not a second access-control decision point.
 */
export interface SessionRecord {
  sessionId: string;
  subjectType: 'TENANT_USER' | 'PLATFORM_ADMIN';
  userId: string;
  tenantId: string | null;
  /** True only once SYS-01-B's MFA step has completed for this session. */
  mfaCompleted: boolean;
  issuedAt: string;
  /** Absolute session expiry (mirrors refresh-token expiry — the session can
   *  outlive any one short-lived access token, since the access token is
   *  re-validated against this record on every request, not trusted by
   *  itself for longer than its own short JWT expiry). */
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  revoked: boolean;
}

export interface CreateSessionInput {
  subjectType: 'TENANT_USER' | 'PLATFORM_ADMIN';
  userId: string;
  tenantId: string | null;
  mfaCompleted: boolean;
  ttlSeconds: number;
  ipAddress: string | null;
  userAgent: string | null;
}

export const SESSION_STORE_PORT = Symbol('SESSION_STORE_PORT');

export interface SessionStorePort {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  /** Marks the session revoked (or removes it) — it must never again pass a live-session check. */
  revokeSession(sessionId: string): Promise<void>;
  /** Revokes every active session for a given subject (lockout, suspension, password reset, forced logout). */
  revokeAllSessionsForSubject(subjectType: 'TENANT_USER' | 'PLATFORM_ADMIN', userId: string): Promise<void>;
  /** Marks a pending session's MFA step complete (SYS-01-B step 2), without rotating its id. */
  markMfaCompleted(sessionId: string): Promise<void>;
}
