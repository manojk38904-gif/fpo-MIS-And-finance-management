import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MemberPhotoAndShareCertificate1760000000001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "member_application" ADD COLUMN "photo_data" bytea, ADD COLUMN "photo_mime_type" varchar(32), ADD COLUMN "share_certificate_number" varchar(48), ADD COLUMN "folio_number" varchar(48), ADD COLUMN "distinctive_from" varchar(48), ADD COLUMN "distinctive_to" varchar(48), ADD COLUMN "board_resolution_ref" varchar(255), ADD COLUMN "share_certificate_issued_at" timestamptz`);
    await q.query(`CREATE UNIQUE INDEX "uq_member_share_certificate" ON "member_application" ("tenant_id", "share_certificate_number") WHERE "share_certificate_number" IS NOT NULL`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_member_share_certificate"`);
    await q.query(`ALTER TABLE "member_application" DROP COLUMN IF EXISTS "photo_data", DROP COLUMN IF EXISTS "photo_mime_type", DROP COLUMN IF EXISTS "share_certificate_number", DROP COLUMN IF EXISTS "folio_number", DROP COLUMN IF EXISTS "distinctive_from", DROP COLUMN IF EXISTS "distinctive_to", DROP COLUMN IF EXISTS "board_resolution_ref", DROP COLUMN IF EXISTS "share_certificate_issued_at"`);
  }
}
