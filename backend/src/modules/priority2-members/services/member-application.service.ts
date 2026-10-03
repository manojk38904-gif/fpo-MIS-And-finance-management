import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../../priority1-auth-registration/entities/fpo-registration.entity.js';
import { CreateMemberApplicationDto } from '../dto/member-application.dto.js';
import { MemberApplicationEntity, MemberApplicationStatus } from '../entities/member-application.entity.js';

@Injectable()
export class MemberApplicationService {
  constructor(
    @InjectRepository(FpoRegistrationEntity) private readonly fpos: Repository<FpoRegistrationEntity>,
    private readonly knownTx: KnownTenantTransactionRunner,
    private readonly tenantTx: TenantAwareTransactionRunner,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async apply(dto: CreateMemberApplicationDto) {
    const fpoCode = dto.fpoCode.trim().toUpperCase();
    const fpo = await this.fpos.findOne({ where: { fpoCode, status: FpoRegistrationStatus.ACTIVE } });
    if (!fpo) throw new NotFoundException('Active FPO Code was not found.');
    const record = await this.knownTx.run(fpo.id, async (manager) => {
      const repo = manager.getRepository(MemberApplicationEntity);
      const existing = await repo.findOne({ where: { tenantId: fpo.id, mobile: dto.mobile, status: MemberApplicationStatus.PENDING } });
      if (existing) throw new ConflictException('An application for this mobile number is already pending with this FPO.');
      const serial = String((await repo.count({ where: { tenantId: fpo.id } })) + 1).padStart(5, '0');
      return repo.save(repo.create({
        tenantId: fpo.id, applicationNumber: `${fpoCode}-MEM-${serial}`, fullName: dto.fullName.trim(), mobile: dto.mobile,
        email: dto.email?.trim().toLowerCase() ?? null, aadhaarLast4: dto.aadhaarLast4 ?? null, pan: dto.pan?.toUpperCase() ?? null,
        dateOfBirth: dto.dateOfBirth ?? null, gender: dto.gender ?? null, address: dto.address.trim(), village: dto.village.trim(),
        district: dto.district.trim(), state: dto.state.trim(), pincode: dto.pincode, landHoldingAcres: dto.landHoldingAcres ?? null,
        shareQuantity: dto.shareQuantity, shareAmount: dto.shareAmount, status: MemberApplicationStatus.PENDING,
        memberNumber: null, identityCardNumber: null, reviewedByUserId: null, reviewedAt: null, decisionNote: null,
      }));
    });
    await this.audit.record({ eventType: 'member.application.submitted', tenantId: fpo.id, subjectId: record.id, metadata: { applicationNumber: record.applicationNumber } });
    return { applicationNumber: record.applicationNumber, status: record.status, fpoName: fpo.fpoName };
  }

  list(tenantId: string) { return this.tenantTx.run((m) => m.getRepository(MemberApplicationEntity).find({ where: { tenantId }, order: { createdAt: 'DESC' } })); }

  async decide(tenantId: string, actorUserId: string, id: string, status: MemberApplicationStatus.APPROVED | MemberApplicationStatus.REJECTED, note?: string) {
    return this.tenantTx.run(async (manager) => {
      const repo = manager.getRepository(MemberApplicationEntity);
      const record = await repo.findOne({ where: { id, tenantId } });
      if (!record) throw new NotFoundException('Member application not found.');
      if (record.status !== MemberApplicationStatus.PENDING) throw new ConflictException('This application has already been decided.');
      record.status = status; record.reviewedByUserId = actorUserId; record.reviewedAt = new Date(); record.decisionNote = note?.trim() ?? null;
      if (status === MemberApplicationStatus.APPROVED) {
        const serial = String((await repo.count({ where: { tenantId, status: MemberApplicationStatus.APPROVED } })) + 1).padStart(5, '0');
        record.memberNumber = `MEM-${serial}`;
        record.identityCardNumber = `ID-${new Date().getFullYear()}-${serial}`;
      }
      const saved = await repo.save(record);
      await this.audit.record({ eventType: `member.application.${status.toLowerCase()}`, tenantId, actorUserId, subjectId: id, metadata: { applicationNumber: saved.applicationNumber } });
      return saved;
    });
  }

  async card(tenantId: string, id: string) {
    const row = await this.tenantTx.run((m) => m.getRepository(MemberApplicationEntity).findOne({ where: { id, tenantId } }));
    if (!row) throw new NotFoundException('Member not found.');
    if (row.status !== MemberApplicationStatus.APPROVED) throw new BadRequestException('Identity card is available only after approval.');
    const fpo = await this.fpos.findOne({ where: { id: tenantId } });
    return { fpoName: fpo?.fpoName ?? 'FPO', fpoCode: fpo?.fpoCode ?? '', member: row };
  }
}