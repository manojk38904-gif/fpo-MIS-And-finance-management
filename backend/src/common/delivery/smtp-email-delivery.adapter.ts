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

@Injectable()
export class SmtpEmailDeliveryAdapter implements EmailDeliveryPort {
  private readonly logger = new Logger(SmtpEmailDeliveryAdapter.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private async getTransporter(): Promise<Transporter> {
    const host = this.config.get<string>('smtp.host');
    if (!host) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }
    if (!this.transporter) {
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
    this.logger.log(`Sending ${message.template} email to ${maskRecipient(message.to)}`);
    const brevoApiKey = this.config.get<string>('brevo.apiKey');
    const resendApiKey = this.config.get<string>('resend.apiKey');

    if (brevoApiKey) {
      await this.sendWithBrevo(brevoApiKey, message);
      return;
    }

    if (resendApiKey) {
      await this.sendWithResend(resendApiKey, message);
      return;
    }

    const transporter = await this.getTransporter();
    await transporter.sendMail({
      from: this.config.get<string>('smtp.fromAddress'),
      to: message.to,
      subject: SUBJECTS[message.template],
      text: renderPlainTextBody(message),
    });
  }

  private async sendWithResend(apiKey: string, message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get<string>('resend.fromAddress'),
        to: [message.to],
        subject: SUBJECTS[message.template],
        text: renderPlainTextBody(message),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Resend rejected ${message.template}: HTTP ${response.status} ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException('Email delivery provider could not send the verification email.');
    }
  }

  private async sendWithBrevo(apiKey: string, message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: this.config.get<string>('brevo.senderEmail'),
          name: this.config.get<string>('brevo.senderName'),
        },
        to: [{ email: message.to }],
        subject: SUBJECTS[message.template],
        textContent: renderPlainTextBody(message),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Brevo rejected ${message.template}: HTTP ${response.status} ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException('Email delivery provider could not send the verification email.');
    }
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
