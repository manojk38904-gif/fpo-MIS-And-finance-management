import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Priority #18-owned platform configuration. Deliberately contains NO
 * timezone field: CA-18 explicitly forbids inventing a second platform
 * timezone store. The timezone is consumed through architecture/runtime
 * configuration outside this table.
 */
@Entity('platform_configuration')
export class PlatformConfigurationEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @Column({ type: 'uuid' })
  updatedBy!: string;

  @Column({ type: 'text' })
  reason!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
