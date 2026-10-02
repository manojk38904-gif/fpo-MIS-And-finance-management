import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from './entities/role.entity.js';
import { RoleService } from './services/role.service.js';
import { RoleController } from './controllers/role.controller.js';
import { BranchEntity } from './entities/branch.entity.js';
import { BranchService } from './services/branch.service.js';
import { BranchController } from './controllers/branch.controller.js';
import { UserProvisioningRequestEntity } from './entities/user-provisioning-request.entity.js';
import { UserBranchAssignmentEntity } from './entities/user-branch-assignment.entity.js';
import { UserProvisioningService } from './services/user-provisioning.service.js';
import { UserProvisioningController } from './controllers/user-provisioning.controller.js';
import { UserAccountEntity } from '../priority1-auth-registration/entities/user-account.entity.js';
import { GovernedSettingEntity } from './entities/governed-setting.entity.js';
import { DirectSettingEntity } from './entities/direct-setting.entity.js';
import { DataExportRequestEntity } from './entities/data-export-request.entity.js';
import { SettingsConfigService } from './services/settings-config.service.js';
import { SettingsConfigController } from './controllers/settings-config.controller.js';
import { StaffSetupTokenEntity } from './entities/staff-setup-token.entity.js';
import { StaffSetupService } from './services/staff-setup.service.js';
import { StaffSetupController } from './controllers/staff-setup.controller.js';
import { SettingsAssetController } from './controllers/settings-asset.controller.js';
import { TenantRbacService } from './services/tenant-rbac.service.js';
import { TenantPermissionGuard } from './guards/tenant-permission.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoleEntity,
      BranchEntity,
      UserProvisioningRequestEntity,
      UserBranchAssignmentEntity,
      UserAccountEntity,
      GovernedSettingEntity,
      DirectSettingEntity,
      DataExportRequestEntity,
    ]),
  ],
  providers: [RoleService, BranchService, UserProvisioningService, SettingsConfigService, StaffSetupService, TenantRbacService, TenantPermissionGuard],
  controllers: [RoleController, BranchController, UserProvisioningController, SettingsConfigController, StaffSetupController, SettingsAssetController],
  exports: [RoleService, BranchService, UserProvisioningService, SettingsConfigService, StaffSetupService, TenantRbacService, TenantPermissionGuard],
})
export class Priority13AdminSettingsModule {}
