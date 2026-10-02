import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailDeliveryPort, EmailMessage } from './email-delivery.port.js';

const SUBJECTS: Record<EmailMessage['template'], string> = {
  REGISTRATION_OTP: 'Your FPO Registration verification code',
  PASSWORD_RESET_OTP: 'Your password reset code',
  TENANT_ACTIVATED: 'Your FPO account has been activated',
  INITIAL_ADMIN_SETUP_LINK: 'Set up your FPO Admin account',
  REGISTRATION_RESUME_LINK: 'Resume your FPO registration',
  STAFF_USER_SETUP_LINK: 'Set up your FPO staff account',
};

/**
 * Production binding (correction-pass item 9) — generic SMTP via nodemailer,
 * a provider-agnostic transport, never a vendor SDK (no AWS SES / SendGrid
 * client hard-wired into business logic). Actual provider account
 * credentials (SMTP host/user/pass, or an SMTP-compatible endpoint a vendor
 * exposes) remain deployment configuration (SMTP_* env vars), exactly as the
 * frozen cloud-architecture rule requires. If SMTP is not configured
 * (SMTP_HOST empty) this fails LOUDLY on send — it never silently drops a
 * message or falls back to logging a secret.
 */
@Injectable()
export class SmtpEmailDeliveryAdapter implements EmailDeliveryPort {
  private readonly logger = new Logger(SmtpEmailDeliveryAdapter.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    const host = this.config.get<string>('smtp.host');
    if (!host) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured (SMTP_HOST is empty). Configure SMTP_* environment variables before this feature can send real email.',
      );
    }
    if (!this.transporter) {
      this.transporter = createTransport({
        host,
        port: this.config.get<number>('smtp.port'),
        secure: this.config.get<boolean>('smtp.secure'),
        auth: this.config.get<string>('smtp.user')
          ? { user: this.config.get<string>('smtp.user'), pass: this.config.get<string>('smtp.pass') }
          : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const transporter = this.getTransporter();
    const from = this.config.get<string>('smtp.fromAddress');
    // NEVER log `message.data` (it may contain a raw OTP/token) — only
    // structural metadata (recipient, template) is logged, matching the
    // frozen "raw OTP/token value never logged" rule.
    this.logger.log(`Sending ${message.template} email to ${maskRecipient(message.to)}`);
    await transporter.sendMail({
      from,
      to: message.to,
      subject: SUBJECTS[message.template],
      text: renderPlainTextBody(message),
    });
  }
}

function renderPlainTextBody(message: EmailMessage): string {
  const lines = Object.entries(message.data).map(([key, value]) => `${key}: ${value}`);
  return lines.join('\n');
}

function maskRecipient(identifier: string): string {
  const at = identifier.indexOf('@');
  if (at <= 1) return '***';
  return `${identifier[0]}***${identifier.slice(at)}`;
}
