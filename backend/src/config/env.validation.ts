/**
 * Startup validation for infrastructure configuration actually required by
 * the modules currently wired (DB connection, JWT verification, throttling).
 * This does not validate business/domain configuration — Priority #13 tenant
 * settings are not environment variables and are out of scope here.
 *
 * Fails fast (throws before the app finishes bootstrapping) rather than
 * silently starting with an empty JWT secret or missing DATABASE_URL, which
 * would otherwise only surface as a confusing runtime error (or, worse,
 * accept unsigned/trivially-forgeable tokens).
 */
export interface RawEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  JWT_ACCESS_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  THROTTLE_TTL_SECONDS?: string;
  THROTTLE_LIMIT?: string;
  ALLOWED_ORIGINS?: string;
  [key: string]: string | undefined;
}

const MIN_SECRET_LENGTH = 32;

/**
 * Validates an env var that must be a positive integer (> 0) WHEN SUPPLIED.
 * An absent/empty value is not an error here — configuration.ts applies its
 * own default (e.g. 60 seconds, 100 requests) in that case. This only rejects
 * a value that was explicitly set but is not a valid positive integer: "0",
 * "-1", "abc", "NaN", "1.5", etc.
 */
function validatePositiveIntegerIfSupplied(key: string, value: string | undefined, errors: string[]): void {
  if (value === undefined || value.trim() === '') {
    return;
  }
  // Reject anything that isn't purely digits (no sign, no decimal point, no
  // exponent, no whitespace) so "1.5", "-1", "1e3", " 5" etc. are all rejected
  // even though Number()/parseInt() would otherwise coerce them.
  if (!/^\d+$/.test(value.trim())) {
    errors.push(`${key} must be a positive whole number (got "${value}").`);
    return;
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${key} must be a positive whole number greater than zero (got "${value}").`);
  }
}

export function validateEnv(config: Record<string, unknown>): RawEnv {
  const env = config as RawEnv;
  const errors: string[] = [];

  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    errors.push('DATABASE_URL is required and cannot be empty.');
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[key];
    if (!value || value.trim() === '') {
      errors.push(`${key} is required and cannot be empty — authentication is wired in this build.`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      errors.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length}).`);
    } else if (env.NODE_ENV === 'production' && /change-?me/i.test(value)) {
      errors.push(`${key} still contains the placeholder value from .env.example — set a real secret in production.`);
    }
  }

  validatePositiveIntegerIfSupplied('THROTTLE_TTL_SECONDS', env.THROTTLE_TTL_SECONDS, errors);
  validatePositiveIntegerIfSupplied('THROTTLE_LIMIT', env.THROTTLE_LIMIT, errors);

  // Defensive production check only — does not invent a production domain,
  // and does not touch the fail-safe "empty allowlist = no cross-origin
  // access" default. It only rejects an explicit, intentional wildcard.
  if (env.NODE_ENV === 'production' && env.ALLOWED_ORIGINS) {
    const origins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    if (origins.includes('*')) {
      errors.push('ALLOWED_ORIGINS must not contain a wildcard ("*") in production.');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}\n` +
        'See .env.example for the required variables.',
    );
  }

  return env;
}
