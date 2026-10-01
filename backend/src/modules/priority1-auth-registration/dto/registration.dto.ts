import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Field-level validation mirrors the frozen SYS-02 field list exactly
 * (point 5 of the spec) — nothing invented, nothing omitted. Partial/draft
 * saves use the same shape with everything optional (PATCH semantics);
 * full-completeness is enforced only at submit time (CA-2 + mandatory-field
 * check), not at every draft save, since Save & Exit must work mid-form.
 */
export class RegistrationDraftDto {
  @IsOptional() @IsString() @MinLength(3) fpoName?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, {
    message: 'CIN must match the Companies Act CIN pattern',
  })
  cin?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsDateString() incorporationDate?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'PAN must be a valid 10-character PAN' })
  pan?: string;
  @IsOptional() @IsString() @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/, {
    message: 'GSTIN must be a valid 15-character GSTIN',
  })
  gstin?: string;
  @IsOptional() @IsString() chairmanName?: string;
  @IsOptional() @IsString() ceoName?: string;
  @IsOptional() @IsString() authorisedPersonName?: string;

  @IsOptional() @IsString() registeredAddress?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() @Matches(/^\d{6}$/, { message: 'PIN must be 6 digits' }) pincode?: string;
  @IsOptional() @IsString() @Matches(/^[6-9]\d{9}$/, { message: 'Official mobile must be a valid 10-digit Indian mobile number' })
  officialMobile?: string;
  @IsOptional() @IsEmail() officialEmail?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: 'Bank account number must be numeric' }) bankAccountNumber?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'IFSC must be a valid 11-character IFSC code' })
  bankIfsc?: string;

  @IsOptional() @IsBoolean() termsAccepted?: boolean;
}

export class SendRegistrationOtpDto {
  @IsEmail() officialEmail!: string;
}

export class VerifyRegistrationOtpDto {
  @IsString() @Length(6, 6) otp!: string;
}

/** Correction-pass item 6 — controlled resume-token re-issuance; caller must prove the registration's own email on file. */
export class ReissueResumeTokenDto {
  @IsString() registrationId!: string;
  @IsEmail() officialEmail!: string;
}
