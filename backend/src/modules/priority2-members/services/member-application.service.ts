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
    const photo = this.decodePhoto(dto.photoData);
    const record = await this.knownTx.run(fpo.id, async (manager) => {
      const repo = manager.getRepository(MemberApplicationEntity);
      const existing = await repo.findOne({ where: { tenantId: fpo.id, mobile: dto.mobile, status: MemberApplicationStatus.PENDING } });
      if (existing) throw new ConflictException('An application for this mobile number is already pending with this FPO.');
      const serial = String((await repo.count({ where: { tenantId: fpo.id } })) + 1).padStart(5, '0');
      return repo.save(repo.create({
        tenantId: fpo.id, applicationNumber: `${fpoCode}-MEM-${serial}`, fullName: dto.fullName.trim(), mobile: dto.mobile,
        email: dto.email?.trim().toLowerCase() ?? null, photoData: photo.data, photoMimeType: photo.mimeType, aadhaarLast4: dto.aadhaarLast4 ?? null, pan: dto.pan?.toUpperCase() ?? null,
        dateOfBirth: dto.dateOfBirth ?? null, gender: dto.gender ?? null, address: dto.address.trim(), village: dto.village.trim(),
        district: dto.district.trim(), state: dto.state.trim(), pincode: dto.pincode, landHoldingAcres: dto.landHoldingAcres ?? null,
        shareQuantity: dto.shareQuantity, shareAmount: dto.shareAmount, status: MemberApplicationStatus.PENDING,
        memberNumber: null, identityCardNumber: null, shareCertificateNumber: null, folioNumber: null, distinctiveFrom: null, distinctiveTo: null, boardResolutionRef: null, shareCertificateIssuedAt: null, reviewedByUserId: null, reviewedAt: null, decisionNote: null,
      }));
    });
    await this.audit.record({ eventType: 'member.application.submitted', tenantId: fpo.id, subjectId: record.id, metadata: { applicationNumber: record.applicationNumber } });
    return { applicationNumber: record.applicationNumber, status: record.status, fpoName: fpo.fpoName };
  }

  async list(tenantId: string) {
    const rows = await this.tenantTx.run((m) => m.getRepository(MemberApplicationEntity).find({ where: { tenantId }, order: { createdAt: 'DESC' } }));
    return rows.map(({ photoData: _photo, ...row }) => row);
  }

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
    const row = await this.tenantTx.run((m) => m.getRepository(MemberApplicationEntity).createQueryBuilder('member').addSelect('member.photoData').where('member.id = :id AND member.tenantId = :tenantId', { id, tenantId }).getOne());
    if (!row) throw new NotFoundException('Member not found.');
    if (row.status !== MemberApplicationStatus.APPROVED) throw new BadRequestException('Identity card is available only after approval.');
    const fpo = await this.fpos.findOne({ where: { id: tenantId } });
    return { fpoName: fpo?.fpoName ?? 'FPO', fpoCode: fpo?.fpoCode ?? '', member: { ...row, photoData: row.photoData ? `data:${row.photoMimeType};base64,${row.photoData.toString('base64')}` : null } };
  }

  async issueShareCertificate(tenantId: string, actorUserId: string, id: string, boardResolutionRef: string) {
    return this.tenantTx.run(async (manager) => {
      const repo = manager.getRepository(MemberApplicationEntity);
      const row = await repo.findOne({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Member not found.');
      if (row.status !== MemberApplicationStatus.APPROVED) throw new BadRequestException('Share certificate can be issued only after shareholder approval.');
      if (!row.shareCertificateNumber) {
        // The serial must remain unique even when several certificates have already been issued.
        const serial = String((await repo.count({ where: { tenantId } })) + 1).padStart(5, '0');
        const approved = await repo.find({ where: { tenantId, status: MemberApplicationStatus.APPROVED }, select: { id: true, shareQuantity: true } });
        const totalBeforeThisMember = approved.filter((member) => member.id !== row.id).reduce((total, member) => total + Number(member.shareQuantity), 0);
        const start = String(totalBeforeThisMember + 1);
        row.shareCertificateNumber = `SH-${new Date().getFullYear()}-${serial}`; row.folioNumber = `FOL-${serial}`; row.distinctiveFrom = start; row.distinctiveTo = String(Number(start) + row.shareQuantity - 1); row.boardResolutionRef = boardResolutionRef.trim(); row.shareCertificateIssuedAt = new Date();
        await repo.save(row);
        await this.audit.record({ eventType: 'member.share_certificate.issued', tenantId, actorUserId, subjectId: id, metadata: { certificateNumber: row.shareCertificateNumber } });
      }
      return this.shareCertificate(tenantId, id);
    });
  }

  async shareCertificate(tenantId: string, id: string) {
    const row = await this.tenantTx.run((m) => m.getRepository(MemberApplicationEntity).findOne({ where: { id, tenantId } }));
    if (!row || !row.shareCertificateNumber || !row.shareCertificateIssuedAt) throw new NotFoundException('Issued share certificate not found.');
    const fpo = await this.fpos.findOne({ where: { id: tenantId } });
    return { fpoName: fpo?.fpoName ?? 'FPO', cin: fpo?.cin ?? '', registeredAddress: fpo?.registeredAddress ?? '', fpoCode: fpo?.fpoCode ?? '', member: row };
  }

  private decodePhoto(value: string): { data: Buffer; mimeType: string } {
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(value ?? '');
    if (!match) throw new BadRequestException('Please upload a JPG or PNG passport-size photograph.');
    const data = Buffer.from(match[2], 'base64');
    if (data.length === 0 || data.length > 2 * 1024 * 1024) throw new BadRequestException('Photograph must be less than 2 MB.');
    return { data, mimeType: match[1] };
  }
}
