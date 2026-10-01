/**
 * Correction-pass item 9 — delivery adapter boundary. Every outbound email
 * Priority #1 needs to send goes THROUGH this port — never a direct
 * vendor-SDK call from business logic (kickoff instruction's own frozen
 * cloud-architecture rule: external dependencies live behind adapters).
 * Covers, at minimum: registration OTP, password-reset OTP, tenant
 * activation/FPO-Code notice, and the Initial-Admin secure setup link.
 */
export type EmailTemplate =
  | 'REGISTRATION_OTP'
  | 'PASSWORD_RESET_OTP'
  | 'TENANT_ACTIVATED'
  | 'INITIAL_ADMIN_SETUP_LINK'
  | 'REGISTRATION_RESUME_LINK';

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
  /** Structured, non-secret-by-default data the template renders. Raw secrets
   *  (OTP codes, setup/resume tokens) ARE passed here because the message
   *  genuinely needs to contain them to be useful — but this value is never
   *  logged or audited (see EmailDeliveryPort implementations' own doc). */
  data: Record<string, string>;
}

export const EMAIL_DELIVERY_PORT = Symbol('EMAIL_DELIVERY_PORT');

export interface EmailDeliveryPort {
  send(message: EmailMessage): Promise<void>;
}
