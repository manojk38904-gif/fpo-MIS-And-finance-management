import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { EMAIL_DELIVERY_PORT } from '../../../common/delivery/email-delivery.port.js';
import type { EmailDeliveryPort } from '../../../common/delivery/email-delivery.port.js';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../entities/user-account.entity.js';
import { SetupTokenEntity } from '../entities/setup-token.entity.js';
import { FPO_CODE_GENERATOR_PORT } from './fpo-code-generator.port.js';
import type { FpoCodeGeneratorPort } from './fpo-code-generator.port.js';

/**
 * This is the exact, narrow hook that SYS-02's own frozen spec text
 * describes as happening "right after" the Super-Admin's Approval action
 * (SA-01): FPO-Code generation, and (per SYS-05/CA-1) Initial-Admin-user
 * creation + secure single-use setup-link issuance.
 *
 * SA-01 itself — the Platform Super-Admin's approval SCREEN/UI and the
 * decision of whether to approve or reject an application — is Priority
 * #18's own, out of this task's scope. This service is deliberately NOT
 * exposed as a public HTTP endpoint — doing so would itself BE SA-01's
 * approval action.
 *
 * Correction-pass item 3 — APPROVAL OWNERSHIP. This hook now accepts ONLY an
 * application already in status APPROVED. It previously accepted SUBMITTED
 * or UNDER_VERIFICATION directly, which let Priority #1's own code perform
 * SA-01's approval decision itself — a genuine Priority #18 ownership
 * violation. SA-01 (once built) is responsible for moving an application
 * SUBMITTED/UNDER_VERIFICATION → APPROVED (or REJECTED); only once that has
 * already happened does this hook do anything.
 *
 * Correction-pass item 4 — FPO-Code generation is delegated to
 * FPO_CODE_GENERATOR_PORT, never computed inline. The production binding
 * (NotImplementedFpoCodeGeneratorAdapter) correctly BLOCKS activation until
 * the real Master-SRS Numbering Engine exists — this service makes no
 * algorithmic decision of its own.
 */
@Injectable()
export class TenantActivationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
    private readonly hasher: SecretTokenHasher,
    private readonly config: ConfigService,
    @Inject(FPO_CODE_GENERATOR_PORT) private readonly fpoCodeGenerator: FpoCodeGeneratorPort,
    @Inject(EMAIL_DELIVERY_PORT) private readonly emailDelivery: EmailDeliveryPort,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async activateApprovedRegistration(registrationId: string): Promise<{ fpoCode: string; setupLinkToken: string }> {
    const regRepo = this.dataSource.getRepository(FpoRegistrationEntity);
    const reg = await regRepo.findOne({ where: { id: registrationId } });
    if (!reg) throw new BadRequestException('Registration not found.');

    // Item 3 — APPROVED only. SUBMITTED/UNDER_VERIFICATION/REJECTED are all
    // explicitly rejected here; this is not this service's decision to make.
    if (reg.status !== FpoRegistrationStatus.APPROVED) {
      throw new BadRequestException(
        `Only an APPROVED application can be activated (current status: ${reg.status}). ` +
          'Approval is Priority #18 SA-01\'s own decision, not this hook\'s.',
      );
    }

    const fpoCode = await this.fpoCodeGenerator.generate(reg.fpoName ?? 'FPO', reg.id);
    const now = new Date();

    reg.status = FpoRegistrationStatus.ACTIVE;
    reg.fpoCode = fpoCode;
    reg.activatedAt = now;
    await regRepo.save(reg);

    const tenantId = reg.id;
    const setupLinkToken = this.hasher.generateOpaqueSecret();
    const expiryHours = this.config.get<number>('setupLink.expiryHours') ?? 72;

    // Activation writes the FIRST tenant-scoped row (user_account) for this
    // tenant. There is no authenticated HTTP request/guard-verified identity
    // yet (this is a system-triggered operation), so it cannot go through
    // TenantAwareTransactionRunner (the per-REQUEST path) — it uses
    // KnownTenantTransactionRunner instead, since tenantId is already,
    // independently known here (it is literally this operation's own
    // subject). setup_token itself is not RLS-protected (see its entity doc)
    // but is written in the same transaction for atomicity.
    await this.knownTenantTx.run(tenantId, async (manager) => {
      const userRepo = manager.getRepository(UserAccountEntity);
      const admin = userRepo.create({
        tenantId,
        username: reg.officialEmail!,
        email: reg.officialEmail!,
        mobile: reg.officialMobile,
        passwordHash: null,
        isInitialFpoAdmin: true,
        status: UserAccountStatus.PENDING_SETUP,
      });
      const savedAdmin = await userRepo.save(admin);

      const tokenRepo = manager.getRepository(SetupTokenEntity);
      await tokenRepo.save(
        tokenRepo.create({
          tenantId,
          userId: savedAdmin.id,
          tokenHash: this.hasher.hash(setupLinkToken),
          expiresAt: new Date(now.getTime() + expiryHours * 60 * 60 * 1000),
          usedAt: null,
        }),
      );
    });

    await this.audit.record({ eventType: 'tenant.activated', tenantId, subjectId: reg.id, metadata: { fpoCode } });
    await this.audit.record({ eventType: 'setup_token.issued', tenantId, metadata: {} });

    // Activation communication (SYS-02): FPO-Code shown prominently; a
    // secure setup-link is sent — never a plaintext/system-generated
    // password (CA-1, non-negotiable). Delivery goes through
    // EMAIL_DELIVERY_PORT (item 9) — never a direct provider call from
    // business logic. The raw link/token is still returned to the caller
    // (today a test, eventually SA-01) for it to decide whether/where else
    // to surface it, but it is never logged.
    const appUrl = this.config.get<string>('PUBLIC_APP_URL') ?? 'https://fpo-mis-app.onrender.com';
    const setupUrl = `${appUrl}/?fpoSetupToken=${encodeURIComponent(setupLinkToken)}`;
    await this.emailDelivery.send({
      to: reg.officialEmail!,
      template: 'TENANT_ACTIVATED',
      data: { fpoCode },
    });
    await this.emailDelivery.send({
      to: reg.officialEmail!,
      template: 'INITIAL_ADMIN_SETUP_LINK',
      data: { setupUrl },
    });

    return { fpoCode, setupLinkToken };
  }

  async reissueInitialAdminSetup(registrationId: string): Promise<void> {
    const reg = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: registrationId } });
    if (!reg || reg.status !== FpoRegistrationStatus.ACTIVE || !reg.fpoCode || !reg.officialEmail) {
      throw new BadRequestException('Only an active FPO with an official email can receive a setup link.');
    }

    const setupLinkToken = this.hasher.generateOpaqueSecret();
    const expiryHours = this.config.get<number>('setupLink.expiryHours') ?? 72;
    await this.knownTenantTx.run(reg.id, async (manager) => {
      const userRepo = manager.getRepository(UserAccountEntity);
      const admin = await userRepo.findOne({ where: { tenantId: reg.id, isInitialFpoAdmin: true } });
      if (!admin) throw new BadRequestException('Initial FPO Admin account was not found.');
      if (admin.passwordHash) throw new ConflictException('The FPO Admin password has already been set.');

      const tokenRepo = manager.getRepository(SetupTokenEntity);
      await tokenRepo.delete({ tenantId: reg.id });
      await tokenRepo.save(tokenRepo.create({
        tenantId: reg.id,
        userId: admin.id,
        tokenHash: this.hasher.hash(setupLinkToken),
        expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000),
        usedAt: null,
      }));
    });

    const appUrl = this.config.get<string>('PUBLIC_APP_URL') ?? 'https://fpo-mis-app.onrender.com';
    await this.emailDelivery.send({
      to: reg.officialEmail,
      template: 'INITIAL_ADMIN_SETUP_LINK',
      data: { setupUrl: `${appUrl}/?fpoSetupToken=${encodeURIComponent(setupLinkToken)}` },
    });
    await this.audit.record({ eventType: 'setup_token.reissued', tenantId: reg.id, subjectId: reg.id, metadata: {} });
  }
}
