import { Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI, verify } from 'otplib';

/**
 * SYS-01-B — "MFA/TOTP-mandatory" for Platform Super Admin / Support Admin.
 * Standard RFC 6238 TOTP via the well-established `otplib` package.
 *
 * otplib v13's real API (verified via `npm view`/direct inspection in this
 * environment, since its shape differs substantially from the pre-v13
 * `authenticator` singleton this code first assumed): free functions
 * `generateSecret()`, `generate({ secret })`, `verify({ secret, token })` —
 * the latter two are async and `verify` resolves `null` (not `false`) on an
 * invalid token, never throws for a merely-wrong code.
 */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  async verify(token: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({ token, secret });
      return result != null && result.valid === true;
    } catch {
      return false;
    }
  }

  async generateToken(secret: string): Promise<string> {
    return generate({ secret });
  }

  keyUri(secret: string, accountLabel: string, issuer: string): string {
    return generateURI({ issuer, label: accountLabel, secret });
  }
}
