import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from '../tenant-rls.util.js';

/** PHASE 2.2 — PRIORITY #13 — SET-03 (Branch Master). Not maker-checker-governed (spec §4 scope). */
export class Priority13BranchMaster1759500100000 implements MigrationInterface {
  name = 'Priority13BranchMaster1759500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "settings_branch_type_enum" AS ENUM ('HEAD_OFFICE', 'REGULAR')`);

    await queryRunner.query(`
      CREATE TABLE "settings_branch" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "branchCode" varchar(32) NOT NULL,
        "branchName" varchar(255) NOT NULL,
        "branchType" settings_branch_type_enum NOT NULL DEFAULT 'REGULAR',
        "address" text NOT NULL,
        "state" varchar(128),
        "district" varchar(128),
        "managerUserId" uuid,
        "openingDate" date NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "deactivationReason" text
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_settings_branch_tenant_id" ON "settings_branch" ("tenant_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_settings_branch_tenant_code" ON "settings_branch" ("tenant_id", "branchCode")`);
    await queryRunner.query(`CREATE INDEX "idx_settings_branch_is_active" ON "settings_branch" ("isActive")`);

    await enableTenantRls(queryRunner, 'settings_branch');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settings_branch"`);
    await queryRunner.query(`DROP TYPE "settings_branch_type_enum"`);
  }
}
