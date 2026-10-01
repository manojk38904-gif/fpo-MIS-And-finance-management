import { Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity.js';

/**
 * Every table holding FPO-tenant data extends this so tenant_id exists,
 * is indexed, and is enforced by RLS (see database/tenant-rls.util.ts).
 * This is the mechanical half of "STRICT MULTI-TENANCY"; the migration that
 * creates the table must still call `enableTenantRls(queryRunner, tableName)`.
 */
export abstract class TenantScopedEntity extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string;
}
