import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { FpoCodeGeneratorPort } from './fpo-code-generator.port.js';
import { FpoRegistrationEntity } from '../entities/fpo-registration.entity.js';

/**
 * TEST-ONLY adapter (correction-pass item 4) — never bound in the real
 * application module, only in test setups that need activation to actually
 * produce a code without a real Numbering Engine. Uses the same
 * initials+disambiguator shape as before, but is now explicitly and only a
 * test fixture, never presented as production-acceptable.
 */
@Injectable()
export class TestFpoCodeGeneratorAdapter implements FpoCodeGeneratorPort {
  constructor(private readonly dataSource: DataSource) {}

  async generate(fpoName: string): Promise<string> {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const base =
      fpoName
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join('')
        .slice(0, 6) || 'FPO';

    for (let suffix = 0; suffix < 10000; suffix++) {
      const candidate = suffix === 0 ? base : `${base}${suffix}`;
      const exists = await repo.findOne({ where: { fpoCode: candidate } });
      if (!exists) return candidate;
    }
    throw new Error('Unable to generate a unique test FPO Code.');
  }
}
