import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PHASE 2.2 — PHASE-1 IMPLEMENTATION / PRIORITY #1 v1.2 — SECURITY /
 * SPEC-CONFORMANCE CORRECTION PASS. Additive, non-destructive schema changes
 * only — the original Priority1AuthRegistrationOnboarding migration is left
 * untouched (never silently rewritten) since this correction pass reopens
 * Priority #1's own prior IMPLEMENTATION, not the frozen spec text itself.
 *
 *  - item 5: `fpo_registration`'s Step 1-4 business columns become nullable
 *    so a DRAFT can genuinely hold incomplete data.
 *  - item 6: `registration_resume_token` — secure Save-&-Exit/resume.
 *  - item 7: `otp_verification.subjectId` — OTP subject-binding.
 *  - item 1: `sessionId` on both refresh-token tables, linking each row to
 *    its Redis session (see SessionStorePort) — bookkeeping only, never a
 *    second "is this session active" truth.
 *  - item 14: partial unique indexes on `fpo_registration.pan` / `.cin`,
 *    scoped to POST-SUBMISSION statuses only, so two concurrent submissions
 *    of two different draft registrations sharing a PAN/CIN cannot both
 *    reach SUBMITTED — the actual DB-level race-safety backstop behind
 *    RegistrationService's own pre-check.
 */
export class Priority1CorrectionPass1759400000000 implements MigrationInterface {
  name = 'Priority1CorrectionPass1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------
    // item 5 — nullable draft columns
    // ---------------------------------------------------------------
    const nullableColumns = [
      'fpoName', 'cin', 'registrationNumber', 'incorporationDate', 'pan',
      'chairmanName', 'ceoName', 'authorisedPersonName',
      'registeredAddress', 'state', 'district', 'pincode', 'officialMobile', 'officialEmail',
      'bankName', 'bankAccountNumber', 'bankIfsc',
    ];
    for (const column of nullableColumns) {
      await queryRunner.query(`ALTER TABLE "fpo_registration" ALTER COLUMN "${column}" DROP NOT NULL`);
    }

    // ---------------------------------------------------------------
    // item 14 — race-safe duplicate PAN/CIN (post-submission only)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_fpo_registration_pan_post_submit" ON "fpo_registration" ("pan")
      WHERE "status" IN ('SUBMITTED', 'UNDER_VERIFICATION', 'APPROVED', 'ACTIVE')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_fpo_registration_cin_post_submit" ON "fpo_registration" ("cin")
      WHERE "status" IN ('SUBMITTED', 'UNDER_VERIFICATION', 'APPROVED', 'ACTIVE')
    `);

    // ---------------------------------------------------------------
    // item 6 — registration_resume_token (platform-level, no RLS — see entity doc)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "registration_resume_token" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "registrationId" uuid NOT NULL REFERENCES "fpo_registration"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_registration_resume_token_registration_id" ON "registration_resume_token" ("registrationId")`);

    // ---------------------------------------------------------------
    // item 7 — OTP subject-binding
    // ---------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "otp_verification" ADD COLUMN "subjectId" varchar(128)`);
    await queryRunner.query(`CREATE INDEX "idx_otp_verification_subject_id" ON "otp_verification" ("subjectId")`);

    // ---------------------------------------------------------------
    // item 1 — sessionId linking refresh-token rows to their Redis session
    // ---------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "user_refresh_token" ADD COLUMN "sessionId" uuid`);
    await queryRunner.query(`CREATE INDEX "idx_user_refresh_token_session_id" ON "user_refresh_token" ("sessionId")`);
    await queryRunner.query(`ALTER TABLE "platform_admin_refresh_token" ADD COLUMN "sessionId" uuid`);
    await queryRunner.query(`CREATE INDEX "idx_platform_admin_refresh_token_session_id" ON "platform_admin_refresh_token" ("sessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_platform_admin_refresh_token_session_id"`);
    await queryRunner.query(`ALTER TABLE "platform_admin_refresh_token" DROP COLUMN IF EXISTS "sessionId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_refresh_token_session_id"`);
    await queryRunner.query(`ALTER TABLE "user_refresh_token" DROP COLUMN IF EXISTS "sessionId"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_otp_verification_subject_id"`);
    await queryRunner.query(`ALTER TABLE "otp_verification" DROP COLUMN IF EXISTS "subjectId"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "registration_resume_token"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fpo_registration_cin_post_submit"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fpo_registration_pan_post_submit"`);

    const nullableColumns = [
      'fpoName', 'cin', 'registrationNumber', 'incorporationDate', 'pan',
      'chairmanName', 'ceoName', 'authorisedPersonName',
      'registeredAddress', 'state', 'district', 'pincode', 'officialMobile', 'officialEmail',
      'bankName', 'bankAccountNumber', 'bankIfsc',
    ];
    for (const column of nullableColumns) {
      await queryRunner.query(`ALTER TABLE "fpo_registration" ALTER COLUMN "${column}" SET NOT NULL`);
    }
  }
}
