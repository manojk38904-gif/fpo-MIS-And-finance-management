import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailDeliveryPort, EmailMessage } from './email-delivery.port.js';

const SUBJECTS: Record<EmailMessage['template'], string> = {
  REGISTRATION_OTP: 'Your FPO Registration verification code',
  PASSWORD_RESET_OTP: 'Your password reset code',
  TENANT_ACTIVATED: 'Your FPO account has been activated',
  INITIAL_ADMIN_SETUP_LINK: 'Set up your FPO Admin account',
  REGISTRATION_RESUME_LINK: 'Resume your FPO registration',
};

/**
 * Production binding — generic SMTP via nodemailer. Provider credentials stay
 * in SMTP_* deployment configuration and are never logged.
 */
@Injectable()
export class SmtpEmailDeliveryAdapter implements EmailDeliveryPort {
  private readonly logger = new Logger(SmtpEmailDeliveryAdapter.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private async getTransporter(): Promise<Transporter> {
    const host = this.config.get<string>('smtp.host');
    if (!host) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured (SMTP_HOST is empty). Configure SMTP_* environment variables before this feature can send real email.',
      );
    }

    if (!this.transporter) {
      // Gmail resolves to IPv6 first in this Render region, where SMTP egress is
      // unavailable. Resolve and connect to an IPv4 address explicitly, while
      // retaining the hostname for TLS certificate validation.
      const { address } = await lookup(host, { family: 4 });
      this.transporter = createTransport({
        host: address,
        port: this.config.get<number>('smtp.port'),
        secure: this.config.get<boolean>('smtp.secure'),
        tls: { servername: host },
        auth: this.config.get<string>('smtp.user')
          ? { user: this.config.get<string>('smtp.user'), pass: this.config.get<string>('smtp.pass') }
          : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const transporter = await this.getTransporter();
    const from = this.config.get<string>('smtp.fromAddress');
    // Raw OTP/token values are never logged.
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
