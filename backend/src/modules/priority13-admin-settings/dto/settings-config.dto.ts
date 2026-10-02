import { IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class GovernedSettingDraftDto {
  @IsString() @MinLength(1) configKey!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsString() supersedesId?: string;
  @IsOptional() @IsIn(['UPSERT', 'DEACTIVATE', 'REACTIVATE']) action?: 'UPSERT' | 'DEACTIVATE' | 'REACTIVATE';
}

export class DecisionDto {
  @IsOptional() @IsString() reason?: string;
}

export class ProfileUpdateDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsString() fpoName?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() registeredAddress?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() officialMobile?: string;
  @IsOptional() @IsString() officialEmail?: string;
  @IsOptional() @IsString() website?: string;
}

export class DirectSettingSaveDto {
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

export class FinancialYearCreateDto {
  @IsString() @MinLength(1) fyCode!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

export class DataExportRequestDto {
  @IsIn(['ALL_DATA', 'SELECTED_MODULES']) scope!: 'ALL_DATA' | 'SELECTED_MODULES';
  @IsOptional() @IsArray() modules?: string[];
  @IsOptional() @IsDateString() fromDate?: string;
  @IsOptional() @IsDateString() toDate?: string;
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

export class RetentionConfigurationDto {
  @IsString() @MinLength(1) retentionPeriod!: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
