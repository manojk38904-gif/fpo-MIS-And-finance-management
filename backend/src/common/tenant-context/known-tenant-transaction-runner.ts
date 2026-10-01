import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * TenantAwareTransactionRunner is the PER-REQUEST path: it reads tenantId
 * from TenantContextService (AsyncLocalStorage), which is only populated
 * after a guard has verified a JWT. Some legitimate operations have no JWT
 * yet — SYS-01-A login resolves tenantId from fpoCode via the platform-level
 * fpo_registration table BEFORE the caller is authenticated at all; tenant
 * activation (the SA-01 hook) independently knows the exact tenantId it is
 * creating rows for. Both already possess a correctly, independently
 * resolved tenantId before touching any RLS-protected table — they just
 * have no AsyncLocalStorage context to read it from.
 *
 * This performs the identical, safe, transaction-LOCAL set_config pattern
 * as TenantAwareTransactionRunner, just given an explicit tenantId instead
 * of reading one from request context. It is NOT a bypass: callers must
 * already have obtained tenantId through legitimate, tenant-table-
 * independent resolution (fpoCode lookup, system-triggered activation) —
 * never from an unauthenticated client-supplied value taken at face value.
 */
@Injectable()
export class KnownTenantTransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await manager.query("SELECT set_config('app.is_platform_admin', 'false', true)");
      return work(manager);
    });
  }
}
