import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const BASE_VALID_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv — THROTTLE_TTL_SECONDS / THROTTLE_LIMIT', () => {
  it('passes when both are omitted (configuration.ts applies its own defaults)', () => {
    expect(() => validateEnv({ ...BASE_VALID_ENV })).not.toThrow();
  });

  it('passes with valid positive integers', () => {
    expect(() =>
      validateEnv({ ...BASE_VALID_ENV, THROTTLE_TTL_SECONDS: '60', THROTTLE_LIMIT: '100' }),
    ).not.toThrow();
  });

  it.each([
    ['THROTTLE_TTL_SECONDS', '0'],
    ['THROTTLE_TTL_SECONDS', '-1'],
    ['THROTTLE_TTL_SECONDS', 'abc'],
    ['THROTTLE_TTL_SECONDS', 'NaN'],
    ['THROTTLE_TTL_SECONDS', '1.5'],
    ['THROTTLE_LIMIT', '0'],
    ['THROTTLE_LIMIT', '-1'],
    ['THROTTLE_LIMIT', 'abc'],
    ['THROTTLE_LIMIT', 'NaN'],
    ['THROTTLE_LIMIT', '2.5'],
  ])('fails startup when %s = "%s"', (key, value) => {
    expect(() => validateEnv({ ...BASE_VALID_ENV, [key]: value })).toThrow();
  });

  it('does not invent a second throttle configuration source — only validates, never sets a value', () => {
    const result = validateEnv({ ...BASE_VALID_ENV, THROTTLE_TTL_SECONDS: '60', THROTTLE_LIMIT: '100' });
    // validateEnv returns the env unchanged (pass-through), it does not add
    // parsed/derived fields — configuration.ts remains the single loader.
    expect(result.THROTTLE_TTL_SECONDS).toBe('60');
    expect(result.THROTTLE_LIMIT).toBe('100');
  });
});

describe('validateEnv — ALLOWED_ORIGINS wildcard (production only)', () => {
  it('rejects an explicit wildcard in production', () => {
    expect(() =>
      validateEnv({ ...BASE_VALID_ENV, NODE_ENV: 'production', ALLOWED_ORIGINS: '*' }),
    ).toThrow();
  });

  it('allows a wildcard-free explicit allowlist in production', () => {
    expect(() =>
      validateEnv({
        ...BASE_VALID_ENV,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'c'.repeat(32),
        JWT_REFRESH_SECRET: 'd'.repeat(32),
        ALLOWED_ORIGINS: 'https://app.example.com',
      }),
    ).not.toThrow();
  });

  it('does not reject an empty ALLOWED_ORIGINS in production (fail-safe default is preserved)', () => {
    expect(() =>
      validateEnv({
        ...BASE_VALID_ENV,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'c'.repeat(32),
        JWT_REFRESH_SECRET: 'd'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('does not reject a wildcard outside production', () => {
    expect(() => validateEnv({ ...BASE_VALID_ENV, ALLOWED_ORIGINS: '*' })).not.toThrow();
  });
});
