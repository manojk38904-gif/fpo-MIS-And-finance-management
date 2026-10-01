import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DataSource } from 'typeorm';
import type { JwtPayload } from './jwt-payload.interface.js';
import { SESSION_STORE_PORT } from '../session/session-store.port.js';
import type { SessionStorePort } from '../session/session-store.port.js';
import { KnownTenantTransactionRunner } from '../tenant-context/known-tenant-transaction-runner.js';
// NOTE on layering: AuthModule (common/) is deliberately coupled here to
// Priority #1's own entities (FpoRegistrationEntity, UserAccountEntity,
// PlatformAdminAccountEntity) because, in this single-app Phase-1 codebase,
// "is this tenant/user/admin still allowed to use this token right now" IS
// Priority #1's own authoritative truth (tenant/user identity + status) —
// there is no other owner to delegate to yet. If auth is ever split into its
// own deployable boundary, this becomes a port/adapter like SessionStorePort
// itself; for Phase-1, inventing that indirection now would be speculative.
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../../modules/priority1-auth-registration/entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../../modules/priority1-auth-registration/entities/user-account.entity.js';
import {
  PlatformAdminAccountEntity,
  PlatformAdminStatus,
} from '../../modules/priority1-auth-registration/entities/platform-admin-account.entity.js';

const SESSION_INVALID = 'Session has expired or been revoked. Please log in again.';

/**
 * Correction-pass item 2: passport-jwt's own machinery already rejects a
 * token with a bad signature or an expired `exp` claim before `validate()`
 * ever runs — but that alone only proves the token was validly SIGNED, once,
 * at issuance. This method is where every subsequent, STATEFUL check lives,
 * re-run on every single authenticated request:
 *   1. The Redis session (`sid`) still exists and is not revoked.
 *   2. The session's own subject matches the token's subject (defence in
 *      depth — a forged token could not carry a real `sid` without the
 *      signature check above already having failed, but this keeps the two
 *      checks independently meaningful).
 *   3. The session has not passed its own absolute expiry.
 *   4. For a tenant user: the tenant is still ACTIVE and the user account is
 *      still ACTIVE (not LOCKED/SUSPENDED/PENDING_SETUP).
 *   5. For a Platform Super Admin: the admin account is still ACTIVE and the
 *      session's own MFA step was actually completed (never accepts a
 *      password-only, pre-MFA session as if it were a full login).
 * Logout, lockout, suspension and password reset all act by revoking the
 * Redis session (see SessionStorePort) — so all of them take effect here, on
 * the very next request, regardless of how much of the access token's own
 * short JWT expiry window remains.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(SESSION_STORE_PORT) private readonly sessionStore: SessionStorePort,
    private readonly dataSource: DataSource,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
  ) {
    // Non-null: env.validation.ts (ConfigModule's `validate`) refuses to let the
    // app finish bootstrapping at all if this is empty/missing/too short.
    const secret = config.get<string>('jwt.accessSecret')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sid) {
      throw new UnauthorizedException(SESSION_INVALID);
    }

    const session = await this.sessionStore.getSession(payload.sid);
    if (!session || session.revoked) {
      throw new UnauthorizedException(SESSION_INVALID);
    }
    if (session.userId !== payload.sub) {
      throw new UnauthorizedException(SESSION_INVALID);
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException(SESSION_INVALID);
    }

    if (payload.isPlatformSuperAdmin) {
      if (session.subjectType !== 'PLATFORM_ADMIN' || !session.mfaCompleted) {
        throw new UnauthorizedException(SESSION_INVALID);
      }
      const admin = await this.dataSource.getRepository(PlatformAdminAccountEntity).findOne({ where: { id: payload.sub } });
      if (!admin || admin.status !== PlatformAdminStatus.ACTIVE) {
        throw new UnauthorizedException(SESSION_INVALID);
      }
      return { sub: payload.sub, tenantId: null, isPlatformSuperAdmin: true, sid: payload.sid };
    }

    if (session.subjectType !== 'TENANT_USER' || !payload.tenantId || session.tenantId !== payload.tenantId) {
      throw new UnauthorizedException(SESSION_INVALID);
    }

    const tenant = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: payload.tenantId } });
    if (!tenant || tenant.status !== FpoRegistrationStatus.ACTIVE) {
      throw new UnauthorizedException(SESSION_INVALID);
    }

    const user = await this.knownTenantTx.run(payload.tenantId, (manager) =>
      manager.getRepository(UserAccountEntity).findOne({ where: { id: payload.sub, tenantId: payload.tenantId! } }),
    );
    if (!user || user.status !== UserAccountStatus.ACTIVE) {
      throw new UnauthorizedException(SESSION_INVALID);
    }

    return { sub: payload.sub, tenantId: payload.tenantId, isPlatformSuperAdmin: false, sid: payload.sid };
  }
}
