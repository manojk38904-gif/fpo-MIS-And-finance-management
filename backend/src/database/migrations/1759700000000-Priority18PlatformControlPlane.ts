import { MigrationInterface, QueryRunner } from 'typeorm';

export class Priority18PlatformControlPlane1759700000000 implements MigrationInterface {
  name = 'Priority18PlatformControlPlane1759700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE platform_admin_role_enum AS ENUM ('SUPER_ADMIN','SUPPORT_ADMIN')");
    await queryRunner.query("ALTER TABLE \"platform_admin_account\" ADD COLUMN \"role\" platform_admin_role_enum NOT NULL DEFAULT 'SUPER_ADMIN'");
    await queryRunner.query("ALTER TABLE \"platform_admin_account\" ADD COLUMN \"lastLoginAt\" timestamptz");

    await queryRunner.query("CREATE TYPE subscription_plan_status_enum AS ENUM ('ACTIVE','INACTIVE','SUPERSEDED')");
    await queryRunner.query("CREATE TABLE \"subscription_plan\" (\"id\" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\"planCode\" varchar(64) NOT NULL,\"planName\" varchar(128) NOT NULL,\"limits\" jsonb NOT NULL,\"features\" jsonb NOT NULL,\"effectiveDate\" date NOT NULL,\"version\" integer NOT NULL,\"status\" subscription_plan_status_enum NOT NULL DEFAULT 'ACTIVE',\"changedBy\" uuid NOT NULL,\"reason\" text NOT NULL,\"createdAt\" timestamptz NOT NULL DEFAULT now())");
    await queryRunner.query("CREATE UNIQUE INDEX \"uq_subscription_plan_code_version\" ON \"subscription_plan\" (\"planCode\",\"version\")");
    await queryRunner.query("CREATE INDEX \"idx_subscription_plan_code\" ON \"subscription_plan\" (\"planCode\")");
    await queryRunner.query("CREATE INDEX \"idx_subscription_plan_status\" ON \"subscription_plan\" (\"status\")");

    await queryRunner.query("CREATE TYPE tenant_subscription_state_enum AS ENUM ('ACTIVE','NEARING_EXPIRY','GRACE','EXPIRED_READ_ONLY','SUSPENDED','REACTIVATED')");
    await queryRunner.query("CREATE TABLE \"tenant_subscription\" (\"id\" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\"tenantId\" uuid NOT NULL,\"planVersionId\" uuid NOT NULL REFERENCES \"subscription_plan\"(\"id\"),\"startDate\" date NOT NULL,\"expiryDate\" date NOT NULL,\"state\" tenant_subscription_state_enum NOT NULL,\"gracePeriodDays\" integer NOT NULL,\"usageSnapshot\" jsonb,\"changedBy\" uuid NOT NULL,\"reason\" text NOT NULL,\"supersedesId\" uuid,\"suspendedAt\" timestamptz,\"reactivatedAt\" timestamptz,\"createdAt\" timestamptz NOT NULL DEFAULT now(),\"updatedAt\" timestamptz NOT NULL DEFAULT now())");
    await queryRunner.query("CREATE INDEX \"idx_tenant_subscription_tenant\" ON \"tenant_subscription\" (\"tenantId\",\"createdAt\")");
    await queryRunner.query("CREATE INDEX \"idx_tenant_subscription_state\" ON \"tenant_subscription\" (\"state\")");

    await queryRunner.query("CREATE TABLE \"platform_configuration\" (\"key\" varchar(64) PRIMARY KEY,\"value\" jsonb NOT NULL,\"updatedBy\" uuid NOT NULL,\"reason\" text NOT NULL,\"updatedAt\" timestamptz NOT NULL DEFAULT now())");

    await queryRunner.query("CREATE TYPE support_access_status_enum AS ENUM ('PENDING_TENANT_CONSENT','DENIED','ACTIVE','EXPIRED','REVOKED')");
    await queryRunner.query("CREATE TABLE \"support_access_request\" (\"id\" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\"tenantId\" uuid NOT NULL,\"requestingAdminId\" uuid NOT NULL,\"reason\" text NOT NULL,\"ticketContext\" varchar(128) NOT NULL,\"requestedDurationMinutes\" integer NOT NULL,\"status\" support_access_status_enum NOT NULL DEFAULT 'PENDING_TENANT_CONSENT',\"idempotencyKey\" varchar(128),\"consentedByTenantUserId\" uuid,\"consentedAt\" timestamptz,\"startedAt\" timestamptz,\"endsAt\" timestamptz,\"revokedAt\" timestamptz,\"viewedModuleSummary\" jsonb,\"createdAt\" timestamptz NOT NULL DEFAULT now(),\"updatedAt\" timestamptz NOT NULL DEFAULT now())");
    await queryRunner.query("CREATE INDEX \"idx_support_access_tenant\" ON \"support_access_request\" (\"tenantId\")");
    await queryRunner.query("CREATE INDEX \"idx_support_access_admin\" ON \"support_access_request\" (\"requestingAdminId\")");
    await queryRunner.query("CREATE INDEX \"idx_support_access_status\" ON \"support_access_request\" (\"status\")");
    await queryRunner.query("CREATE UNIQUE INDEX \"uq_support_access_idempotency\" ON \"support_access_request\" (\"requestingAdminId\",\"idempotencyKey\") WHERE \"idempotencyKey\" IS NOT NULL");

    await queryRunner.query("CREATE TYPE platform_admin_recovery_status_enum AS ENUM ('PENDING_APPROVALS','APPROVED','REJECTED','EXPIRED','COMPLETED')");
    await queryRunner.query("CREATE TABLE \"platform_admin_recovery_request\" (\"id\" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\"targetAdminId\" uuid NOT NULL,\"requesterAdminId\" uuid NOT NULL,\"reason\" text NOT NULL,\"status\" platform_admin_recovery_status_enum NOT NULL DEFAULT 'PENDING_APPROVALS',\"expiresAt\" timestamptz NOT NULL,\"approvedAt\" timestamptz,\"completedAt\" timestamptz,\"createdAt\" timestamptz NOT NULL DEFAULT now())");
    await queryRunner.query("CREATE INDEX \"idx_platform_recovery_target\" ON \"platform_admin_recovery_request\" (\"targetAdminId\")");
    await queryRunner.query("CREATE INDEX \"idx_platform_recovery_status\" ON \"platform_admin_recovery_request\" (\"status\")");

    await queryRunner.query("CREATE TABLE \"platform_admin_recovery_approval\" (\"id\" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\"requestId\" uuid NOT NULL REFERENCES \"platform_admin_recovery_request\"(\"id\") ON DELETE CASCADE,\"approverAdminId\" uuid NOT NULL,\"approved\" boolean NOT NULL,\"reason\" text NOT NULL,\"createdAt\" timestamptz NOT NULL DEFAULT now(), CONSTRAINT \"uq_platform_recovery_approval\" UNIQUE (\"requestId\",\"approverAdminId\"))");
    await queryRunner.query("CREATE INDEX \"idx_platform_recovery_approval_request\" ON \"platform_admin_recovery_approval\" (\"requestId\")");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "platform_admin_recovery_approval"');
    await queryRunner.query('DROP TABLE "platform_admin_recovery_request"');
    await queryRunner.query('DROP TYPE platform_admin_recovery_status_enum');
    await queryRunner.query('DROP TABLE "support_access_request"');
    await queryRunner.query('DROP TYPE support_access_status_enum');
    await queryRunner.query('DROP TABLE "platform_configuration"');
    await queryRunner.query('DROP TABLE "tenant_subscription"');
    await queryRunner.query('DROP TYPE tenant_subscription_state_enum');
    await queryRunner.query('DROP TABLE "subscription_plan"');
    await queryRunner.query('DROP TYPE subscription_plan_status_enum');
    await queryRunner.query('ALTER TABLE "platform_admin_account" DROP COLUMN "lastLoginAt"');
    await queryRunner.query('ALTER TABLE "platform_admin_account" DROP COLUMN "role"');
    await queryRunner.query('DROP TYPE platform_admin_role_enum');
  }
}
