import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * PostgreSQL connection wiring only (Master SRS §4.1 — frozen: PostgreSQL 15+).
 * Entity registration happens per-module as each Priority's schema is built
 * (Priority #1/#13/#18 entities are added in their own modules, not here).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        ssl: config.get<boolean>('database.ssl') ? { rejectUnauthorized: false } : false,
        entities: [],
        synchronize: false, // Schema changes go through explicit migrations only — never auto-sync.
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
