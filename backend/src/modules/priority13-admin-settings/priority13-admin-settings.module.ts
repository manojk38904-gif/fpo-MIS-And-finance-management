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
  providers: [RoleService, BranchService, UserProvisioningService, SettingsConfigService],
  controllers: [RoleController, BranchController, UserProvisioningController, SettingsConfigController],
  exports: [RoleService, BranchService, UserProvisioningService, SettingsConfigService],
})
export class Priority13AdminSettingsModule {}
