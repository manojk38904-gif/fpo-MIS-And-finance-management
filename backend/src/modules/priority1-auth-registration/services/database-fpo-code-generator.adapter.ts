import { Injectable, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { FpoCodeGeneratorPort } from './fpo-code-generator.port.js';
import { FpoRegistrationEntity } from '../entities/fpo-registration.entity.js';

/**
 * Production FPO-code generator. The code uses the organisation initials and
 * adds a numeric suffix only when those initials are already in use.
 */
@Injectable()
export class DatabaseFpoCodeGeneratorAdapter implements FpoCodeGeneratorPort {
  constructor(private readonly dataSource: DataSource) {}

  async generate(fpoName: string, _registrationId: string): Promise<string> {
    const base =
      fpoName
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join('')
        .slice(0, 20) || 'FPO';

    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    for (let suffix = 0; suffix < 10000; suffix++) {
      const candidate = suffix === 0 ? base : `${base}${suffix}`;
      if (!(await repo.exists({ where: { fpoCode: candidate } }))) return candidate;
    }

    throw new ConflictException('Unable to allocate a unique FPO Code.');
  }
}
