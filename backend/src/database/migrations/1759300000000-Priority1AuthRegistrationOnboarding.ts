import { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRls, disableTenantRls } from '../tenant-rls.util.js';

/**
 * Priority #1 v1.2 — AUTH / REGISTRATION / ONBOARDING schema. First physical
 * schema created in this codebase (Phase-1 foundation shipped no business
 * tables). Only the tables genuinely required by Priority #1's frozen scope
 * (kickoff instruction #14) — no Priority #2-#18 business tables.
 *
 * RLS is enabled ONLY on the two genuinely tenant-scoped, per-request-path
 * tables (`user_account`, `onboarding_step_progress`). Every other table here
 * is platform-level or a lookup-by-secret-hash table and is deliberately left
 * WITHOUT RLS, per the architectural reasoning documented in each entity's
 * own doc-comment (fpo_registration, fpo_registration_document,
 * otp_verification, setup_token, user_refresh_token,
 * platform_admin_account, platform_admin_refresh_token).
 */
export class Priority1AuthRegistrationOnboarding1759300000000 implements MigrationInterface {
  name = 'Priority1AuthRegistrationOnboarding1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Required for PrimaryGeneratedColumn('uuid') defaults used elsewhere in
    // this codebase's test-only raw SQL; migrations here generate UUIDs via
    // TypeORM's uuid-ossp-independent default (application-side uuid()) is
    // NOT used — PrimaryGeneratedColumn('uuid') relies on Postgres's own
    // gen_random_uuid(), available via pgcrypto since PG13+, or natively in
    // PG15+ (Master SRS §4.1 frozen minimum).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ---------------------------------------------------------------
    // fpo_registration (platform-level, no RLS)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "fpo_registration_status_enum" AS ENUM (
        'DRAFT', 'OTP_VERIFIED', 'SUBMITTED', 'UNDER_VERIFICATION', 'APPROVED', 'REJECTED', 'ACTIVE'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "fpo_registration" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "fpoName" varchar(255) NOT NULL,
        "cin" varchar(64) NOT NULL,
        "registrationNumber" varchar(64) NOT NULL,
        "incorporationDate" date NOT NULL,
        "pan" varchar(10) NOT NULL,
        "gstin" varchar(15),
        "chairmanName" varchar(255) NOT NULL,
        "ceoName" varchar(255) NOT NULL,
        "authorisedPersonName" varchar(255) NOT NULL,
        "registeredAddress" text NOT NULL,
        "state" varchar(128) NOT NULL,
        "district" varchar(128) NOT NULL,
        "pincode" varchar(10) NOT NULL,
        "officialMobile" varchar(10) NOT NULL,
        "officialEmail" varchar(255) NOT NULL,
        "website" varchar(255),
        "bankName" varchar(255) NOT NULL,
        "bankAccountNumber" varchar(34) NOT NULL,
        "bankIfsc" varchar(11) NOT NULL,
        "termsAccepted" boolean NOT NULL DEFAULT false,
        "status" "fpo_registration_status_enum" NOT NULL DEFAULT 'DRAFT',
        "emailOtpVerified" boolean NOT NULL DEFAULT false,
        "fpoCode" varchar(32) UNIQUE,
        "submittedAt" timestamptz,
        "activatedAt" timestamptz,
        "liveAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_fpo_registration_cin" ON "fpo_registration" ("cin")`);
    await queryRunner.query(`CREATE INDEX "idx_fpo_registration_pan" ON "fpo_registration" ("pan")`);
    await queryRunner.query(`CREATE INDEX "idx_fpo_registration_official_email" ON "fpo_registration" ("officialEmail")`);
    await queryRunner.query(`CREATE INDEX "idx_fpo_registration_status" ON "fpo_registration" ("status")`);

    // ---------------------------------------------------------------
    // fpo_registration_document (platform-level, no RLS)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "fpo_registration_document_type_enum" AS ENUM (
        'REGISTRATION_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'PAN_UPLOAD', 'GST_DOCUMENT', 'LOGO_UPLOAD'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "fpo_registration_document" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "registrationId" uuid NOT NULL REFERENCES "fpo_registration"("id") ON DELETE CASCADE,
        "documentType" "fpo_registration_document_type_enum" NOT NULL,
        "fileKey" varchar(512) NOT NULL,
        "originalFileName" varchar(255) NOT NULL,
        "mimeType" varchar(100) NOT NULL,
        "sizeBytes" integer NOT NULL,
        "uploadedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_fpo_registration_document_registration_id" ON "fpo_registration_document" ("registrationId")`);

    // ---------------------------------------------------------------
    // otp_verification (platform-level, no RLS — see entity doc-comment)
    // ---------------------------------------------------------------
    await queryRunner.query(`CREATE TYPE "otp_purpose_enum" AS ENUM ('REGISTRATION', 'PASSWORD_RESET')`);
    await queryRunner.query(`
      CREATE TABLE "otp_verification" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid,
        "identifier" varchar(255) NOT NULL,
        "purpose" "otp_purpose_enum" NOT NULL,
        "otpHash" varchar(64) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "resendAvailableAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_otp_verification_tenant_id" ON "otp_verification" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "idx_otp_verification_identifier" ON "otp_verification" ("identifier")`);

    // ---------------------------------------------------------------
    // user_account (TENANT-SCOPED, RLS ENFORCED)
    // ---------------------------------------------------------------
    await queryRunner.query(`CREATE TYPE "user_account_status_enum" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'LOCKED', 'SUSPENDED')`);
    await queryRunner.query(`
      CREATE TABLE "user_account" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "username" varchar(128) NOT NULL,
        "email" varchar(255) NOT NULL,
        "mobile" varchar(10),
        "passwordHash" varchar(255),
        "isInitialFpoAdmin" boolean NOT NULL DEFAULT false,
        "status" "user_account_status_enum" NOT NULL DEFAULT 'PENDING_SETUP',
        "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        "lockedUntil" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_user_account_tenant_id" ON "user_account" ("tenant_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_user_account_tenant_username" ON "user_account" ("tenant_id", "username")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_user_account_tenant_email" ON "user_account" ("tenant_id", "email")`);
    await enableTenantRls(queryRunner, 'user_account');

    // ---------------------------------------------------------------
    // setup_token (platform-level, NO RLS — lookup-by-secret-hash; see entity doc-comment)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "setup_token" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "userId" uuid NOT NULL REFERENCES "user_account"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_setup_token_tenant_id" ON "setup_token" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "idx_setup_token_user_id" ON "setup_token" ("userId")`);

    // ---------------------------------------------------------------
    // user_refresh_token (platform-level, NO RLS — lookup-by-secret-hash; see entity doc-comment)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "user_refresh_token" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "userId" uuid NOT NULL REFERENCES "user_account"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "rotatedToTokenId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_user_refresh_token_tenant_id" ON "user_refresh_token" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "idx_user_refresh_token_user_id" ON "user_refresh_token" ("userId")`);

    // ---------------------------------------------------------------
    // platform_admin_account (platform-level, no RLS, separate hierarchy)
    // ---------------------------------------------------------------
    await queryRunner.query(`CREATE TYPE "platform_admin_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED')`);
    await queryRunner.query(`
      CREATE TABLE "platform_admin_account" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" varchar(128) NOT NULL UNIQUE,
        "email" varchar(255) NOT NULL UNIQUE,
        "passwordHash" varchar(255) NOT NULL,
        "totpSecret" varchar(64),
        "totpEnabled" boolean NOT NULL DEFAULT false,
        "status" "platform_admin_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        "lockedUntil" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---------------------------------------------------------------
    // platform_admin_refresh_token (platform-level, no RLS)
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "platform_admin_refresh_token" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "adminId" uuid NOT NULL REFERENCES "platform_admin_account"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "rotatedToTokenId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_platform_admin_refresh_token_admin_id" ON "platform_admin_refresh_token" ("adminId")`);

    // ---------------------------------------------------------------
    // onboarding_step_progress (TENANT-SCOPED, RLS ENFORCED)
    // ---------------------------------------------------------------
    await queryRunner.query(`CREATE TYPE "onboarding_step_status_enum" AS ENUM ('PENDING', 'CURRENT', 'COMPLETE', 'SKIPPED')`);
    await queryRunner.query(`
      CREATE TABLE "onboarding_step_progress" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "stepNumber" integer NOT NULL,
        "status" "onboarding_step_status_enum" NOT NULL DEFAULT 'PENDING',
        "completedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_onboarding_step_progress_tenant_id" ON "onboarding_step_progress" ("tenant_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_onboarding_step_progress_tenant_step" ON "onboarding_step_progress" ("tenant_id", "stepNumber")`,
    );
    await enableTenantRls(queryRunner, 'onboarding_step_progress');

    // ---------------------------------------------------------------
    // local_audit_event (platform-level, no RLS — see entity doc-comment)
    // Created here (not in a separate "shared foundation" migration) since
    // this is the first migration in the codebase and AuditEventPort/
    // AuditEventEntity are shared infrastructure, not Priority #1-only.
    // ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "local_audit_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventType" varchar(128) NOT NULL,
        "tenantId" uuid,
        "actorUserId" uuid,
        "subjectId" varchar(128),
        "metadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_local_audit_event_event_type" ON "local_audit_event" ("eventType")`);
    await queryRunner.query(`CREATE INDEX "idx_local_audit_event_tenant_id" ON "local_audit_event" ("tenantId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "local_audit_event"`);

    await disableTenantRls(queryRunner, 'onboarding_step_progress');
    await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_step_progress"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "onboarding_step_status_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "platform_admin_refresh_token"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_admin_account"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "platform_admin_status_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "user_refresh_token"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "setup_token"`);

    await disableTenantRls(queryRunner, 'user_account');
    await queryRunner.query(`DROP TABLE IF EXISTS "user_account"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_account_status_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "otp_verification"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "otp_purpose_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "fpo_registration_document"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "fpo_registration_document_type_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "fpo_registration"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "fpo_registration_status_enum"`);
  }
}
