import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrEditRoleDraftDto {
  @IsString() @MinLength(2) roleName!: string;
  @IsOptional() @IsString() description?: string;
  /** Module -> Action[] matrix. e.g. { "SETTINGS": ["VIEW", "CONFIGURE"] } */
  @IsObject() permissions!: Record<string, string[]>;
  @IsOptional() @IsIn(['SELECTED_BRANCH', 'ALL_BRANCHES']) scopeDefault?: 'SELECTED_BRANCH' | 'ALL_BRANCHES';
  /** Set only when this draft is an edit of an existing ACTIVE role, not a brand-new one. */
  @IsOptional() @IsString() supersedesId?: string;
}

export class DecisionReasonDto {
  @IsString() @MinLength(3) reason!: string;
}
