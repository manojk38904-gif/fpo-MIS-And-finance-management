import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { FpoCodeGeneratorPort } from './fpo-code-generator.port.js';

/**
 * Production binding (correction-pass item 4). The Master-SRS Numbering
 * Engine Priority #1 v1.2's own text references does not exist in this
 * codebase. Rather than fabricate a plausible-looking code, this adapter
 * BLOCKS activation outright with a clear, actionable error — the same
 * honest-blocking pattern already used for the 4 Go-Live prerequisite ports
 * that correctly report "not yet configured" (go-live-prerequisite.
 * not-implemented-adapters.ts). Swapping in the real Numbering-Engine-backed
 * adapter later requires no change to any caller (TenantActivationService
 * only depends on FPO_CODE_GENERATOR_PORT, never this class directly).
 */
@Injectable()
export class NotImplementedFpoCodeGeneratorAdapter implements FpoCodeGeneratorPort {
  async generate(_fpoName: string, _registrationId: string): Promise<string> {
    throw new ServiceUnavailableException(
      'FPO-Code generation requires the platform Numbering Engine, which is not yet implemented. ' +
        'Tenant activation is blocked until the authoritative Numbering-Engine-backed FPO_CODE_GENERATOR_PORT adapter is wired in.',
    );
  }
}
