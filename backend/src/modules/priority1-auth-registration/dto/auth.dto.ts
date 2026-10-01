import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/** SYS-01-A. "Remember Me" is a client-side (browser) concern only — it is
 * accepted here purely to document the contract; the backend never changes
 * token lifetimes based on it (per spec, it only ever remembers FPO-Code +
 * Username, never a password, and is explicitly a frontend affordance). */
export class TenantLoginDto {
  @IsString() fpoCode!: string;
  @IsString() usernameOrEmailOrMobile!: string;
  @IsString() password!: string;
  @IsOptional() @IsBoolean() rememberMe?: boolean;
}

/** SYS-01-B — no FPO-Code field. TOTP is mandatory and verified as a second step. */
export class PlatformAdminLoginDto {
  @IsString() usernameOrEmail!: string;
  @IsString() password!: string;
}

export class PlatformAdminMfaDto {
  @IsString() mfaSessionToken!: string;
  @IsString() @Length(6, 6) totpCode!: string;
}

export class RefreshTokenDto {
  @IsString() refreshToken!: string;
}

/**
 * SYS-05. Current/Old-Password field deliberately does not exist (CA-1).
 * Correction-pass item 10: shape/length rules are NOT asserted here any
 * more — `@MinLength(8)` was a second, hard-coded password-policy truth
 * that could never actually be changed by configuration. The DTO only
 * guarantees "a password was supplied, as a string"; the single
 * authoritative PasswordPolicyPort (see AuthService.setupPassword) decides
 * everything about its required shape.
 */
export class SetupPasswordDto {
  @IsString() setupToken!: string;
  @IsString() newPassword!: string;
  @IsString() confirmNewPassword!: string;
}

/** SYS-06 Step-1. */
export class ForgotPasswordDto {
  @IsString() fpoCode!: string;
  @IsString() usernameOrEmailOrMobile!: string;
}

/** SYS-06 Step-2. Correction-pass item 10 — see SetupPasswordDto's identical note. */
export class ResetPasswordDto {
  @IsString() resetRequestId!: string;
  @IsString() @Length(6, 6) otp!: string;
  @IsString() newPassword!: string;
  @IsString() confirmNewPassword!: string;
}
