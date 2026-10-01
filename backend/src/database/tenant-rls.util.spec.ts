import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { enableTenantRls } from './tenant-rls.util.js';

/**
 * Integration test against a REAL PostgreSQL instance (requires DATABASE_URL,
 * e.g. from .env — see .env.example). This is the automated version of the
 * manual verification run during Phase-1 kickoff: it proves tenant isolation
 * is enforced by the database itself, not merely by application code.
 *
 * Required minimum coverage per Phase-1 kickoff instructions: tenant
 * isolation, cross-tenant denial.
 */
describe('enableTenantRls — database-enforced tenant isolation', () => {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas',
  });

  const TABLE = 'rls_test_table';
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await dataSource.query(`
      CREATE TABLE ${TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        label text
      )
    `);
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await enableTenantRls(queryRunner, TABLE);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await dataSource.destroy();
  });

  async function asTenant(tenantId: string | null, isPlatformAdmin: boolean, fn: (qr: import('typeorm').QueryRunner) => Promise<void>) {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (tenantId) await queryRunner.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await queryRunner.query("SELECT set_config('app.is_platform_admin', $1, true)", [isPlatformAdmin ? 'true' : 'false']);
      await fn(queryRunner);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  it('allows a tenant to insert and read only its own rows', async () => {
    await asTenant(TENANT_A, false, async (qr) => {
      await qr.query(`INSERT INTO ${TABLE} (tenant_id, label) VALUES ($1, 'A-row')`, [TENANT_A]);
    });
    await asTenant(TENANT_B, false, async (qr) => {
      await qr.query(`INSERT INTO ${TABLE} (tenant_id, label) VALUES ($1, 'B-row')`, [TENANT_B]);
    });

    await asTenant(TENANT_A, false, async (qr) => {
      const rows = await qr.query(`SELECT label FROM ${TABLE}`);
      expect(rows).toEqual([{ label: 'A-row' }]);
    });
  });

  it('returns zero rows when no tenant context is set (deny-by-default)', async () => {
    const rows = await dataSource.query(`SELECT label FROM ${TABLE}`);
    expect(rows).toEqual([]);
  });

  it('SECURITY: the platform-admin flag ALONE does NOT bypass the generic tenant policy — no cross-tenant raw-table read', async () => {
    // Corrected per Phase-1 foundation security review: the frozen Priority #18
    // rule is "aggregated/metadata-level" cross-tenant access via explicit,
    // screen-specific mechanisms (SA-07 controlled support, SA-08 audit
    // presentation, dedicated read models) — never a blanket bypass on every
    // generic tenant-scoped table. app.is_platform_admin = true with no
    // matching app.current_tenant_id must see ZERO rows here, same as any
    // other unmatched/absent tenant context.
    await asTenant(null, true, async (qr) => {
      const rows = await qr.query(`SELECT label FROM ${TABLE}`);
      expect(rows).toEqual([]);
    });
  });

  it('SECURITY: platform-admin flag does not let a session read a DIFFERENT tenant even when one tenant_id is also set', async () => {
    await asTenant(TENANT_A, true, async (qr) => {
      const rows = await qr.query(`SELECT label FROM ${TABLE} ORDER BY label`);
      // Only Tenant A's own row — being platform-admin does not additionally
      // surface Tenant B's row through the generic policy.
      expect(rows).toEqual([{ label: 'A-row' }]);
    });
  });

  it('rejects a cross-tenant write attempt', async () => {
    await expect(
      asTenant(TENANT_A, false, async (qr) => {
        await qr.query(`INSERT INTO ${TABLE} (tenant_id, label) VALUES ($1, 'cross-tenant write')`, [TENANT_B]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
