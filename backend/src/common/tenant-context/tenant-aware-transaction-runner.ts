import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContextService } from './tenant-context.service.js';

/**
 * Opens a DB transaction and sets the PostgreSQL session GUCs that the RLS
 * policies (see tenant-rls.util.ts) check on every row. This is the single
 * chokepoint through which every tenant-scoped read/write must pass — no
 * repository should use `dataSource.manager` directly for tenant-scoped
 * tables, only the EntityManager handed out here.
 *
 * `SET LOCAL` is transaction-scoped in Postgres, so these settings can never
 * leak onto a pooled connection re-used by a different request.
 */
@Injectable()
export class TenantAwareTransactionRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const ctx = this.tenantContext.getContext();
    if (!ctx) {
      throw new Error(
        'TenantAwareTransactionRunner.run() called outside of a request context.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Postgres's SET/SET LOCAL do not accept bind parameters, so we use
      // set_config(), which does — this keeps tenant/user-controlled values
      // out of raw string interpolation. The third argument (true) makes the
      // setting LOCAL, i.e. scoped to this transaction only.
      if (ctx.tenantId) {
        await queryRunner.query("SELECT set_config('app.current_tenant_id', $1, true)", [ctx.tenantId]);
      }
      // NOTE: the generic tenant-isolation policy (tenant-rls.util.ts) does NOT
      // check app.is_platform_admin — there is no generic cross-tenant bypass.
      // This session variable exists only so a future, screen-specific,
      // narrowly-scoped policy or view (SA-07 controlled support context,
      // SA-08 audit presentation, or a dedicated aggregated/metadata read
      // model) can opt in explicitly, if and when it is built from its own
      // frozen specification. Setting it here does not by itself grant access
      // to anything.
      await queryRunner.query("SELECT set_config('app.is_platform_admin', $1, true)", [
        ctx.isPlatformSuperAdmin ? 'true' : 'false',
      ]);

      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
