import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

export enum MemberApplicationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** A tenant-isolated farmer shareholder application. Aadhaar is deliberately
 * limited to its last four digits; full Aadhaar/KYC documents are never held
 * in this first self-service application flow. */
@Entity('member_application')
@Index(['tenantId', 'applicationNumber'], { unique: true })
@Index(['tenantId', 'mobile'])
export class MemberApplicationEntity extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 32, name: 'application_number' }) applicationNumber!: string;
  @Column({ type: 'varchar', length: 255, name: 'full_name' }) fullName!: string;
  @Column({ type: 'varchar', length: 10 }) mobile!: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) email!: string | null;
  @Column({ type: 'bytea', nullable: true, name: 'photo_data', select: false }) photoData!: Buffer | null;
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'photo_mime_type' }) photoMimeType!: string | null;
  @Column({ type: 'varchar', length: 4, nullable: true, name: 'aadhaar_last4' }) aadhaarLast4!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) pan!: string | null;
  @Column({ type: 'date', nullable: true, name: 'date_of_birth' }) dateOfBirth!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) gender!: string | null;
  @Column({ type: 'text' }) address!: string;
  @Column({ type: 'varchar', length: 128 }) village!: string;
  @Column({ type: 'varchar', length: 128 }) district!: string;
  @Column({ type: 'varchar', length: 128 }) state!: string;
  @Column({ type: 'varchar', length: 6 }) pincode!: string;
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, name: 'land_holding_acres' }) landHoldingAcres!: string | null;
  @Column({ type: 'int', name: 'share_quantity' }) shareQuantity!: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'share_amount' }) shareAmount!: string;
  @Column({ type: 'enum', enum: MemberApplicationStatus, default: MemberApplicationStatus.PENDING }) @Index() status!: MemberApplicationStatus;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'member_number' }) memberNumber!: string | null;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'identity_card_number' }) identityCardNumber!: string | null;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'share_certificate_number' }) shareCertificateNumber!: string | null;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'folio_number' }) folioNumber!: string | null;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'distinctive_from' }) distinctiveFrom!: string | null;
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'distinctive_to' }) distinctiveTo!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'board_resolution_ref' }) boardResolutionRef!: string | null;
  @Column({ type: 'timestamptz', nullable: true, name: 'share_certificate_issued_at' }) shareCertificateIssuedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true, name: 'reviewed_by_user_id' }) reviewedByUserId!: string | null;
  @Column({ type: 'timestamptz', nullable: true, name: 'reviewed_at' }) reviewedAt!: Date | null;
  @Column({ type: 'text', nullable: true, name: 'decision_note' }) decisionNote!: string | null;
}
