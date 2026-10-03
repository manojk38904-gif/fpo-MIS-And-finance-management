import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';

export class CreateMemberApplicationDto {
  @IsString() @Matches(/^[A-Z0-9]{2,32}$/) fpoCode!: string;
  @IsString() @MinLength(3) fullName!: string;
  @Matches(/^[6-9]\d{9}$/) mobile!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(/^\d{4}$/) aadhaarLast4?: string;
  @IsOptional() @Matches(/^[A-Z]{5}\d{4}[A-Z]$/) pan?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @IsString() @MinLength(5) address!: string;
  @IsString() @MinLength(2) village!: string;
  @IsString() @MinLength(2) district!: string;
  @IsString() @MinLength(2) state!: string;
  @Matches(/^\d{6}$/) pincode!: string;
  @IsOptional() @IsString() landHoldingAcres?: string;
  @IsInt() @Min(1) @Max(10000) shareQuantity!: number;
  @IsString() @Matches(/^\d+(\.\d{1,2})?$/) shareAmount!: string;
}

export class DecideMemberApplicationDto {
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MinLength(3) note?: string;
}