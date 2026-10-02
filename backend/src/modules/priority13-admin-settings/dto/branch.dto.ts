import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrUpdateBranchDto {
  @IsString() @MinLength(1) branchCode!: string;
  @IsString() @MinLength(1) branchName!: string;
  @IsIn(['HEAD_OFFICE', 'REGULAR']) branchType!: 'HEAD_OFFICE' | 'REGULAR';
  @IsString() @MinLength(1) address!: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() managerUserId?: string;
  @IsDateString() openingDate!: string;
}

export class DeactivateBranchDto {
  @IsString() @MinLength(3) reason!: string;
}

export class SetBranchActiveDto {
  @IsBoolean() isActive!: boolean;
}
