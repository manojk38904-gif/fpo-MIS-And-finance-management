import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { EMAIL_DELIVERY_PORT, type EmailDeliveryPort } from '../../../common/delivery/email-delivery.port.js';
import { PasswordHasher } from '../../../common/security/password-hasher.js';
import { PASSWORD_POLICY_PORT, type PasswordPolicyPort } from '../../../common/security/password-policy.port.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { UserAccountEntity, UserAccountStatus } from '../../priority1-auth-registration/entities/user-account.entity.js';
import { StaffSetupTokenEntity } from '../entities/staff-setup-token.entity.js';

@Injectable()
export class StaffSetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
    private readonly secretHasher: SecretTokenHasher,
    private readonly passwordHasher: PasswordHasher,
    private readonly config: ConfigService,
    @Inject(PASSWORD_POLICY_PORT) private readonly passwordPolicy: PasswordPolicyPort,
    @Inject(EMAIL_DELIVERY_PORT) private readonly email: EmailDeliveryPort,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async issue(tenantId: string, userId: string, actorUserId: string): Promise<{ issued: boolean; reason?: string }> {
    const user = await this.knownTenantTx.run(tenantId, (manager) =>
      manager.getRepository(UserAccountEntity).findOne({ where: { id: userId, tenantId } }),
    );
    if (!user) throw new NotFoundException('User not found.');
    if (user.status !== UserAccountStatus.PENDING_SETUP) {
      throw new BadRequestException('Setup link can only be issued for a user awaiting credential setup.');
    }
    if (!user.email || user.email.endsWith('@pending-setup.invalid')) {
      return { issued: false, reason: 'User has no deliverable email address. Add an email and re-issue setup.' };
    }

    const repo = this.dataSource.getRepository(StaffSetupTokenEntity);
    await repo.createQueryBuilder()
      .update(StaffSetupTokenEntity)
      .set({ usedAt: new Date() })
      .where('"tenantId" = :tenantId AND "userId" = :userId AND "usedAt" IS NULL', { tenantId, userId })
      .execute();

    const rawToken = this.secretHasher.generateOpaqueSecret();
    const expiryHours = this.config.get<number>('setupLink.expiryHours') ?? 72;
    await repo.save(repo.create({
      tenantId,
      userId,
      tokenHash: this.secretHasher.hash(rawToken),
      expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000),
      usedAt: null,
    }));

    await this.email.send({
      to: user.email,
      template: 'STAFF_USER_SETUP_LINK',
      data: { setupLinkToken: rawToken },
    });
    await this.audit.record({
      eventType: 'settings.user.setup_link_issued',
      tenantId,
      actorUserId,
      subjectId: userId,
      metadata: {},
    });
    return { issued: true };
  }

  async setupPassword(rawToken: string, newPassword: string, confirmNewPassword: string): Promise<void> {
    if (newPassword !== confirmNewPassword) throw new BadRequestException('New password and confirmation do not match.');
    await this.passwordPolicy.assertValid(newPassword);

    const repo = this.dataSource.getRepository(StaffSetupTokenEntity);
    const tokenHash = this.secretHasher.hash(rawToken);
    const record = await repo.findOne({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This staff setup link is no longer valid. Please ask your FPO Admin to re-issue it.');
    }

    const cas = await repo.createQueryBuilder()
      .update(StaffSetupTokenEntity)
      .set({ usedAt: new Date() })
      .where('"id" = :id AND "usedAt" IS NULL AND "expiresAt" > now()', { id: record.id })
      .execute();
    if (cas.affected !== 1) {
      throw new BadRequestException('This staff setup link is no longer valid. Please ask your FPO Admin to re-issue it.');
    }

    await this.knownTenantTx.run(record.tenantId, async (manager) => {
      const users = manager.getRepository(UserAccountEntity);
      const user = await users.findOne({ where: { id: record.userId, tenantId: record.tenantId } });
      if (!user || user.status !== UserAccountStatus.PENDING_SETUP) {
        throw new BadRequestException('This staff setup link is no longer valid.');
      }
      user.passwordHash = await this.passwordHasher.hash(newPassword);
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.status = UserAccountStatus.ACTIVE;
      await users.save(user);
    });

    await this.audit.record({
      eventType: 'settings.user.password_setup_completed',
      tenantId: record.tenantId,
      actorUserId: record.userId,
      subjectId: record.userId,
      metadata: {},
    });
  }
}
