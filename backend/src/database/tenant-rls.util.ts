/**
 * Row-Level Security helper for the frozen shared-DB + tenant_id + RLS strategy
 * (Master SRS v1.1 §4.1). Every tenant-scoped table must call
 * `enableTenantRls(queryRunner, 'table_name')` in its migration, immediately
 * after creating the table, so tenant isolation is enforced AT THE DATABASE,
 * not only in application code (per project instructions).
 *
 * Convention: every tenant-scoped table has a NOT NULL `tenant_id UUID` column.
 * The application sets `app.current_tenant_id` via `SET LOCAL` (via set_config,
 * see TenantAwareTransactionRunner) for the duration of each transaction before
 * touching any tenant-scoped table.
 *
 * SECURITY CORRECTION (Phase-1 foundation review): this generic policy is
 * STRICT TENANT-ONLY — there is no platform-admin bypass here. The frozen
 * Priority #18 rule is "aggregated/metadata-level" cross-tenant access for
 * normal platform screens, and a separate, explicit, controlled mechanism
 * (SA-07 consent/time-bound support access) for individual-record access —
 * neither is "SELECT every tenant table directly." A generic OR-bypass would
 * have given ANY authenticated platform-admin session unrestricted raw read
 * access to every tenant's Member/Loan/KYC/financial data, which is exactly
 * what "FPO-A must never access FPO-B's data" forbids. Screen-specific
 * cross-tenant mechanisms (dedicated platform-owned metadata tables,
 * permitted aggregate read models/views, SA-07's controlled support context,
 * SA-08's audit presentation) are implemented later, from their own frozen
 * specifications, each with its own explicit access path — never through this
 * generic policy.
 */
import type { QueryRunner } from 'typeorm';

export async function enableTenantRls(queryRunner: QueryRunner, tableName: string): Promise<void> {
  await queryRunner.query(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`);
  await queryRunner.query(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`);

  // Deny-by-default: a session with no app.current_tenant_id set (or a mismatched
  // tenant_id) sees zero rows — including an authenticated Platform Super Admin
  // session with no matching tenant_id. This is what makes "FPO-A must never
  // access FPO-B's data" a database-level guarantee, not just an
  // application-level one, WITHOUT a generic cross-tenant escape hatch.
  //
  // IMPORTANT: on a pooled connection, once a custom GUC like app.current_tenant_id
  // has been SET LOCAL at least once, Postgres resets it to '' (empty string) — NOT
  // NULL — once the transaction ends. NULLIF(...,'') is required before the ::uuid
  // cast, otherwise the next request to reuse that pooled connection with no tenant
  // context set would crash with "invalid input syntax for type uuid" instead of
  // being safely denied. Verified against a real pooled connection during Phase-1
  // kickoff (see tenant-rls.util.spec.ts).
  await queryRunner.query(`
    CREATE POLICY "${tableName}_tenant_isolation" ON "${tableName}"
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  `);
}

export async function disableTenantRls(queryRunner: QueryRunner, tableName: string): Promise<void> {
  await queryRunner.query(`DROP POLICY IF EXISTS "${tableName}_tenant_isolation" ON "${tableName}"`);
  await queryRunner.query(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY`);
}
