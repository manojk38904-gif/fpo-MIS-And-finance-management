import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { FpoRegistrationEntity } from '../../priority1-auth-registration/entities/fpo-registration.entity.js';
import { UserAccountEntity } from '../../priority1-auth-registration/entities/user-account.entity.js';
import { UserBranchAssignmentEntity } from '../entities/user-branch-assignment.entity.js';
import { GovernedSettingAction, GovernedSettingEntity, GovernedSettingStatus } from '../entities/governed-setting.entity.js';
import { DirectSettingEntity } from '../entities/direct-setting.entity.js';
import { DataExportRequestEntity, DataExportStatus } from '../entities/data-export-request.entity.js';
import type {
  DataExportRequestDto,
  DirectSettingSaveDto,
  FinancialYearCreateDto,
  GovernedSettingDraftDto,
  ProfileUpdateDto,
  RetentionConfigurationDto,
} from '../dto/settings-config.dto.js';

const GOVERNED_SCREENS = new Set(['SET-05', 'SET-09', 'SET-11', 'SET-12', 'SET-13', 'SET-14', 'SET-16', 'SET-17', 'SET-21']);
const NUMBERING_TYPES = [
  'MEMBER_NO',
  'LOAN_APP_NO',
  'LOAN_ACCOUNT_NO',
  'VOUCHER',
  'RECEIPT',
  'SANCTION',
  'AGREEMENT',
  'NOC',
  'PURCHASE_SALE_INVOICE',
] as const;
const CREDIT_WEIGHT_KEYS = [
  'membershipHistory',
  'fpoBusinessHistory',
  'landholding',
  'cropIncomeCapacity',
  'bankingCapacity',
  'previousRepayment',
  'fieldVerification',
  'existingLiabilities',
] as const;
const APPROVAL_PRODUCTS = new Set(['CASH_LOAN', 'INPUT_CREDIT', 'PURCHASE_REQUISITION', 'STOCK_ADJUSTMENT', 'MANUAL_JOURNAL', 'OPENING_BALANCE', 'REVERSAL']);

@Injectable()
export class SettingsConfigService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly txRunner: TenantAwareTransactionRunner,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async getProfile(tenantId: string) {
    const reg = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: tenantId } });
    if (!reg) throw new NotFoundException('Tenant profile not found.');
    const version = await this.currentDirectVersion(tenantId, 'SET-01', 'PROFILE');
    return {
      version,
      fpoCode: reg.fpoCode,
      fpoName: reg.fpoName,
      cin: reg.cin,
      pan: reg.pan,
      gstin: reg.gstin,
      incorporationDate: reg.incorporationDate,
      registeredAddress: reg.registeredAddress,
      state: reg.state,
      district: reg.district,
      pincode: reg.pincode,
      officialMobile: reg.officialMobile,
      officialEmail: reg.officialEmail,
      website: reg.website,
    };
  }

  async updateProfile(tenantId: string, actorUserId: string, dto: ProfileUpdateDto) {
    const currentVersion = await this.currentDirectVersion(tenantId, 'SET-01', 'PROFILE');
    if (dto.expectedVersion !== currentVersion) {
      throw new ConflictException('Profile changed since it was loaded. Refresh before saving.');
    }
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const reg = await repo.findOne({ where: { id: tenantId } });
    if (!reg) throw new NotFoundException('Tenant profile not found.');

    if (dto.fpoName !== undefined) reg.fpoName = dto.fpoName;
    if (dto.gstin !== undefined) reg.gstin = dto.gstin || null;
    if (dto.registeredAddress !== undefined) reg.registeredAddress = dto.registeredAddress;
    if (dto.state !== undefined) reg.state = dto.state;
    if (dto.district !== undefined) reg.district = dto.district;
    if (dto.pincode !== undefined) reg.pincode = dto.pincode;
    if (dto.officialMobile !== undefined) reg.officialMobile = dto.officialMobile;
    if (dto.officialEmail !== undefined) reg.officialEmail = dto.officialEmail;
    if (dto.website !== undefined) reg.website = dto.website || null;

    validateProfile(reg);
    await repo.save(reg);
    const snapshot = await this.saveDirect(tenantId, actorUserId, 'SET-01', 'PROFILE', {
      fpoName: reg.fpoName,
      gstin: reg.gstin,
      registeredAddress: reg.registeredAddress,
      state: reg.state,
      district: reg.district,
      pincode: reg.pincode,
      officialMobile: reg.officialMobile,
      officialEmail: reg.officialEmail,
      website: reg.website,
    }, currentVersion);
    await this.audit.record({ eventType: 'settings.profile.updated', tenantId, actorUserId, metadata: { version: snapshot.version } });
    return this.getProfile(tenantId);
  }

  async listGoverned(tenantId: string, screenId: string) {
    this.assertGovernedScreen(screenId);
    return this.txRunner.run((manager) =>
      manager.getRepository(GovernedSettingEntity).find({ where: { tenantId, screenId }, order: { createdAt: 'DESC' } }),
    );
  }

  async createGovernedDraft(tenantId: string, actorUserId: string, screenId: string, dto: GovernedSettingDraftDto) {
    this.assertGovernedScreen(screenId);
    const action = (dto.action ?? 'UPSERT') as GovernedSettingAction;
    return this.txRunner.run(async (manager) => {
      await this.validateGovernedPayload(manager, tenantId, screenId, dto.payload, action);

      let supersedes: GovernedSettingEntity | null = null;
      if (dto.supersedesId) {
        supersedes = await manager.getRepository(GovernedSettingEntity).findOne({ where: { id: dto.supersedesId, tenantId, screenId } });
        if (!supersedes || ![GovernedSettingStatus.ACTIVE, GovernedSettingStatus.INACTIVE].includes(supersedes.status)) {
          throw new BadRequestException('supersedesId must identify the current effective version for this setting.');
        }
        if (supersedes.configKey !== dto.configKey) throw new BadRequestException('configKey cannot change across versions.');
      } else {
        const existing = await manager.getRepository(GovernedSettingEntity).findOne({
          where: { tenantId, screenId, configKey: dto.configKey, status: GovernedSettingStatus.ACTIVE },
        });
        if (existing) throw new ConflictException('An effective configuration already exists. Create a new version using supersedesId.');
      }

      const latest = await manager.getRepository(GovernedSettingEntity)
        .createQueryBuilder('g')
        .where('g.tenant_id = :tenantId AND g.screenId = :screenId AND g.configKey = :configKey', { tenantId, screenId, configKey: dto.configKey })
        .orderBy('g.version', 'DESC')
        .getOne();

      const row = await manager.getRepository(GovernedSettingEntity).save(
        manager.getRepository(GovernedSettingEntity).create({
          tenantId,
          screenId,
          configKey: dto.configKey,
          payload: dto.payload,
          action,
          status: GovernedSettingStatus.DRAFT,
          version: (latest?.version ?? 0) + 1,
          makerId: actorUserId,
          checkerId: null,
          supersedesId: supersedes?.id ?? null,
          submittedAt: null,
          decidedAt: null,
          decisionReason: null,
        }),
      );
      await this.audit.record({
        eventType: 'settings.governed.draft_created',
        tenantId,
        actorUserId,
        subjectId: row.id,
        metadata: { screenId, configKey: dto.configKey, action },
      });
      return row;
    });
  }

  async submitGoverned(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const result = await this.txRunner.run((manager) =>
      manager.getRepository(GovernedSettingEntity)
        .createQueryBuilder()
        .update(GovernedSettingEntity)
        .set({ status: GovernedSettingStatus.PENDING_APPROVAL, submittedAt: () => 'now()' })
        .where('"id" = :id AND "tenant_id" = :tenantId AND "makerId" = :makerId AND "status" IN (:...from)', {
          id,
          tenantId,
          makerId: actorUserId,
          from: [GovernedSettingStatus.DRAFT, GovernedSettingStatus.SENT_BACK],
        })
        .execute(),
    );
    if (result.affected !== 1) throw new ConflictException('This draft is not submittable or you are not its Maker.');
    await this.audit.record({ eventType: 'settings.governed.submitted', tenantId, actorUserId, subjectId: id });
  }

  async decideGoverned(
    tenantId: string,
    checkerId: string,
    id: string,
    decision: 'APPROVE' | 'REJECT' | 'SEND_BACK',
    reason?: string,
  ): Promise<void> {
    if (decision !== 'APPROVE' && (!reason || reason.trim().length < 3)) {
      throw new BadRequestException('Reason is mandatory for Reject and Send Back.');
    }

    await this.txRunner.run(async (manager) => {
      const row = await manager.getRepository(GovernedSettingEntity).findOne({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Setting submission not found.');
      if (row.status !== GovernedSettingStatus.PENDING_APPROVAL) throw new ConflictException('This submission has already been processed.');
      if (row.makerId === checkerId) throw new ForbiddenException('Maker cannot also be Checker for the same submission.');

      const targetStatus =
        decision === 'APPROVE'
          ? (row.action === GovernedSettingAction.DEACTIVATE ? GovernedSettingStatus.INACTIVE : GovernedSettingStatus.ACTIVE)
          : decision === 'REJECT'
            ? GovernedSettingStatus.REJECTED
            : GovernedSettingStatus.SENT_BACK;

      const result = await manager.getRepository(GovernedSettingEntity)
        .createQueryBuilder()
        .update(GovernedSettingEntity)
        .set({ status: targetStatus, checkerId, decidedAt: () => 'now()', decisionReason: reason ?? null })
        .where('"id" = :id AND "tenant_id" = :tenantId AND "status" = :pending AND "makerId" <> :checkerId', {
          id,
          tenantId,
          pending: GovernedSettingStatus.PENDING_APPROVAL,
          checkerId,
        })
        .execute();
      if (result.affected !== 1) throw new ConflictException('This submission was processed concurrently by another Checker.');

      if (decision === 'APPROVE' && row.supersedesId) {
        await manager.getRepository(GovernedSettingEntity)
          .createQueryBuilder()
          .update(GovernedSettingEntity)
          .set({ status: GovernedSettingStatus.SUPERSEDED })
          .where('"id" = :oldId AND "tenant_id" = :tenantId AND "status" IN (:...effective)', {
            oldId: row.supersedesId,
            tenantId,
            effective: [GovernedSettingStatus.ACTIVE, GovernedSettingStatus.INACTIVE],
          })
          .execute();
      }

      if (decision === 'APPROVE' && row.screenId === 'SET-09') {
        await this.applyBranchAccess(manager, tenantId, row);
      }
    });

    await this.audit.record({
      eventType: decision === 'APPROVE' ? 'settings.governed.approved' : decision === 'REJECT' ? 'settings.governed.rejected' : 'settings.governed.sent_back',
      tenantId,
      actorUserId: checkerId,
      subjectId: id,
      metadata: reason ? { reason } : undefined,
    });
  }

  async getCurrentDirect(tenantId: string, screenId: string, configKey = 'DEFAULT') {
    return this.txRunner.run((manager) =>
      manager.getRepository(DirectSettingEntity)
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.screenId = :screenId AND d.configKey = :configKey AND d.isActive = true', { tenantId, screenId, configKey })
        .orderBy('d.version', 'DESC')
        .getOne(),
    );
  }

  async saveDirectFromDto(tenantId: string, actorUserId: string, screenId: string, configKey: string, dto: DirectSettingSaveDto) {
    if (!['SET-02', 'SET-20'].includes(screenId)) throw new BadRequestException('This screen is not an immediate-effective direct setting.');
    validateDirect(screenId, dto.payload);
    return this.saveDirect(tenantId, actorUserId, screenId, configKey, dto.payload, dto.expectedVersion);
  }

  async createFinancialYear(tenantId: string, actorUserId: string, dto: FinancialYearCreateDto) {
    const start = new Date(dto.startDate + 'T00:00:00Z');
    const end = new Date(dto.endDate + 'T00:00:00Z');
    if (!(end > start)) throw new BadRequestException('Financial Year endDate must be after startDate.');

    const existing = await this.listDirectByScreen(tenantId, 'SET-06');
    for (const row of existing) {
      const p = row.payload as { startDate?: string; endDate?: string };
      if (!p.startDate || !p.endDate) continue;
      const a = new Date(p.startDate + 'T00:00:00Z');
      const b = new Date(p.endDate + 'T00:00:00Z');
      if (start <= b && end >= a) throw new ConflictException('Financial Year date range overlaps an existing Financial Year.');
    }

    const periods = generateMonthlyPeriods(dto.startDate, dto.endDate);
    const row = await this.saveDirect(tenantId, actorUserId, 'SET-06', dto.fyCode, {
      fyCode: dto.fyCode,
      startDate: dto.startDate,
      endDate: dto.endDate,
      monthlyPeriods: periods,
    }, 0);
    await this.audit.record({
      eventType: 'settings.financial_year.created',
      tenantId,
      actorUserId,
      subjectId: row.id,
      metadata: { fyCode: dto.fyCode },
    });
    return row;
  }

  listFinancialYears(tenantId: string) {
    return this.listDirectByScreen(tenantId, 'SET-06');
  }

  async regulatoryPoints(tenantId: string) {
    const rows = await this.listGoverned(tenantId, 'SET-21');
    const byPoint = new Map<string, GovernedSettingEntity>();
    for (const row of rows) if (!byPoint.has(row.configKey)) byPoint.set(row.configKey, row);

    return Array.from({ length: 16 }, (_, i) => {
      const n = i + 1;
      const key = 'POINT-' + String(n).padStart(2, '0');
      const row = byPoint.get(key);
      return {
        pointNumber: n,
        sourceReference: 'Master-SRS §33 Point ' + n,
        status: row?.status ?? 'PENDING',
        latestSubmissionId: row?.id ?? null,
        professionalSourceName: typeof row?.payload?.professionalSourceName === 'string' ? row.payload.professionalSourceName : null,
        verificationDate: typeof row?.payload?.verificationDate === 'string' ? row.payload.verificationDate : null,
      };
    });
  }

  async requestDataExport(tenantId: string, actorUserId: string, dto: DataExportRequestDto) {
    if (dto.scope === 'SELECTED_MODULES' && (!dto.modules || dto.modules.length === 0)) {
      throw new BadRequestException('Select at least one module for SELECTED_MODULES export scope.');
    }
    if (dto.fromDate && dto.toDate && new Date(dto.fromDate) > new Date(dto.toDate)) {
      throw new BadRequestException('fromDate cannot be after toDate.');
    }

    return this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(DataExportRequestEntity);
      if (dto.idempotencyKey) {
        const existing = await repo.findOne({ where: { tenantId, idempotencyKey: dto.idempotencyKey } });
        if (existing) return existing;
      }

      const row = await repo.save(repo.create({
        tenantId,
        requestedBy: actorUserId,
        scope: dto.scope,
        modules: dto.scope === 'SELECTED_MODULES' ? (dto.modules ?? []) : null,
        fromDate: dto.fromDate ?? null,
        toDate: dto.toDate ?? null,
        reason: dto.reason,
        status: DataExportStatus.QUEUED,
        idempotencyKey: dto.idempotencyKey ?? null,
        failureReason: null,
        secureDownloadReference: null,
      }));
      await this.audit.record({
        eventType: 'settings.data_export.requested',
        tenantId,
        actorUserId,
        subjectId: row.id,
        metadata: { scope: row.scope, reason: row.reason.slice(0, 120) },
      });
      return row;
    });
  }

  listDataExports(tenantId: string) {
    return this.txRunner.run((manager) =>
      manager.getRepository(DataExportRequestEntity).find({ where: { tenantId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancelDataExport(tenantId: string, actorUserId: string, id: string) {
    const result = await this.txRunner.run((manager) =>
      manager.getRepository(DataExportRequestEntity)
        .createQueryBuilder()
        .update(DataExportRequestEntity)
        .set({ status: DataExportStatus.CANCELLED })
        .where('"id" = :id AND "tenant_id" = :tenantId AND "status" IN (:...allowed)', {
          id,
          tenantId,
          allowed: [DataExportStatus.QUEUED, DataExportStatus.PROCESSING],
        })
        .execute(),
    );
    if (result.affected !== 1) throw new ConflictException('Only queued or processing export requests can be cancelled.');
    await this.audit.record({ eventType: 'settings.data_export.cancelled', tenantId, actorUserId, subjectId: id });
  }

  async saveRetention(tenantId: string, actorUserId: string, dto: RetentionConfigurationDto) {
    return this.saveDirect(tenantId, actorUserId, 'SET-22', 'PUBLIC_QR_ACCESS_LOG_RETENTION', {
      retentionPeriod: dto.retentionPeriod,
    }, dto.expectedVersion);
  }

  getRetention(tenantId: string) {
    return this.getCurrentDirect(tenantId, 'SET-22', 'PUBLIC_QR_ACCESS_LOG_RETENTION');
  }

  accountingSettingsBoundary() {
    return {
      screenId: 'SET-15',
      owningPriority: 'Priority #10 Accounting',
      mutationAvailable: false,
      message: 'Accounting business truth remains Priority #10-owned. Priority #13 hosts navigation/status only and does not create a second accounting configuration truth.',
    };
  }

  private async listDirectByScreen(tenantId: string, screenId: string) {
    return this.txRunner.run((manager) =>
      manager.getRepository(DirectSettingEntity)
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.screenId = :screenId AND d.isActive = true', { tenantId, screenId })
        .orderBy('d.configKey', 'ASC')
        .addOrderBy('d.version', 'DESC')
        .getMany(),
    );
  }

  private async currentDirectVersion(tenantId: string, screenId: string, configKey: string): Promise<number> {
    const row = await this.getCurrentDirect(tenantId, screenId, configKey);
    return row?.version ?? 0;
  }

  private async saveDirect(
    tenantId: string,
    actorUserId: string,
    screenId: string,
    configKey: string,
    payload: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    return this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(DirectSettingEntity);
      const current = await repo.createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.screenId = :screenId AND d.configKey = :configKey AND d.isActive = true', { tenantId, screenId, configKey })
        .orderBy('d.version', 'DESC')
        .getOne();
      const version = current?.version ?? 0;

      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new ConflictException('Configuration changed since it was loaded. Refresh before saving.');
      }

      if (current) {
        current.isActive = false;
        await repo.save(current);
      }

      const saved = await repo.save(repo.create({
        tenantId,
        screenId,
        configKey,
        payload,
        version: version + 1,
        updatedBy: actorUserId,
        isActive: true,
      }));
      await this.audit.record({
        eventType: 'settings.direct.saved',
        tenantId,
        actorUserId,
        subjectId: saved.id,
        metadata: { screenId, configKey, version: saved.version },
      });
      return saved;
    });
  }

  private assertGovernedScreen(screenId: string) {
    if (!GOVERNED_SCREENS.has(screenId)) throw new BadRequestException('Unsupported governed Priority #13 screen.');
  }

  private async validateGovernedPayload(
    manager: EntityManager,
    tenantId: string,
    screenId: string,
    payload: Record<string, unknown>,
    action: GovernedSettingAction,
  ) {
    if (action !== GovernedSettingAction.UPSERT) return;

    if (screenId === 'SET-05') {
      requireStrings(payload, ['bankName', 'accountNumber', 'ifsc', 'accountHolderName', 'applicability', 'purpose']);
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(payload.ifsc))) throw new BadRequestException('IFSC format is invalid.');
      if (!['FPO_LEVEL', 'BRANCH_SPECIFIC'].includes(String(payload.applicability))) throw new BadRequestException('Invalid bank-account applicability.');
      if (!['COLLECTION', 'DISBURSEMENT', 'GENERAL'].includes(String(payload.purpose))) throw new BadRequestException('Invalid bank-account purpose.');
      const duplicate = await manager.getRepository(GovernedSettingEntity)
        .createQueryBuilder('g')
        .where('g.tenant_id = :tenantId AND g.screenId = :screenId AND g.status = :active', {
          tenantId,
          screenId,
          active: GovernedSettingStatus.ACTIVE,
        })
        .andWhere("g.payload->>'accountNumber' = :accountNumber", { accountNumber: String(payload.accountNumber) })
        .getOne();
      if (duplicate) throw new ConflictException('This bank account number is already configured for this tenant.');
      return;
    }

    if (screenId === 'SET-09') {
      requireStrings(payload, ['userId', 'accessScope', 'permissionLevel']);
      if (!['SELECTED_BRANCH', 'ALL_BRANCHES'].includes(String(payload.accessScope))) throw new BadRequestException('Invalid accessScope.');
      if (!['VIEW_ONLY', 'VIEW_DOWNLOAD', 'OPERATIONAL', 'APPROVAL'].includes(String(payload.permissionLevel))) throw new BadRequestException('Invalid permissionLevel.');
      if (payload.accessScope === 'SELECTED_BRANCH' && (!Array.isArray(payload.branchIds) || payload.branchIds.length === 0)) {
        throw new BadRequestException('At least one branch is required for SELECTED_BRANCH.');
      }
      return;
    }

    if (screenId === 'SET-11') {
      requireStrings(payload, ['productType']);
      if (!APPROVAL_PRODUCTS.has(String(payload.productType))) throw new BadRequestException('Unsupported approval-matrix product/facility type.');
      if (!Array.isArray(payload.levels) || payload.levels.length === 0) throw new BadRequestException('Approval Matrix requires at least one level.');
      validateApprovalLevels(payload.levels);
      return;
    }

    if (screenId === 'SET-12') {
      const modes = payload.modes;
      if (!isRecord(modes) || Object.keys(modes).length !== NUMBERING_TYPES.length) {
        throw new BadRequestException('All 9 fixed numbering document types must be configured explicitly.');
      }
      for (const type of NUMBERING_TYPES) {
        if (!['CENTRALISED', 'BRANCH_WISE'].includes(String(modes[type]))) {
          throw new BadRequestException('Invalid or missing numbering mode for ' + type + '.');
        }
      }
      return;
    }

    if (screenId === 'SET-13') {
      const weights = payload.weights;
      if (!isRecord(weights)) throw new BadRequestException('Credit settings require the 8 frozen criterion weights.');
      let total = 0;
      for (const key of CREDIT_WEIGHT_KEYS) {
        const n = Number(weights[key]);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Invalid credit weight: ' + key + '.');
        total += n;
      }
      if (Math.abs(total - 100) > 0.000001) throw new BadRequestException('Credit criterion weights must total exactly 100.');
      if (!['SEPARATE', 'COMBINED'].includes(String(payload.exposureMode))) throw new BadRequestException('exposureMode must be SEPARATE or COMBINED.');
      if (!Array.isArray(payload.scoreBands) || payload.scoreBands.length === 0) throw new BadRequestException('At least one score band is required.');
      validateScoreBands(payload.scoreBands);
      return;
    }

    if (screenId === 'SET-14') {
      requireStrings(payload, ['dayCountConvention', 'roundingMethod']);
      if (!['NEAREST', 'UP', 'DOWN'].includes(String(payload.roundingMethod))) throw new BadRequestException('roundingMethod must be NEAREST, UP or DOWN.');
      const decimalPlaces = Number(payload.decimalPlaces);
      if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 2) throw new BadRequestException('decimalPlaces must be 0, 1 or 2.');
      if (payload.gracePeriodDays !== undefined && (!Number.isInteger(Number(payload.gracePeriodDays)) || Number(payload.gracePeriodDays) < 0)) {
        throw new BadRequestException('gracePeriodDays must be a non-negative whole number.');
      }
      return;
    }

    if (screenId === 'SET-16') {
      requireStrings(payload, ['mode', 'applicability']);
      if (!['STANDARD', 'SIMPLIFIED'].includes(String(payload.mode))) throw new BadRequestException('Purchase workflow mode must be STANDARD or SIMPLIFIED.');
      if (!['ALL_BRANCHES', 'BRANCH_SPECIFIC'].includes(String(payload.applicability))) throw new BadRequestException('Invalid purchase workflow applicability.');
      if (payload.applicability === 'BRANCH_SPECIFIC' && (!Array.isArray(payload.branchIds) || payload.branchIds.length === 0)) {
        throw new BadRequestException('Select at least one branch for BRANCH_SPECIFIC purchase workflow.');
      }
      return;
    }

    if (screenId === 'SET-17') {
      requireStrings(payload, ['valuationMethod']);
      if (!['WEIGHTED_AVERAGE', 'FIFO'].includes(String(payload.valuationMethod))) throw new BadRequestException('valuationMethod must be WEIGHTED_AVERAGE or FIFO.');
      const days = Number(payload.nearExpiryThresholdDays);
      if (!Number.isInteger(days) || days <= 0) throw new BadRequestException('nearExpiryThresholdDays must be a positive whole number.');
      return;
    }

    if (screenId === 'SET-21') {
      requireStrings(payload, ['evidenceNote', 'professionalSourceName', 'verificationDate']);
      const date = new Date(String(payload.verificationDate) + 'T00:00:00Z');
      if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
        throw new BadRequestException('Verification date cannot be in the future.');
      }
      return;
    }
  }

  private async applyBranchAccess(manager: EntityManager, tenantId: string, row: GovernedSettingEntity) {
    const userId = String(row.payload.userId ?? '');
    if (!userId) return;
    const userRepo = manager.getRepository(UserAccountEntity);
    const user = await userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new BadRequestException('Target user no longer exists.');

    const assignments = manager.getRepository(UserBranchAssignmentEntity);
    await assignments.delete({ tenantId, userId });

    if (row.action === GovernedSettingAction.DEACTIVATE) {
      user.branchAccessScope = null;
      await userRepo.save(user);
      return;
    }

    const scope = String(row.payload.accessScope);
    user.branchAccessScope = scope === 'ALL_BRANCHES' ? 'ALL_BRANCHES' : 'SELECTED_BRANCH';
    await userRepo.save(user);

    if (scope === 'SELECTED_BRANCH' && Array.isArray(row.payload.branchIds)) {
      const permissionLevel = String(row.payload.permissionLevel);
      const effectiveFrom = typeof row.payload.effectiveFrom === 'string' ? row.payload.effectiveFrom : null;
      const effectiveTo = typeof row.payload.effectiveTo === 'string' ? row.payload.effectiveTo : null;
      await assignments.save(row.payload.branchIds.map((branchId) => assignments.create({
        tenantId,
        userId,
        branchId: String(branchId),
        permissionLevel,
        effectiveFrom,
        effectiveTo,
      })));
    }
  }
}

function validateProfile(reg: FpoRegistrationEntity) {
  if (!reg.fpoName || !reg.registeredAddress) throw new BadRequestException('FPO Name and Registered Address are mandatory.');
  if (reg.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(reg.pan)) throw new BadRequestException('PAN format is invalid.');
  if (reg.cin && !/^[A-Z0-9-]{8,64}$/i.test(reg.cin)) throw new BadRequestException('CIN format is invalid.');
  if (reg.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i.test(reg.gstin)) throw new BadRequestException('GSTIN format is invalid.');
}

function validateDirect(screenId: string, payload: Record<string, unknown>) {
  if (screenId === 'SET-02') {
    if (payload.primaryColour !== undefined && !/^#[0-9A-F]{6}$/i.test(String(payload.primaryColour))) {
      throw new BadRequestException('primaryColour must be a 6-digit hex colour.');
    }
    if (payload.secondaryColour !== undefined && !/^#[0-9A-F]{6}$/i.test(String(payload.secondaryColour))) {
      throw new BadRequestException('secondaryColour must be a 6-digit hex colour.');
    }
  }
  if (screenId === 'SET-20') {
    requireStrings(payload, ['signatoryName', 'designation', 'signatureImageReference']);
    if (!Array.isArray(payload.applicableDocumentTypes) || payload.applicableDocumentTypes.length === 0) {
      throw new BadRequestException('At least one applicable document type is required.');
    }
  }
}

function requireStrings(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof payload[key] !== 'string' || String(payload[key]).trim() === '') {
      throw new BadRequestException(key + ' is required.');
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateApprovalLevels(levels: unknown[]) {
  const parsed = levels.map((raw) => {
    if (!isRecord(raw)) throw new BadRequestException('Every approval level must be an object.');
    const from = Number(raw.amountFrom);
    const to = raw.amountTo === null || raw.amountTo === undefined ? null : Number(raw.amountTo);
    if (!Number.isFinite(from) || from < 0) throw new BadRequestException('Approval level amountFrom must be non-negative.');
    if (to !== null && (!Number.isFinite(to) || to < from)) throw new BadRequestException('Approval level amountTo must be >= amountFrom.');
    if (typeof raw.approverRoleId !== 'string' || raw.approverRoleId === '') throw new BadRequestException('Every approval level requires approverRoleId.');
    return { from, to };
  }).sort((a, b) => a.from - b.from);

  if (parsed[0].from !== 0) throw new BadRequestException('Approval ranges must start at 0.');
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i - 1].to === null || parsed[i].from !== parsed[i - 1].to) {
      throw new BadRequestException('Approval ranges must be gapless and non-overlapping.');
    }
  }
  if (parsed[parsed.length - 1].to !== null) throw new BadRequestException('Final approval range must be open-ended with amountTo = null.');
}

function validateScoreBands(bands: unknown[]) {
  const parsed = bands.map((raw) => {
    if (!isRecord(raw)) throw new BadRequestException('Every score band must be an object.');
    const min = Number(raw.min);
    const max = Number(raw.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) throw new BadRequestException('Invalid score band range.');
    return { min, max };
  }).sort((a, b) => a.min - b.min);

  if (parsed[0].min !== 0) throw new BadRequestException('Score bands must start at 0.');
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].min !== parsed[i - 1].max) throw new BadRequestException('Score bands must be gapless and non-overlapping.');
  }
}

function generateMonthlyPeriods(startDate: string, endDate: string) {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const out: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  while (cursor <= end) {
    const periodStart = new Date(cursor);
    const lastOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const periodEnd = lastOfMonth < end ? lastOfMonth : end;
    out.push({
      startDate: periodStart.toISOString().slice(0, 10),
      endDate: periodEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate() + 1));
  }
  return out;
}
