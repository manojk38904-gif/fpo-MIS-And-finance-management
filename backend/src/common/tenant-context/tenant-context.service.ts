import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestTenantContext {
  /**
   * Tenant (FPO) UUID. May be null for:
   *  - unauthenticated/public requests, or
   *  - genuine platform-level Platform Super Admin requests (Priority #18).
   * A null tenantId NEVER grants tenant-scoped DB access — the generic RLS
   * policy (tenant-rls.util.ts) is deny-by-default: no tenant context, or a
   * mismatched one, means zero rows, regardless of isPlatformSuperAdmin.
   */
  tenantId: string | null;
  /** Authenticated user UUID, once Priority #1 auth is wired in. */
  userId?: string;
  /** True only for the frozen Priority #18 Platform Super Admin cross-tenant exception. */
  isPlatformSuperAdmin: boolean;
}

/**
 * Tenant/branch isolation is a database-enforced (PostgreSQL RLS) requirement per
 * Master SRS §4.1 and the project's "STRICT MULTI-TENANCY" instruction — this
 * service is the request-scoped carrier that lets the DB layer read which tenant
 * is making the current request, via AsyncLocalStorage (no reliance on globals).
 *
 * This is infrastructure only — it does not decide business rules.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<RequestTenantContext>();

  run<T>(context: RequestTenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getContext(): RequestTenantContext | undefined {
    return this.storage.getStore();
  }

  getTenantId(): string | null {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error(
        'TenantContextService.getTenantId() called outside of a request context. ' +
          'Every DB-touching request must execute within an established TenantContext ' +
          'created after verified authentication / request-context resolution ' +
          '(OptionalJwtAuthGuard -> TenantContextInterceptor).',
      );
    }
    return ctx.tenantId;
  }

  isPlatformSuperAdmin(): boolean {
    return this.storage.getStore()?.isPlatformSuperAdmin ?? false;
  }
}
