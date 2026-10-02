import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from './entities/role.entity.js';
import { RoleService } from './services/role.service.js';
import { RoleController } from './controllers/role.controller.js';
import { BranchEntity } from './entities/branch.entity.js';
import { BranchService } from './services/branch.service.js';
import { BranchController } from './controllers/branch.controller.js';

/**
 * PHASE 2.2 — PRIORITY #13 — Administration / Settings / RBAC.
 * Built so far: SET-08 (Roles & Permissions), SET-03 (Branch Master). The
 * remaining 16 screens (SET-01,02,05,06,07,09,11,12,13,14,15,16,17,20,21,22)
 * are not yet built — see backend/README.md for the honest current-scope
 * statement.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, BranchEntity])],
  providers: [RoleService, BranchService],
  controllers: [RoleController, BranchController],
  exports: [RoleService, BranchService],
})
export class Priority13AdminSettingsModule {}
