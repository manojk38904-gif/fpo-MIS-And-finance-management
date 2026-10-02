import { ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateUserRequestDto {
  @IsString() @MinLength(2) fullName!: string;
  @IsString() mobile!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() roleId!: string;
  @IsIn(['SELECTED_BRANCH', 'ALL_BRANCHES']) branchAccessScope!: 'SELECTED_BRANCH' | 'ALL_BRANCHES';
  @ValidateIf((o) => o.branchAccessScope === 'SELECTED_BRANCH')
  @IsArray()
  @ArrayMinSize(1)
  selectedBranchIds?: string[];
}

export class EditUserRequestDto {
  @IsString() targetUserId!: string;
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsIn(['SELECTED_BRANCH', 'ALL_BRANCHES']) branchAccessScope?: 'SELECTED_BRANCH' | 'ALL_BRANCHES';
  @IsOptional() @IsArray() selectedBranchIds?: string[];
}

export class TargetUserDto {
  @IsString() targetUserId!: string;
}

export class DecisionReasonDto {
  @IsString() @MinLength(3) reason!: string;
}
