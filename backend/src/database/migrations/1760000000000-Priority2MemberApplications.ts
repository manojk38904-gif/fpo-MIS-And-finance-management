import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls, disableTenantRls } from '../tenant-rls.util.js';

export class Priority2MemberApplications1760000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "member_application_status_enum" AS ENUM ('PENDING','APPROVED','REJECTED')`);
    await queryRunner.query(`
      CREATE TABLE "member_application" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL, "application_number" varchar(32) NOT NULL, "full_name" varchar(255) NOT NULL, "mobile" varchar(10) NOT NULL,
        "email" varchar(255), "aadhaar_last4" varchar(4), "pan" varchar(10), "date_of_birth" date, "gender" varchar(16),
        "address" text NOT NULL, "village" varchar(128) NOT NULL, "district" varchar(128) NOT NULL, "state" varchar(128) NOT NULL, "pincode" varchar(6) NOT NULL,
        "land_holding_acres" numeric(10,2), "share_quantity" integer NOT NULL, "share_amount" numeric(12,2) NOT NULL,
        "status" "member_application_status_enum" NOT NULL DEFAULT 'PENDING', "member_number" varchar(48), "identity_card_number" varchar(48),
        "reviewed_by_user_id" uuid, "reviewed_at" timestamptz, "decision_note" text
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_member_application_tenant_number" ON "member_application" ("tenant_id", "application_number")`);
    await queryRunner.query(`CREATE INDEX "idx_member_application_tenant_mobile" ON "member_application" ("tenant_id", "mobile")`);
    await queryRunner.query(`CREATE INDEX "idx_member_application_status" ON "member_application" ("status")`);
    await enableTenantRls(queryRunner, 'member_application');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await disableTenantRls(queryRunner, 'member_application');
    await queryRunner.query(`DROP TABLE IF EXISTS "member_application"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "member_application_status_enum"`);
  }
}
