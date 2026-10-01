import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config();

/**
 * CLI-only DataSource for running/generating migrations (`npm run
 * migration:run` etc. — see package.json). This is NEVER imported by the
 * running application (DatabaseModule/TypeOrmModule.forRootAsync is the
 * runtime wiring, with synchronize=false and autoLoadEntities=true); this
 * file exists solely so `typeorm-ts-node-esm` has a DataSource to drive
 * migrations against, with entities discovered the same way Nest discovers
 * them (globbed from the compiled module tree) so the CLI and the app never
 * see a different schema shape.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
