import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { RoleService } from '../services/role.service.js';
import { CreateOrEditRoleDraftDto, DecisionReasonDto } from '../dto/role.dto.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * SET-08 — Roles & Permissions. Tenant-scoped only (never reachable by a
 * Platform Super Admin — tenantId/userId always come from the guard-verified
 * JWT, never a client-supplied value, matching OnboardingController's
 * pattern from Priority #1).
 */
@Controller('api/v1/settings/roles')
@UseGuards(JwtAuthGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  private requireTenantUser(req: AuthenticatedRequest): { tenantId: string; userId: string } {
    if (!req.user.tenantId) {
      throw new ForbiddenException('This action requires a tenant (FPO) user, not a Platform Super Admin.');
    }
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    const { tenantId } = this.requireTenantUser(req);
    return this.roleService.list(tenantId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrEditRoleDraftDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.roleService.createDraft(tenantId, userId, dto);
  }

  @Post(':roleId/submit')
  async submit(@Req() req: AuthenticatedRequest, @Param('roleId') roleId: string) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.roleService.submit(tenantId, roleId, userId);
    return { submitted: true };
  }

  @Post(':roleId/approve')
  async approve(@Req() req: AuthenticatedRequest, @Param('roleId') roleId: string) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.roleService.approve(tenantId, roleId, userId);
    return { approved: true };
  }

  @Post(':roleId/reject')
  async reject(@Req() req: AuthenticatedRequest, @Param('roleId') roleId: string, @Body() dto: DecisionReasonDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.roleService.reject(tenantId, roleId, userId, dto.reason);
    return { rejected: true };
  }

  @Post(':roleId/send-back')
  async sendBack(@Req() req: AuthenticatedRequest, @Param('roleId') roleId: string, @Body() dto: DecisionReasonDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.roleService.sendBack(tenantId, roleId, userId, dto.reason);
    return { sentBack: true };
  }
}
