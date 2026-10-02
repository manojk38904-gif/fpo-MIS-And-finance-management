import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from '../tenant-rls.util.js';

/**
 * PHASE 2.2 — PRIORITY #13 — SET-07 (Users), Owner Decision #A (MANDATORY
 * MAKER-CHECKER). Additive-only against Priority #1's `user_account` table
 * (nullable columns, nothing existing changed/removed) — see
 * user-account.entity.ts's own comment on why this is exactly the extension
 * point Priority #1 deliberately left open.
 */
export class Priority13Users1759500200000 implements MigrationInterface {
  name = 'Priority13Users1759500200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_account" ADD COLUMN "fullName" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "user_account" ADD COLUMN "roleId" uuid`);
    await queryRunner.query(`ALTER TABLE "user_account" ADD COLUMN "branchAccessScope" varchar(16)`);

    await queryRunner.query(`
      CREATE TYPE "settings_user_request_action_enum" AS ENUM ('CREATE', 'EDIT', 'DEACTIVATE', 'REACTIVATE')
    `);
    await queryRunner.query(`
      CREATE TABLE "settings_user_request" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "actionType" settings_user_request_action_enum NOT NULL,
        "supersedesUserId" uuid,
        "fullName" varchar(255),
        "mobile" varchar(10),
        "email" varchar(255),
        "roleId" uuid,
        "branchAccessScope" varchar(16),
        "selectedBranchIds" jsonb,
        "status" settings_role_status_enum NOT NULL DEFAULT 'DRAFT',
        "makerId" uuid NOT NULL,
        "checkerId" uuid,
        "submittedAt" timestamptz,
        "decidedAt" timestamptz,
        "decisionReason" text
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_settings_user_request_tenant_id" ON "settings_user_request" ("tenant_id")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_user_request_supersedes" ON "settings_user_request" ("tenant_id", "supersedesUserId")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_user_request_status" ON "settings_user_request" ("status")`);
    // Same race-safety pattern as settings_role: at most one PENDING_APPROVAL
    // request may exist per target user (edits) or per lineage slot (creates
    // have no natural "same slot" key beyond a single in-flight create per
    // maker — intentionally not uniqued, since two Makers legitimately may
    // each be onboarding a different brand-new user concurrently).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_settings_user_request_pending_edit"
      ON "settings_user_request" ("tenant_id", "supersedesUserId")
      WHERE "status" = 'PENDING_APPROVAL' AND "supersedesUserId" IS NOT NULL
    `);
    await enableTenantRls(queryRunner, 'settings_user_request');

    await queryRunner.query(`
      CREATE TABLE "settings_user_branch_assignment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "branchId" uuid NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_settings_uba_tenant_user" ON "settings_user_branch_assignment" ("tenant_id", "userId")`);
    await enableTenantRls(queryRunner, 'settings_user_branch_assignment');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settings_user_branch_assignment"`);
    await queryRunner.query(`DROP TABLE "settings_user_request"`);
    await queryRunner.query(`DROP TYPE "settings_user_request_action_enum"`);
    await queryRunner.query(`ALTER TABLE "user_account" DROP COLUMN "branchAccessScope"`);
    await queryRunner.query(`ALTER TABLE "user_account" DROP COLUMN "roleId"`);
    await queryRunner.query(`ALTER TABLE "user_account" DROP COLUMN "fullName"`);
  }
}
