import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { FpoCodeGeneratorPort } from './fpo-code-generator.port.js';

/**
 * Platform numbering-engine adapter for the immutable FPO tenant identifier.
 *
 * The frozen Priority #1 source fixes the lifecycle (platform-generated,
 * unique, immutable, generated immediately after SA-01 approval) but does
 * not freeze a literal format. Therefore the format is deployment
 * configuration, not a hard-coded business rule. No fallback/default is
 * invented: activation blocks until FPO_CODE_FORMAT is explicitly set.
 *
 * Supported token: {seq} or {seq:N}, where N is zero-pad width.
 * Example deployment configuration: FPO-{seq:6}
 */
@Injectable()
export class ConfiguredFpoCodeGeneratorAdapter implements FpoCodeGeneratorPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async generate(_fpoName: string, _registrationId: string): Promise<string> {
    const format = (this.config.get<string>('fpoCode.format') ?? '').trim();
    if (!format) {
      throw new ServiceUnavailableException(
        'FPO-Code Numbering Engine is not configured. Set FPO_CODE_FORMAT before approving tenant activation.',
      );
    }
    if (!/\{seq(?::\d{1,2})?\}/.test(format) || /\{(?!seq(?::\d{1,2})?\})/.test(format)) {
      throw new ServiceUnavailableException(
        'FPO_CODE_FORMAT is invalid. It must contain {seq} or {seq:N} and no unsupported template tokens.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'INSERT INTO "platform_number_sequence" ("sequenceKey","nextValue") VALUES ($1,1) ON CONFLICT ("sequenceKey") DO NOTHING',
        ['FPO_CODE'],
      );
      const rows = await manager.query(
        'SELECT "nextValue" FROM "platform_number_sequence" WHERE "sequenceKey" = $1 FOR UPDATE',
        ['FPO_CODE'],
      ) as Array<{ nextValue: string | number }>;
      const seq = Number(rows[0]?.nextValue);
      if (!Number.isSafeInteger(seq) || seq < 1) {
        throw new ServiceUnavailableException('FPO-Code sequence is unavailable.');
      }

      const code = format.replace(/\{seq(?::(\d{1,2}))?\}/g, (_m, width?: string) => {
        const raw = String(seq);
        return width ? raw.padStart(Number(width), '0') : raw;
      });
      if (!/^[A-Za-z0-9._/-]{1,32}$/.test(code)) {
        throw new ServiceUnavailableException(
          'Configured FPO-Code format produced an invalid code. Use only letters, digits, dot, underscore, slash or hyphen; maximum length is 32.',
        );
      }

      await manager.query(
        'UPDATE "platform_number_sequence" SET "nextValue" = "nextValue" + 1, "updatedAt" = now() WHERE "sequenceKey" = $1',
        ['FPO_CODE'],
      );
      return code;
    });
  }
}
