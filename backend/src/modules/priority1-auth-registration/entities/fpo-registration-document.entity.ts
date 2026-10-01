import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FpoRegistrationEntity } from './fpo-registration.entity.js';

/**
 * SYS-02 Step-4 document uploads. Platform-level (no RLS) for the same
 * pre-tenant reason as FpoRegistrationEntity. Document types are exactly
 * the frozen SYS-02 list — nothing invented.
 *
 * File storage: this pass writes to a configurable local directory
 * (UPLOADS_DIR), not a cloud object store — object-storage provider choice
 * is an infrastructure/cost decision not fixed by Priority #1 v1.2's own
 * text, so it is treated as an Implementation Detail Allowed Within Frozen
 * Rule for Phase-1, with the storage reference kept abstract (`fileKey`) so
 * swapping in S3/DigitalOcean Spaces later touches only the storage adapter,
 * not this entity or any API contract.
 */
export enum FpoRegistrationDocumentType {
  REGISTRATION_CERTIFICATE = 'REGISTRATION_CERTIFICATE',
  INCORPORATION_CERTIFICATE = 'INCORPORATION_CERTIFICATE',
  PAN_UPLOAD = 'PAN_UPLOAD',
  GST_DOCUMENT = 'GST_DOCUMENT',
  LOGO_UPLOAD = 'LOGO_UPLOAD',
}

@Entity('fpo_registration_document')
export class FpoRegistrationDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => FpoRegistrationEntity, { onDelete: 'CASCADE' })
  registration!: FpoRegistrationEntity;

  @Column({ type: 'uuid' })
  @Index()
  registrationId!: string;

  @Column({ type: 'enum', enum: FpoRegistrationDocumentType })
  documentType!: FpoRegistrationDocumentType;

  @Column({ type: 'varchar', length: 512 })
  fileKey!: string;

  @Column({ type: 'varchar', length: 255 })
  originalFileName!: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  uploadedAt!: Date;
}
