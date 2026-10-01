import { Injectable } from '@nestjs/common';
import type { EmailDeliveryPort, EmailMessage } from './email-delivery.port.js';

/**
 * TEST/DEV-only adapter (correction-pass items 8+9). Captures sent messages
 * in memory instead of actually delivering them — this is what replaces the
 * removed `console.log`/`OTP_DEV_ECHO` raw-OTP-logging hook. Tests inject
 * this adapter and read `sentMessages` directly to obtain the OTP/token a
 * real test needs, instead of ever having the application log a secret
 * value anywhere. Never bound in production (see EmailDeliveryModule).
 */
@Injectable()
export class InMemoryEmailDeliveryAdapter implements EmailDeliveryPort {
  readonly sentMessages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  /** Test helper — most recent message sent to this address, if any. */
  lastMessageTo(to: string): EmailMessage | undefined {
    return [...this.sentMessages].reverse().find((m) => m.to === to);
  }

  clear(): void {
    this.sentMessages.length = 0;
  }
}
