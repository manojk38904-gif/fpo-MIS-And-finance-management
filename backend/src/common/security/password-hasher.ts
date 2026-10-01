import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * SECURITY CORRECTION (Phase-1 foundation review): the frozen security
 * requirement is Argon2id, not bcrypt. This wrapper exists so Priority #1's
 * future credential-creation/login endpoints have one shared, correct place
 * to hash and verify passwords — no password POLICY (length rules, complexity,
 * expiry) is decided here, since that is Priority #1's own frozen
 * specification to implement, not something to invent in shared foundation
 * code. The argon2id `type` selection itself is the one thing the frozen
 * security requirement fixes explicitly; the cost parameters below are an
 * "Implementation Detail Allowed Within Frozen Rule" — reasonable current
 * OWASP-recommended defaults — until/unless a frozen source specifies exact
 * values.
 */
@Injectable()
export class PasswordHasher {
  async hash(plainTextPassword: string): Promise<string> {
    return argon2.hash(plainTextPassword, { type: argon2.argon2id });
  }

  async verify(hash: string, plainTextPassword: string): Promise<boolean> {
    return argon2.verify(hash, plainTextPassword);
  }
}
