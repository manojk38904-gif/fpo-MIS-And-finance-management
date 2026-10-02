import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from '../tenant-rls.util.js';

/**
 * PHASE 2.2 — PRIORITY #13 — SET-08 (Roles & Permissions), first slice of
 * the Administration/Settings/RBAC module. Owner Decision #A (v1.3 §4) —
 * MANDATORY MAKER-CHECKER — governs every mutation; see RoleService for the
 * enforcement. Only SET-08 is migrated in this pass; SET-01..07,09,11..17,
 * 20..22 remain to be built from the same frozen spec.
 */
export class Priority13RolesPermissions1759500000000 implements MigrationInterface {
  name = 'Priority13RolesPermissions1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "settings_role_status_enum" AS ENUM (
        'DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SENT_BACK', 'SUPERSEDED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "settings_role" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "roleName" varchar(128) NOT NULL,
        "description" text,
        "permissions" jsonb NOT NULL,
        "scopeDefault" varchar(16) NOT NULL DEFAULT 'SELECTED_BRANCH',
        "isDefaultRole" boolean NOT NULL DEFAULT false,
        "status" settings_role_status_enum NOT NULL DEFAULT 'DRAFT',
        "makerId" uuid NOT NULL,
        "checkerId" uuid,
        "submittedAt" timestamptz,
        "decidedAt" timestamptz,
        "decisionReason" text,
        "supersedesId" uuid
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_settings_role_tenant_id" ON "settings_role" ("tenant_id")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_role_tenant_name" ON "settings_role" ("tenant_id", "roleName")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_role_status" ON "settings_role" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_role_supersedes" ON "settings_role" ("supersedesId")`);

    // Race-safety backstop (same pattern as Priority #1's item-14 partial
    // unique indexes): at most one PENDING_APPROVAL submission may exist per
    // lineage at a time, so a double-submit or a second concurrent edit of
    // the same Active role cannot both reach PENDING_APPROVAL.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_settings_role_pending_edit"
      ON "settings_role" ("tenant_id", "supersedesId")
      WHERE "status" = 'PENDING_APPROVAL' AND "supersedesId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_settings_role_pending_new"
      ON "settings_role" ("tenant_id", "roleName")
      WHERE "status" = 'PENDING_APPROVAL' AND "supersedesId" IS NULL
    `);

    await enableTenantRls(queryRunner, 'settings_role');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settings_role"`);
    await queryRunner.query(`DROP TYPE "settings_role_status_enum"`);
  }
}
