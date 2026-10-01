import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_DELIVERY_PORT } from './email-delivery.port.js';
import { SmtpEmailDeliveryAdapter } from './smtp-email-delivery.adapter.js';
import { InMemoryEmailDeliveryAdapter } from './in-memory-email-delivery.adapter.js';

/**
 * Correction-pass items 8+9. In `test` NODE_ENV, binds the in-memory
 * capture adapter so tests never need (and the app never performs) real
 * email delivery or raw-OTP console logging. Any other NODE_ENV binds the
 * generic SMTP adapter — which itself fails loudly at send-time if SMTP is
 * not configured, rather than silently doing nothing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    InMemoryEmailDeliveryAdapter,
    {
      provide: EMAIL_DELIVERY_PORT,
      inject: [ConfigService, InMemoryEmailDeliveryAdapter, SmtpEmailDeliveryAdapter],
      useFactory: (config: ConfigService, inMemory: InMemoryEmailDeliveryAdapter, smtp: SmtpEmailDeliveryAdapter) =>
        config.get<string>('nodeEnv') === 'test' ? inMemory : smtp,
    },
    SmtpEmailDeliveryAdapter,
  ],
  exports: [EMAIL_DELIVERY_PORT, InMemoryEmailDeliveryAdapter],
})
export class DeliveryModule {}
