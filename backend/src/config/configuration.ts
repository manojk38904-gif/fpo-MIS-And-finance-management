/**
 * Central environment configuration loader.
 *
 * No business rule (interest policy, approval hierarchy, credit policy, etc.)
 * is hard-coded here — per project instructions, those remain tenant-configurable
 * and are owned by their respective frozen Priority modules (mainly Priority #13).
 * This file only wires infrastructure-level settings (DB, JWT, throttling, Redis).
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
    ssl: boolean;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  throttle: {
    ttlSeconds: number;
    limit: number;
  };
  redis: {
    url: string;
  };
  cors: {
    /** Explicit allowlist only — empty by default (fail-safe: no cross-origin access until configured). */
    allowedOrigins: string[];
  };
  /**
   * Priority #1 SYS-03 OTP parameters. Spec explicitly says not to invent
   * fixed limits where the frozen text leaves them configurable — these are
   * illustrative starting defaults (matching the spec's own example values),
   * never hard-coded into business logic itself.
   */
  otp: {
    ttlSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
  };
  /** CA-1 secure setup-link — "no fixed/hard-coded expiry duration", configurable only. */
  setupLink: {
    expiryHours: number;
  };
  /** Login lockout — illustrative defaults only, per SYS-01-A's configurable lockout message. */
  accountLockout: {
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
  refreshToken: {
    expiryDays: number;
  };
  /** SYS-05/SYS-06 — illustrative-only example values (Owner Decision #2); the actual rule stays tenant/platform configurable, never hard-coded in business logic. This is the SOLE authoritative source (PasswordPolicyPort) — correction-pass item 10. */
  passwordPolicy: {
    minLength: number;
    requireLetter: boolean;
    requireDigit: boolean;
    requireSpecialChar: boolean;
  };
  /** Correction-pass item 1 — Redis-backed session TTL (mirrors refresh-token lifetime; the access token's own short JWT expiry is separate and shorter). */
  session: {
    ttlSeconds: number;
    /** Short-lived MFA-pending ticket (SYS-01-B step 1→2) — bounded separately from a full session. */
    mfaTicketTtlSeconds: number;
  };
  /** Correction-pass item 9 — generic SMTP boundary (EmailDeliveryPort). Never a vendor-specific SDK call from business logic. */
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromAddress: string;
  };
  /** HTTPS transactional email provider used when RESEND_API_KEY is configured. */
  resend: {
    apiKey: string;
    fromAddress: string;
  };
  /** HTTPS transactional email provider used when BREVO_API_KEY is configured. */
  brevo: {
    apiKey: string;
    senderEmail: string;
    senderName: string;
  };
  /** Correction-pass item 12 — document-upload boundary. */
  upload: {
    maxSizeBytes: number;
    allowedMimeTypes: string[];
  };
  platform: {
    /** 0 = deliberately unconfigured; recovery remains blocked until explicitly configured. */
    recoveryRequestTtlHours: number;
    /** 0 = deliberately unconfigured; support access remains blocked until explicitly configured. */
    supportAccessMaxMinutes: number;
  };
  uploadsDir: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL ?? '',
    ssl: process.env.DATABASE_SSL === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '600', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '3', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '30', 10),
  },
  setupLink: {
    expiryHours: parseInt(process.env.SETUP_LINK_EXPIRY_HOURS ?? '72', 10),
  },
  accountLockout: {
    maxFailedAttempts: parseInt(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS ?? '5', 10),
    lockoutMinutes: parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES ?? '15', 10),
  },
  refreshToken: {
    expiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS ?? '30', 10),
  },
  passwordPolicy: {
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH ?? '8', 10),
    requireLetter: process.env.PASSWORD_REQUIRE_LETTER !== 'false',
    requireDigit: process.env.PASSWORD_REQUIRE_DIGIT !== 'false',
    requireSpecialChar: process.env.PASSWORD_REQUIRE_SPECIAL_CHAR === 'true',
  },
  session: {
    ttlSeconds: parseInt(process.env.SESSION_TTL_SECONDS ?? String(30 * 24 * 60 * 60), 10),
    mfaTicketTtlSeconds: parseInt(process.env.MFA_TICKET_TTL_SECONDS ?? '300', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    fromAddress: process.env.SMTP_FROM_ADDRESS ?? 'no-reply@example.invalid',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    fromAddress: process.env.RESEND_FROM_ADDRESS ?? 'FPO MIS <onboarding@resend.dev>',
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY ?? '',
    senderEmail: process.env.BREVO_SENDER_EMAIL ?? 'sanrakshitfpo@gmail.com',
    senderName: process.env.BREVO_SENDER_NAME ?? 'Sanrakshit FPO MIS',
  },
  upload: {
    maxSizeBytes: parseInt(process.env.UPLOAD_MAX_SIZE_BYTES ?? String(10 * 1024 * 1024), 10),
    allowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME_TYPES ?? 'application/pdf,image/jpeg,image/png')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  },
  platform: {
    recoveryRequestTtlHours: parseInt(process.env.PLATFORM_RECOVERY_REQUEST_TTL_HOURS ?? '0', 10),
    supportAccessMaxMinutes: parseInt(process.env.PLATFORM_SUPPORT_ACCESS_MAX_MINUTES ?? '0', 10),
  },
  uploadsDir: process.env.UPLOADS_DIR ?? '',
});
