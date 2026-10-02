import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { UserProvisioningService } from '../services/user-provisioning.service.js';
import { CreateUserRequestDto, DecisionReasonDto, EditUserRequestDto, TargetUserDto } from '../dto/user-provisioning.dto.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/** SET-07 — Users. See UserProvisioningService for scope and the disclosed setup-link gap. */
@Controller('api/v1/settings/users')
@UseGuards(JwtAuthGuard)
export class UserProvisioningController {
  constructor(private readonly userProvisioningService: UserProvisioningService) {}

  private requireTenantUser(req: AuthenticatedRequest): { tenantId: string; userId: string } {
    if (!req.user.tenantId) {
      throw new ForbiddenException('This action requires a tenant (FPO) user, not a Platform Super Admin.');
    }
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Get('requests')
  list(@Req() req: AuthenticatedRequest) {
    const { tenantId } = this.requireTenantUser(req);
    return this.userProvisioningService.list(tenantId);
  }

  @Post('requests')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateUserRequestDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.userProvisioningService.createDraft(tenantId, userId, dto);
  }

  @Post('requests/edit')
  edit(@Req() req: AuthenticatedRequest, @Body() dto: EditUserRequestDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.userProvisioningService.editDraft(tenantId, userId, dto);
  }

  @Post('requests/deactivate')
  deactivate(@Req() req: AuthenticatedRequest, @Body() dto: TargetUserDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.userProvisioningService.requestDeactivation(tenantId, userId, dto.targetUserId);
  }

  @Post('requests/reactivate')
  reactivate(@Req() req: AuthenticatedRequest, @Body() dto: TargetUserDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.userProvisioningService.requestReactivation(tenantId, userId, dto.targetUserId);
  }

  @Post('requests/:requestId/submit')
  async submit(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.userProvisioningService.submit(tenantId, requestId, userId);
    return { submitted: true };
  }

  @Post('requests/:requestId/approve')
  async approve(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.userProvisioningService.approve(tenantId, requestId, userId);
    return { approved: true };
  }

  @Post('requests/:requestId/reject')
  async reject(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string, @Body() dto: DecisionReasonDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.userProvisioningService.reject(tenantId, requestId, userId, dto.reason);
    return { rejected: true };
  }

  @Post('requests/:requestId/send-back')
  async sendBack(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string, @Body() dto: DecisionReasonDto) {
    const { tenantId, userId } = this.requireTenantUser(req);
    await this.userProvisioningService.sendBack(tenantId, requestId, userId, dto.reason);
    return { sentBack: true };
  }
}
