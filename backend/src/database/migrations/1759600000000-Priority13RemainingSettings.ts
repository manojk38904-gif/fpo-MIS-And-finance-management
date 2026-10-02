import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls } from '../tenant-rls.util.js';

export class Priority13RemainingSettings1759600000000 implements MigrationInterface {
  name = 'Priority13RemainingSettings1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE settings_governed_status_enum AS ENUM ('DRAFT','PENDING_APPROVAL','ACTIVE','INACTIVE','REJECTED','SENT_BACK','SUPERSEDED')");
    await queryRunner.query("CREATE TYPE settings_governed_action_enum AS ENUM ('UPSERT','DEACTIVATE','REACTIVATE')");
    await queryRunner.query(
      'CREATE TABLE "settings_governed_config" (' +
      '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),' +
      '"created_at" timestamptz NOT NULL DEFAULT now(),' +
      '"updated_at" timestamptz NOT NULL DEFAULT now(),' +
      '"tenant_id" uuid NOT NULL,' +
      '"screenId" varchar(16) NOT NULL,' +
      '"configKey" varchar(128) NOT NULL,' +
      '"payload" jsonb NOT NULL,' +
      '"action" settings_governed_action_enum NOT NULL DEFAULT \\'UPSERT\\',' +
      '"status" settings_governed_status_enum NOT NULL DEFAULT \\'DRAFT\\',' +
      '"version" integer NOT NULL DEFAULT 1,' +
      '"makerId" uuid NOT NULL,' +
      '"checkerId" uuid,' +
      '"supersedesId" uuid,' +
      '"submittedAt" timestamptz,' +
      '"decidedAt" timestamptz,' +
      '"decisionReason" text' +
      ')'
    );
    await queryRunner.query('CREATE UNIQUE INDEX "uq_settings_governed_version" ON "settings_governed_config" ("tenant_id","screenId","configKey","version")');
    await queryRunner.query('CREATE INDEX "idx_settings_governed_screen" ON "settings_governed_config" ("tenant_id","screenId","status")');
    await queryRunner.query("CREATE UNIQUE INDEX \"uq_settings_governed_pending\" ON \"settings_governed_config\" (\"tenant_id\",\"screenId\",\"configKey\") WHERE \"status\" = 'PENDING_APPROVAL'");
    await enableTenantRls(queryRunner, 'settings_governed_config');

    await queryRunner.query(
      'CREATE TABLE "settings_direct_config" (' +
      '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),' +
      '"created_at" timestamptz NOT NULL DEFAULT now(),' +
      '"updated_at" timestamptz NOT NULL DEFAULT now(),' +
      '"tenant_id" uuid NOT NULL,' +
      '"screenId" varchar(16) NOT NULL,' +
      '"configKey" varchar(128) NOT NULL,' +
      '"payload" jsonb NOT NULL,' +
      '"version" integer NOT NULL,' +
      '"updatedBy" uuid NOT NULL,' +
      '"isActive" boolean NOT NULL DEFAULT true' +
      ')'
    );
    await queryRunner.query('CREATE UNIQUE INDEX "uq_settings_direct_version" ON "settings_direct_config" ("tenant_id","screenId","configKey","version")');
    await queryRunner.query('CREATE UNIQUE INDEX "uq_settings_direct_active" ON "settings_direct_config" ("tenant_id","screenId","configKey") WHERE "isActive" = true');
    await enableTenantRls(queryRunner, 'settings_direct_config');

    await queryRunner.query("CREATE TYPE settings_data_export_status_enum AS ENUM ('QUEUED','PROCESSING','READY','FAILED','CANCELLED')");
    await queryRunner.query(
      'CREATE TABLE "settings_data_export_request" (' +
      '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),' +
      '"created_at" timestamptz NOT NULL DEFAULT now(),' +
      '"updated_at" timestamptz NOT NULL DEFAULT now(),' +
      '"tenant_id" uuid NOT NULL,' +
      '"requestedBy" uuid NOT NULL,' +
      '"scope" varchar(32) NOT NULL,' +
      '"modules" jsonb,' +
      '"fromDate" date,' +
      '"toDate" date,' +
      '"reason" text NOT NULL,' +
      '"status" settings_data_export_status_enum NOT NULL DEFAULT \\'QUEUED\\',' +
      '"idempotencyKey" varchar(128),' +
      '"failureReason" text,' +
      '"secureDownloadReference" text' +
      ')'
    );
    await queryRunner.query('CREATE INDEX "idx_settings_export_status" ON "settings_data_export_request" ("tenant_id","status")');
    await queryRunner.query('CREATE UNIQUE INDEX "uq_settings_export_idempotency" ON "settings_data_export_request" ("tenant_id","idempotencyKey") WHERE "idempotencyKey" IS NOT NULL');
    await enableTenantRls(queryRunner, 'settings_data_export_request');

    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" ADD COLUMN "permissionLevel" varchar(32)');
    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" ADD COLUMN "effectiveFrom" date');
    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" ADD COLUMN "effectiveTo" date');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" DROP COLUMN IF EXISTS "effectiveTo"');
    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" DROP COLUMN IF EXISTS "effectiveFrom"');
    await queryRunner.query('ALTER TABLE "settings_user_branch_assignment" DROP COLUMN IF EXISTS "permissionLevel"');
    await queryRunner.query('DROP TABLE "settings_data_export_request"');
    await queryRunner.query('DROP TYPE settings_data_export_status_enum');
    await queryRunner.query('DROP TABLE "settings_direct_config"');
    await queryRunner.query('DROP TABLE "settings_governed_config"');
    await queryRunner.query('DROP TYPE settings_governed_action_enum');
    await queryRunner.query('DROP TYPE settings_governed_status_enum');
  }
}
