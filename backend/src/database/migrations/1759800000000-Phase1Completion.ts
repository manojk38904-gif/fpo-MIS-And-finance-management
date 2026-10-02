import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase1Completion1759800000000 implements MigrationInterface {
  name = 'Phase1Completion1759800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "platform_number_sequence" ("sequenceKey" varchar(64) PRIMARY KEY,"nextValue" bigint NOT NULL,"updatedAt" timestamptz NOT NULL DEFAULT now())',
    );
    await queryRunner.query(
      'CREATE TABLE "settings_staff_setup_token" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"tenantId" uuid NOT NULL,"userId" uuid NOT NULL,"tokenHash" varchar(64) NOT NULL UNIQUE,"expiresAt" timestamptz NOT NULL,"usedAt" timestamptz,"createdAt" timestamptz NOT NULL DEFAULT now())',
    );
    await queryRunner.query('CREATE INDEX "idx_staff_setup_tenant" ON "settings_staff_setup_token" ("tenantId")');
    await queryRunner.query('CREATE INDEX "idx_staff_setup_user" ON "settings_staff_setup_token" ("userId")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "settings_staff_setup_token"');
    await queryRunner.query('DROP TABLE "platform_number_sequence"');
  }
}
