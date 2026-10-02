import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import { RequireTenantPermission, TenantPermissionGuard } from '../guards/tenant-permission.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { BranchService } from '../services/branch.service.js';
import { CreateOrUpdateBranchDto, DeactivateBranchDto } from '../dto/branch.dto.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('api/v1/settings/branches')
@UseGuards(JwtAuthGuard, TenantPermissionGuard)
@RequireTenantPermission('SETTINGS.CONFIGURE')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  private requireTenantUser(req: AuthenticatedRequest): { tenantId: string; userId: string } {
    if (!req.user.tenantId) {
      throw new ForbiddenException('This action requires a tenant (FPO) user, not a Platform Super Admin.');
    }
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    const { tenantId } = this.requireTenantUser(req);
    return this.branchService.list(tenantId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrUpdateBranchDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.branchService.create(tenantId, userId, dto);
  }

  @Put(':branchId')
  update(@Req() req: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreateOrUpdateBranchDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.branchService.update(tenantId, branchId, userId, dto);
  }

  @Post(':branchId/deactivate')
  async deactivate(@Req() req: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: DeactivateBranchDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.branchService.deactivate(tenantId, branchId, userId, dto.reason);
    return { deactivated: true };
  }

  @Post(':branchId/reactivate')
  async reactivate(@Req() req: AuthenticatedRequest, @Param('branchId') branchId: string) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.branchService.reactivate(tenantId, branchId, userId);
    return { reactivated: true };
  }
}
