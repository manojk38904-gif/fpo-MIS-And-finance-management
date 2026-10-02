import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/jwt-payload.interface.js';

/**
 * Owner Decision #3: EXPIRED/READ-ONLY permits authenticated historical
 * access but blocks new mutations server-side. SUSPENDED is already blocked
 * by tenant login/JwtStrategy; this guard is a second boundary for any
 * authenticated request that reaches the HTTP layer.
 *
 * No subscription row means the tenant has not yet been enrolled into the
 * SA-04 lifecycle (migration/backward-compatibility state), so Phase-1
 * does not invent an expiry decision and leaves existing access unchanged.
 */
@Injectable()
export class TenantSubscriptionAccessGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user || user.isPlatformSuperAdmin || !user.tenantId) return true;

    const rows = await this.dataSource.query(
      'SELECT "state" FROM "tenant_subscription" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [user.tenantId],
    );
    const state = (rows as Array<{ state?: string }>)[0]?.state;
    if (!state) return true;

    if (state === 'SUSPENDED') {
      throw new ForbiddenException('This FPO account is not currently active. Please contact your Admin.');
    }

    if (state === 'EXPIRED_READ_ONLY' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      // Tenant consent/revoke is not a financial/business mutation and must
      // remain possible so a tenant can control an already-requested support
      // session while the subscription is read-only.
      if (req.path.startsWith('/api/v1/support-access/tenant/')) return true;
      throw new ForbiddenException(
        'This FPO subscription is expired and currently read-only. New business/configuration transactions are blocked until reactivation.',
      );
    }

    return true;
  }
}
