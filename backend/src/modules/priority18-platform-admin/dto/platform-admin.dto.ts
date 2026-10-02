import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class ApplicationDecisionDto {
  @IsString() @MinLength(3) reason!: string;
}

export class TenantStatusReasonDto {
  @IsString() @MinLength(3) reason!: string;
}

export class CreatePlanDto {
  @IsString() @MinLength(1) planCode!: string;
  @IsString() @MinLength(1) planName!: string;
  @IsObject() limits!: Record<string, number | boolean | string>;
  @IsObject() features!: Record<string, boolean | string | number>;
  @IsDateString() effectiveDate!: string;
  @IsString() @MinLength(3) reason!: string;
}

export class NewPlanVersionDto extends CreatePlanDto {
  @IsUUID() supersedesId!: string;
}

export class PlanStatusDto {
  @IsString() @MinLength(3) reason!: string;
}

export class AssignSubscriptionDto {
  @IsUUID() tenantId!: string;
  @IsUUID() planVersionId!: string;
  @IsDateString() startDate!: string;
  @IsDateString() expiryDate!: string;
  @IsString() @MinLength(3) reason!: string;
}

export class SubscriptionStateDto {
  @IsIn(['ACTIVE', 'NEARING_EXPIRY', 'GRACE', 'EXPIRED_READ_ONLY', 'SUSPENDED', 'REACTIVATED'])
  state!: 'ACTIVE' | 'NEARING_EXPIRY' | 'GRACE' | 'EXPIRED_READ_ONLY' | 'SUSPENDED' | 'REACTIVATED';
  @IsString() @MinLength(3) reason!: string;
}

export class ConfigureGraceDto {
  @IsInt() @Min(0) gracePeriodDays!: number;
  @IsString() @MinLength(3) reason!: string;
}

export class SupportAccessRequestDto {
  @IsUUID() tenantId!: string;
  @IsString() @MinLength(3) reason!: string;
  @IsString() @MinLength(1) ticketContext!: string;
  @IsInt() @Min(1) requestedDurationMinutes!: number;
  @IsOptional() @IsString() idempotencyKey?: string;
}

export class TenantSupportConsentDto {
  @IsBoolean() approve!: boolean;
  @IsString() @MinLength(3) reason!: string;
}

export class SupportModuleSummaryDto {
  @IsArray() @IsString({ each: true }) modules!: string[];
}

export class RecoveryInitiateDto {
  @IsUUID() targetAdminId!: string;
  @IsString() @MinLength(3) reason!: string;
}

export class RecoveryDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsString() @MinLength(3) reason!: string;
}

export class RecoveryCompleteDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(1) usernameOrEmail!: string;
  @IsString() @MinLength(6) totpCode!: string;
  @IsString() newPassword!: string;
  @IsString() confirmNewPassword!: string;
}

export class CreatePlatformAdminDto {
  @IsString() @MinLength(3) username!: string;
  @IsEmail() email!: string;
  @IsIn(['SUPER_ADMIN', 'SUPPORT_ADMIN']) role!: 'SUPER_ADMIN' | 'SUPPORT_ADMIN';
  @IsString() password!: string;
  @IsString() @MinLength(16) totpSecret!: string;
  @IsString() @MinLength(3) reason!: string;
}

export class DeactivatePlatformAdminDto {
  @IsString() @MinLength(3) reason!: string;
}
