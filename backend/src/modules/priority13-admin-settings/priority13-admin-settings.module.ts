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

/**
 * PHASE 2.2 — PRIORITY #13 — Administration / Settings / RBAC.
 * Built so far: SET-08 (Roles & Permissions), SET-03 (Branch Master), SET-07
 * (Users). The remaining 15 screens (SET-01,02,05,06,09,11,12,13,14,15,16,
 * 17,20,21,22) are not yet built — see backend/README.md for the honest
 * current-scope statement, including SET-07's own disclosed setup-link gap.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, BranchEntity, UserProvisioningRequestEntity, UserBranchAssignmentEntity, UserAccountEntity])],
  providers: [RoleService, BranchService, UserProvisioningService],
  controllers: [RoleController, BranchController, UserProvisioningController],
  exports: [RoleService, BranchService, UserProvisioningService],
})
export class Priority13AdminSettingsModule {}
