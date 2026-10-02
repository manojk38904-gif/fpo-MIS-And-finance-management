import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from './entities/role.entity.js';
import { RoleService } from './services/role.service.js';
import { RoleController } from './controllers/role.controller.js';

/**
 * PHASE 2.2 — PRIORITY #13 — Administration / Settings / RBAC.
 * First slice: SET-08 (Roles & Permissions). The remaining 17 screens
 * (SET-01,02,03,05,06,07,09,11,12,13,14,15,16,17,20,21,22) are not yet built
 * — see backend/README.md for the honest current-scope statement.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity])],
  providers: [RoleService],
  controllers: [RoleController],
  exports: [RoleService],
})
export class Priority13AdminSettingsModule {}
