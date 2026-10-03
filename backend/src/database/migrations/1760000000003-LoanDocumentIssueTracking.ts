import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LoanDocumentIssueTracking1760000000003 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query('ALTER TABLE "loan_application" ADD COLUMN "sanction_letter_issued_at" timestamptz');
  }

  async down(q: QueryRunner) {
    await q.query('ALTER TABLE "loan_application" DROP COLUMN IF EXISTS "sanction_letter_issued_at"');
  }
}
