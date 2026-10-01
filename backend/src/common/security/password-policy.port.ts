/**
 * Correction-pass item 10 — exactly ONE authoritative password-policy truth.
 * Previously, password rules were hard-coded in THREE independent places
 * (`SetupPasswordDto`'s `@MinLength(8)`, `ResetPasswordDto`'s `@MinLength(8)`,
 * and `AuthService.assertPasswordComplexity()`'s unconditional letter+digit
 * requirement) — none of which could actually be changed by configuration,
 * despite being documented as "illustrative, not hard-coded". This port is
 * now the single place policy is read from and enforced; DTOs only assert
 * `@IsString()` (a password must be a string at all), nothing about shape.
 *
 * Until Priority #13 supplies a tenant-specific policy, the ONLY legitimate
 * source is the platform/bootstrap configuration (ConfigService) — never a
 * second, independently-invented default living in a DTO or service.
 */
export interface PasswordPolicy {
  minLength: number;
  requireLetter: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}

export const PASSWORD_POLICY_PORT = Symbol('PASSWORD_POLICY_PORT');

export interface PasswordPolicyPort {
  getPolicy(): Promise<PasswordPolicy>;
  /** Throws BadRequestException with an explanatory message if the password violates the current policy. */
  assertValid(password: string): Promise<void>;
}
