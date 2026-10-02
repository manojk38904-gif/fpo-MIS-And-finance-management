/**
 * Shape of a verified JWT access-token payload. Priority #1's login
 * endpoints are the only code that ISSUES these tokens; everything else only
 * ever CONSUMES an already-signature-verified payload — never a client-
 * supplied tenant/user id from a header, query string, or body.
 *
 * `sid` (correction-pass item 1/2) ties this access token to its Redis
 * session record — JwtStrategy re-checks that record (and live
 * tenant/user/admin state) on EVERY request, so a signed-but-revoked token
 * (logout, lockout, suspension, password reset) stops working immediately,
 * not merely once its own short JWT expiry elapses.
 */
export interface JwtPayload {
  /** Authenticated user's UUID. */
  sub: string;
  /** Tenant (FPO) UUID this user belongs to. Absent/null for a Platform Super Admin. */
  tenantId: string | null;
  /** True for a genuine Priority #18 platform-level administrator account. */
  isPlatformSuperAdmin: boolean;
  /** Frozen named platform role. Null/absent for tenant users. */
  platformRole?: 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | null;
  /** Redis session id (see SessionStorePort) this access token belongs to. */
  sid: string;
}
