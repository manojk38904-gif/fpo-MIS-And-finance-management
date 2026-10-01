import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id (PasswordHasher) is correct for passwords, which are verified by
 * fetching a known row (by username) and checking ONE candidate — but it
 * cannot be used for values that must be found BY their hash (OTP codes,
 * setup-link tokens, refresh tokens), because argon2's hash output is
 * randomly salted: the same input never hashes to the same output twice, so
 * `WHERE token_hash = hash(candidate)` can never match.
 *
 * For those lookup-by-hash secrets, this uses a deterministic
 * HMAC-SHA256(serverPepper, value) instead. The raw secret value is still
 * only ever transmitted once (emailed link / OTP / bearer token) and never
 * stored or logged — only this deterministic hash is persisted, and
 * comparison is timing-safe.
 */
@Injectable()
export class SecretTokenHasher {
  private readonly pepper: string;

  constructor(config: ConfigService) {
    // Implementation detail allowed within frozen rule: reuses the existing
    // JWT access secret as the HMAC pepper rather than inventing a new
    // required env var, since both are server-side-only secrets already
    // subject to the same startup length/strength validation.
    this.pepper = config.get<string>('jwt.accessSecret')!;
  }

  hash(value: string): string {
    return createHmac('sha256', this.pepper).update(value).digest('hex');
  }

  verify(value: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hash(value), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  }

  /** Generates a URL-safe random secret for setup-links / refresh tokens. */
  generateOpaqueSecret(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
  }

  /** Generates a numeric OTP code of the given length (default 6, per SYS-03). */
  generateNumericOtp(length = 6): string {
    const digits = '0123456789';
    let out = '';
    const bytes = randomBytes(length);
    for (let i = 0; i < length; i++) {
      out += digits[bytes[i] % digits.length];
    }
    return out;
  }
}
