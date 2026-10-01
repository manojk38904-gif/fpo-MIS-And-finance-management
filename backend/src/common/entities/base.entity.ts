import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Generic infrastructure fields only — no business/domain fields belong here.
 * Money fields anywhere in the platform must use PostgreSQL NUMERIC via
 * TypeORM's `type: 'numeric', transformer: ...` pattern, never `float`/`double`
 * (project instruction: "Never use floating-point values for money").
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
