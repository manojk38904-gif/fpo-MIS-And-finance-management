import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { EMAIL_DELIVERY_PORT } from '../../../common/delivery/email-delivery.port.js';
import type { EmailDeliveryPort } from '../../../common/delivery/email-delivery.port.js';
import { FILE_STORAGE_PORT, MALWARE_SCAN_PORT } from '../../../common/storage/file-storage.port.js';
import type { FileStoragePort, MalwareScanPort } from '../../../common/storage/file-storage.port.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../entities/fpo-registration.entity.js';
import { FpoRegistrationDocumentEntity, FpoRegistrationDocumentType } from '../entities/fpo-registration-document.entity.js';
import { RegistrationResumeTokenEntity } from '../entities/registration-resume-token.entity.js';
import { OtpPurpose } from '../entities/otp-verification.entity.js';
import { OtpService } from './otp.service.js';
import { RegistrationDraftDto } from '../dto/registration.dto.js';

const MANDATORY_SUBMIT_FIELDS: Array<keyof FpoRegistrationEntity> = [
  'fpoName', 'cin', 'registrationNumber', 'incorporationDate', 'pan',
  'chairmanName', 'ceoName', 'authorisedPersonName',
  'registeredAddress', 'state', 'district', 'pincode', 'officialMobile', 'officialEmail',
  'bankName', 'bankAccountNumber', 'bankIfsc',
];

/** The exact status set the partial unique indexes (see the correction-pass
 *  migration) are scoped to — a DRAFT or OTP_VERIFIED application has not yet
 *  actually committed to a PAN/CIN in a way that should block anyone else;
 *  only once an application has itself reached one of these does sharing its
 *  PAN/CIN become a genuine conflict. */
const POST_SUBMISSION_STATUSES = [
  FpoRegistrationStatus.SUBMITTED,
  FpoRegistrationStatus.UNDER_VERIFICATION,
  FpoRegistrationStatus.APPROVED,
  FpoRegistrationStatus.ACTIVE,
];

const MANDATORY_DOCUMENT_TYPES: FpoRegistrationDocumentType[] = [
  FpoRegistrationDocumentType.REGISTRATION_CERTIFICATE,
  FpoRegistrationDocumentType.INCORPORATION_CERTIFICATE,
  FpoRegistrationDocumentType.PAN_UPLOAD,
  FpoRegistrationDocumentType.LOGO_UPLOAD,
  // GST_DOCUMENT is conditional on gstin being provided (per spec point 5).
];

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * SYS-02 — FPO Self-Registration. Public, pre-tenant (no RLS table).
 * CA-2: duplicate PAN/CIN handling is generic/non-enumerating in the public
 * response; internal/authorised review detail is preserved via the existing
 * audit mechanism (no new role/permission/duplicate-truth invented).
 *
 * Correction-pass item 6 — every read/update after initial creation requires
 * a valid resume token (RegistrationResumeTokenEntity); the bare
 * registrationId is never, by itself, sufficient. Item 11 — incorporation
 * date may not be in the future. Item 14 — duplicate PAN/CIN is blocked by a
 * genuine DB-level race-safe mechanism (a partial unique index on
 * post-submission statuses — see the correction-pass migration), not only a
 * check-then-save race.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly otpService: OtpService,
    private readonly secretHasher: SecretTokenHasher,
    private readonly config: ConfigService,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
    @Inject(EMAIL_DELIVERY_PORT) private readonly emailDelivery: EmailDeliveryPort,
    @Inject(FILE_STORAGE_PORT) private readonly fileStorage: FileStoragePort,
    @Inject(MALWARE_SCAN_PORT) private readonly malwareScan: MalwareScanPort,
  ) {}

  /**
   * Creates a NEW draft only. Correction-pass item 6 — there is deliberately
   * no "update by bare registrationId" path any more: once a draft exists,
   * every subsequent read/update must go through a resume token
   * (updateDraftByResumeToken/getByResumeToken below). Returning the id AND
   * a freshly issued resume token in this same response lets the client
   * continue the SAME live session immediately without a second round trip.
   */
  async createDraft(dto: RegistrationDraftDto): Promise<{ registration: FpoRegistrationEntity; resumeToken: string }> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    this.assertIncorporationDateNotFuture(dto.incorporationDate);

    const entity = repo.create({ ...dto, status: FpoRegistrationStatus.DRAFT } as Partial<FpoRegistrationEntity>);
    const saved = await repo.save(entity);
    await this.audit.record({ eventType: 'registration.draft.created', tenantId: null, subjectId: saved.id });

    // Issued immediately, in the SAME response, so the SPA holds it right
    // away (continuing the live form needs no email round-trip); Save & Exit
    // later emails this same value for genuine resume (item 6).
    const resumeToken = await this.issueResumeToken(saved.id);
    return { registration: saved, resumeToken };
  }

  /** Correction-pass item 6 — bare-UUID access helper, kept PRIVATE. Only
   *  used internally right after this service itself just created the row
   *  (same request, same trust boundary as returning the id at all) or by
   *  the resume-token-verified path below. Never exposed as a public method
   *  a controller could call with a client-supplied bare id after the fact. */
  private async requireEditable(registrationId: string): Promise<FpoRegistrationEntity> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const existing = await repo.findOne({ where: { id: registrationId } });
    if (!existing) throw new NotFoundException('Registration draft not found.');
    if (existing.status !== FpoRegistrationStatus.DRAFT && existing.status !== FpoRegistrationStatus.OTP_VERIFIED) {
      throw new BadRequestException('This application has already been submitted and can no longer be edited here.');
    }
    return existing;
  }

  async get(registrationId: string): Promise<FpoRegistrationEntity> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const found = await repo.findOne({ where: { id: registrationId } });
    if (!found) throw new NotFoundException('Registration not found.');
    return found;
  }

  // ----------------------------------------------------- Resume (item 6)
  private async issueResumeToken(registrationId: string): Promise<string> {
    const repo = this.dataSource.getRepository(RegistrationResumeTokenEntity);
    // Controlled re-issuance: at most one live resume token per registration.
    await repo.delete({ registrationId });
    const raw = this.secretHasher.generateOpaqueSecret();
    const expiryHours = this.config.get<number>('registrationResume.expiryHours') ?? 168; // 7 days
    await repo.save(
      repo.create({
        registrationId,
        tokenHash: this.secretHasher.hash(raw),
        expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000),
      }),
    );
    return raw;
  }

  private async resolveByResumeToken(rawResumeToken: string): Promise<FpoRegistrationEntity> {
    const repo = this.dataSource.getRepository(RegistrationResumeTokenEntity);
    const tokenHash = this.secretHasher.hash(rawResumeToken);
    const record = await repo.findOne({ where: { tokenHash } });
    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This resume link is invalid or has expired.');
    }
    return this.requireEditable(record.registrationId);
  }

  async getByResumeToken(rawResumeToken: string): Promise<FpoRegistrationEntity> {
    return this.resolveByResumeToken(rawResumeToken);
  }

  async updateDraftByResumeToken(rawResumeToken: string, dto: RegistrationDraftDto): Promise<FpoRegistrationEntity> {
    this.assertIncorporationDateNotFuture(dto.incorporationDate);
    const existing = await this.resolveByResumeToken(rawResumeToken);
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    // Correction-pass item 7 — officialEmail can also change through a plain
    // draft edit (not only through the dedicated send-otp endpoint); that
    // path must not be allowed to silently leave a stale emailOtpVerified=true
    // standing against the new, never-verified address.
    const emailChanged = dto.officialEmail !== undefined && dto.officialEmail !== existing.officialEmail;
    Object.assign(existing, dto);
    if (emailChanged) {
      existing.emailOtpVerified = false;
      if (existing.status === FpoRegistrationStatus.OTP_VERIFIED) {
        existing.status = FpoRegistrationStatus.DRAFT;
      }
    }
    return repo.save(existing);
  }

  /** Controlled re-issuance: caller must prove knowledge of the registration's own officialEmail on file. */
  async reissueResumeToken(registrationId: string, officialEmail: string): Promise<void> {
    const reg = await this.get(registrationId);
    if (!reg.officialEmail || reg.officialEmail.toLowerCase() !== officialEmail.toLowerCase()) {
      // Generic — never reveals whether the email simply didn't match.
      throw new BadRequestException('Unable to resend a resume link for the details provided.');
    }
    const resumeToken = await this.issueResumeToken(registrationId);
    await this.emailDelivery.send({ to: reg.officialEmail, template: 'REGISTRATION_RESUME_LINK', data: { resumeToken } });
    await this.audit.record({ eventType: 'registration.resume_token.reissued', tenantId: null, subjectId: registrationId });
  }

  // ----------------------------------------------------- OTP (item 7)
  /** Integration point SYS-02 ↔ SYS-03 — sent once Step-2 (email) is complete. */
  async sendEmailOtpByResumeToken(rawResumeToken: string, officialEmail: string): Promise<{ otpVerificationId: string }> {
    const reg = await this.resolveByResumeToken(rawResumeToken);
    return this.sendEmailOtpInternal(reg, officialEmail);
  }

  private async sendEmailOtpInternal(reg: FpoRegistrationEntity, officialEmail: string): Promise<{ otpVerificationId: string }> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    // DRAFT (first verification) and OTP_VERIFIED (correcting/re-verifying an
    // already-verified email before final submit) are both legitimate — only
    // a SUBMITTED-or-later application is closed to this (requireEditable,
    // called via resolveByResumeToken before this method runs, already
    // enforces that boundary).
    if (reg.status !== FpoRegistrationStatus.DRAFT && reg.status !== FpoRegistrationStatus.OTP_VERIFIED) {
      throw new BadRequestException('OTP can only be sent while the application is still being drafted.');
    }
    const emailChanged = reg.officialEmail !== officialEmail;
    reg.officialEmail = officialEmail;
    if (emailChanged) {
      // Correction-pass item 7 — an email CHANGE must invalidate any prior
      // verification state for THIS registration; it never silently carries
      // forward a verification performed against the old address. Dropping
      // status back to DRAFT (when it had advanced to OTP_VERIFIED) forces a
      // fresh verification before submit can succeed again.
      reg.emailOtpVerified = false;
      if (reg.status === FpoRegistrationStatus.OTP_VERIFIED) {
        reg.status = FpoRegistrationStatus.DRAFT;
      }
    }
    await repo.save(reg);
    // subjectId = this registration's own id — binds the OTP so it can never
    // verify a different registration, even one sharing the same email.
    return this.otpService.generate(officialEmail, OtpPurpose.REGISTRATION, null, reg.id);
  }

  async verifyEmailOtpByResumeToken(rawResumeToken: string, otpVerificationId: string, otp: string): Promise<void> {
    const reg = await this.resolveByResumeToken(rawResumeToken);
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const result = await this.otpService.verify(otpVerificationId, OtpPurpose.REGISTRATION, reg.id, otp);
    if (result.identifier !== reg.officialEmail) {
      throw new BadRequestException('Invalid or expired OTP.');
    }
    reg.emailOtpVerified = true;
    reg.status = FpoRegistrationStatus.OTP_VERIFIED;
    await repo.save(reg);
  }

  // ----------------------------------------------------- Documents (item 12)
  async attachDocumentByResumeToken(
    rawResumeToken: string,
    documentType: FpoRegistrationDocumentType,
    file: { buffer: Buffer; originalFileName: string; mimeType: string; sizeBytes: number },
  ): Promise<FpoRegistrationDocumentEntity> {
    const reg = await this.resolveByResumeToken(rawResumeToken);

    const maxSize = this.config.get<number>('upload.maxSizeBytes') ?? 10 * 1024 * 1024;
    const allowed = this.config.get<string[]>('upload.allowedMimeTypes') ?? ALLOWED_DOCUMENT_MIME_TYPES;
    if (!allowed.includes(file.mimeType)) {
      throw new BadRequestException(`Unsupported file type "${file.mimeType}". Allowed: ${allowed.join(', ')}.`);
    }
    if (file.sizeBytes > maxSize) {
      throw new BadRequestException(`File exceeds the maximum allowed size of ${Math.round(maxSize / (1024 * 1024))} MB.`);
    }

    const scanResult = await this.malwareScan.scan(file.buffer);
    if (!scanResult.clean) {
      await this.audit.record({ eventType: 'registration.document.rejected_malware_scan', tenantId: null, subjectId: reg.id, metadata: { documentType, reason: scanResult.reason ?? 'unspecified' } });
      throw new BadRequestException('This file failed a security scan and was not accepted.');
    }

    const stored = await this.fileStorage.store({ buffer: file.buffer, originalFileName: file.originalFileName, mimeType: file.mimeType });

    const repo = this.dataSource.getRepository(FpoRegistrationDocumentEntity);
    const entity = repo.create({
      registrationId: reg.id,
      documentType,
      fileKey: stored.fileKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });
    const saved = await repo.save(entity);
    await this.audit.record({ eventType: 'registration.document.uploaded', tenantId: null, subjectId: reg.id, metadata: { documentType } });
    return saved;
  }

  // ----------------------------------------------------- Submit (items 11, 14)
  private assertIncorporationDateNotFuture(incorporationDate: string | undefined): void {
    if (!incorporationDate) return;
    // Date-only comparison (no time-of-day component in the frozen field) —
    // compares as UTC calendar dates so server timezone cannot make "today"
    // wrongly read as "future".
    const today = new Date().toISOString().slice(0, 10);
    if (incorporationDate > today) {
      throw new BadRequestException('Incorporation Date cannot be in the future.');
    }
  }

  /**
   * Final submit (Step-5). Runs CA-2's generic duplicate-PAN/CIN check and
   * the mandatory-field/document completeness check. Only ever surfaces the
   * generic, non-enumerating message on duplicate — never which field
   * matched or whether a prior record exists.
   */
  async submitByResumeToken(rawResumeToken: string): Promise<{ applicationReferenceNumber: string }> {
    const reg = await this.resolveByResumeToken(rawResumeToken);
    return this.submitInternal(reg);
  }

  private async submitInternal(reg: FpoRegistrationEntity): Promise<{ applicationReferenceNumber: string }> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);

    if (reg.status !== FpoRegistrationStatus.OTP_VERIFIED) {
      throw new BadRequestException('Email must be OTP-verified before submission.');
    }
    if (!reg.termsAccepted) {
      throw new BadRequestException('Terms must be accepted before submission.');
    }
    this.assertIncorporationDateNotFuture(reg.incorporationDate ?? undefined);

    for (const field of MANDATORY_SUBMIT_FIELDS) {
      if (!reg[field]) {
        throw new BadRequestException(`Incomplete application — missing: ${String(field)}.`);
      }
    }

    const docRepo = this.dataSource.getRepository(FpoRegistrationDocumentEntity);
    const docs = await docRepo.find({ where: { registrationId: reg.id } });
    const uploadedTypes = new Set(docs.map((d) => d.documentType));
    const requiredTypes = [...MANDATORY_DOCUMENT_TYPES, ...(reg.gstin ? [FpoRegistrationDocumentType.GST_DOCUMENT] : [])];
    for (const requiredType of requiredTypes) {
      if (!uploadedTypes.has(requiredType)) {
        throw new BadRequestException(`Incomplete application — missing document: ${requiredType}.`);
      }
    }

    // CA-2: generic, non-enumerating BEST-EFFORT pre-check (gives a fast,
    // friendly error in the common case). The partial unique indexes
    // `uq_fpo_registration_pan_post_submit` / `..._cin_post_submit` (see the
    // correction-pass migration) are the actual, race-safe, DB-level
    // backstop for item 14: they only apply to post-submission statuses, so
    // two concurrent submits of two DIFFERENT draft registrations sharing a
    // PAN/CIN cannot both reach SUBMITTED, even though both can pass this
    // pre-check at the same instant.
    const duplicate = await repo
      .createQueryBuilder('r')
      .where('r.id != :id', { id: reg.id })
      .andWhere('(r.pan = :pan OR r.cin = :cin)', { pan: reg.pan, cin: reg.cin })
      .andWhere('r.status IN (:...statuses)', { statuses: POST_SUBMISSION_STATUSES })
      .getOne();

    if (duplicate) {
      await this.audit.record({
        eventType: 'registration.submit.duplicate_blocked',
        tenantId: null,
        subjectId: reg.id,
        metadata: { matchedExistingRegistrationId: duplicate.id },
      });
      throw this.genericDuplicateError();
    }

    try {
      reg.status = FpoRegistrationStatus.SUBMITTED;
      reg.submittedAt = new Date();
      await repo.save(reg);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost the actual DB-level race against a concurrent different
        // registration sharing the same PAN/CIN — the partial unique index
        // just caught what the pre-check above could not.
        await this.audit.record({ eventType: 'registration.submit.duplicate_blocked_race', tenantId: null, subjectId: reg.id });
        throw this.genericDuplicateError();
      }
      throw error;
    }

    await this.audit.record({ eventType: 'registration.submitted', tenantId: null, subjectId: reg.id });
    return { applicationReferenceNumber: reg.id };
  }

  private genericDuplicateError(): BadRequestException {
    return new BadRequestException('This application cannot be processed at this time. Please contact support for assistance.');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === PG_UNIQUE_VIOLATION;
}
