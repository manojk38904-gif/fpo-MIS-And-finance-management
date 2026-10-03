import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../common/auth/jwt-payload.interface.js';
import { PlatformAdminRole } from '../priority1-auth-registration/entities/platform-admin-account.entity.js';
import {
  ApplicationDecisionDto,
  AssignSubscriptionDto,
  ConfigureGraceDto,
  CreatePlanDto,
  CreatePlatformAdminDto,
  DeactivatePlatformAdminDto,
  NewPlanVersionDto,
  PlanStatusDto,
  RecoveryCompleteDto,
  RecoveryDecisionDto,
  RecoveryInitiateDto,
  SubscriptionStateDto,
  SupportAccessRequestDto,
  SupportModuleSummaryDto,
  TenantSupportConsentDto,
  TenantStatusReasonDto,
} from './dto/platform-admin.dto.js';
import { TenantSubscriptionState } from './entities/tenant-subscription.entity.js';
import { PlatformAdminService } from './platform-admin.service.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('api/v1/super-admin')
@UseGuards(JwtAuthGuard)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}

  private actor(req: AuthenticatedRequest, superOnly = false) {
    if (!req.user.isPlatformSuperAdmin || req.user.tenantId) throw new ForbiddenException('Platform administrator access is required.');
    this.platform.assertPlatformRole(req.user.platformRole, superOnly);
    return {
      id: req.user.sub,
      role: req.user.platformRole as PlatformAdminRole,
    };
  }

  @Get('applications')
  applications(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    this.actor(req);
    return this.platform.listApplications({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
      search,
    });
  }

  @Get('applications/:id')
  application(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.actor(req);
    return this.platform.getApplication(id);
  }

  @Post('applications/:id/begin-review')
  beginReview(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: TenantStatusReasonDto) {
    const actor = this.actor(req);
    return this.platform.beginApplicationReview(id, actor.id, dto.reason);
  }

  @Post('applications/:id/approve')
  approveApplication(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ApplicationDecisionDto) {
    const actor = this.actor(req, true);
    return this.platform.approveApplication(id, actor.id, dto.reason);
  }

  @Post('tenants/:id/resend-setup-link')
  resendFpoSetupLink(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = this.actor(req, true);
    return this.platform.resendFpoSetupLink(id, actor.id);
  }

  @Post('applications/:id/reject')
  rejectApplication(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ApplicationDecisionDto) {
    const actor = this.actor(req, true);
    return this.platform.rejectApplication(id, actor.id, dto.reason);
  }

  @Get('tenants')
  tenants(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.listTenants();
  }

  @Get('platform-administrators')
  platformAdmins(@Req() req: AuthenticatedRequest) {
    this.actor(req, true);
    return this.platform.listPlatformAdmins();
  }

  @Post('platform-administrators')
  createPlatformAdmin(@Req() req: AuthenticatedRequest, @Body() dto: CreatePlatformAdminDto) {
    const actor = this.actor(req, true);
    return this.platform.createPlatformAdmin(actor.id, dto);
  }

  @Post('platform-administrators/:id/deactivate')
  deactivatePlatformAdmin(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: DeactivatePlatformAdminDto) {
    const actor = this.actor(req, true);
    return this.platform.deactivatePlatformAdmin(actor.id, id, dto.reason);
  }

  @Post('platform-administrators/recovery')
  initiateRecovery(@Req() req: AuthenticatedRequest, @Body() dto: RecoveryInitiateDto) {
    const actor = this.actor(req, true);
    return this.platform.initiateRecovery(actor.id, dto.targetAdminId, dto.reason);
  }

  @Post('platform-administrators/recovery/:id/decision')
  recoveryDecision(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RecoveryDecisionDto) {
    const actor = this.actor(req, true);
    return this.platform.decideRecovery(actor.id, id, dto.approve, dto.reason);
  }

  @Get('subscription-plans')
  plans(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.listPlans();
  }

  @Post('subscription-plans')
  createPlan(@Req() req: AuthenticatedRequest, @Body() dto: CreatePlanDto) {
    const actor = this.actor(req, true);
    return this.platform.createPlan(actor.id, dto);
  }

  @Post('subscription-plans/version')
  versionPlan(@Req() req: AuthenticatedRequest, @Body() dto: NewPlanVersionDto) {
    const actor = this.actor(req, true);
    return this.platform.createPlanVersion(actor.id, dto);
  }

  @Post('subscription-plans/:id/activate')
  activatePlan(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: PlanStatusDto) {
    const actor = this.actor(req, true);
    return this.platform.setPlanActive(actor.id, id, true, dto.reason);
  }

  @Post('subscription-plans/:id/deactivate')
  deactivatePlan(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: PlanStatusDto) {
    const actor = this.actor(req, true);
    return this.platform.setPlanActive(actor.id, id, false, dto.reason);
  }

  @Post('subscriptions/grace-policy')
  configureGrace(@Req() req: AuthenticatedRequest, @Body() dto: ConfigureGraceDto) {
    const actor = this.actor(req, true);
    return this.platform.configureGrace(actor.id, dto.gracePeriodDays, dto.reason);
  }

  @Get('subscriptions')
  subscriptions(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.listSubscriptions();
  }

  @Post('subscriptions')
  assignSubscription(@Req() req: AuthenticatedRequest, @Body() dto: AssignSubscriptionDto) {
    const actor = this.actor(req, true);
    return this.platform.assignSubscription(actor.id, dto);
  }

  @Post('subscriptions/:tenantId/state')
  changeSubscriptionState(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body() dto: SubscriptionStateDto,
  ) {
    const actor = this.actor(req, true);
    return this.platform.changeSubscriptionState(actor.id, tenantId, dto.state as TenantSubscriptionState, dto.reason);
  }

  @Get('usage')
  usage(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.platformUsage();
  }

  @Get('health')
  health(@Req() req: AuthenticatedRequest) {
    this.actor(req, true);
    return this.platform.platformHealth();
  }

  @Post('support-access')
  supportAccess(@Req() req: AuthenticatedRequest, @Body() dto: SupportAccessRequestDto) {
    const actor = this.actor(req);
    return this.platform.createSupportAccess(actor.id, dto);
  }

  @Get('support-access')
  supportAccessList(@Req() req: AuthenticatedRequest) {
    const actor = this.actor(req);
    return this.platform.listSupportAccess(actor.id);
  }

  @Post('support-access/:id/revoke')
  revokeSupport(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = this.actor(req);
    return this.platform.revokeSupportAccess(actor.id, id);
  }

  @Post('support-access/:id/module-summary')
  supportModuleSummary(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: SupportModuleSummaryDto) {
    const actor = this.actor(req);
    return this.platform.recordSupportModuleSummary(actor.id, id, dto.modules);
  }

  @Get('audit')
  audit(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.platformAuditBoundary();
  }

  @Get('cbbo-agency-hierarchy')
  cbbo(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.cbboDisabledState();
  }

  @Get('security-events')
  securityEvents(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.platform.securityEventsBoundary();
  }
}

@Controller('api/v1/support-access/tenant')
@UseGuards(JwtAuthGuard)
export class TenantSupportAccessController {
  constructor(private readonly platform: PlatformAdminService) {}

  private tenant(req: AuthenticatedRequest) {
    if (req.user.isPlatformSuperAdmin || !req.user.tenantId) throw new ForbiddenException('Tenant user access is required.');
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Post(':id/consent')
  consent(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: TenantSupportConsentDto) {
    const actor = this.tenant(req);
    return this.platform.tenantConsentSupport(actor.tenantId, actor.userId, id, dto.approve, dto.reason);
  }

  @Post(':id/revoke')
  revoke(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = this.tenant(req);
    return this.platform.revokeSupportAccess(actor.userId, id, actor.tenantId);
  }
}

@Controller('api/v1/auth/platform-admin/recovery')
export class PlatformAdminRecoveryController {
  constructor(private readonly platform: PlatformAdminService) {}

  @Post('complete')
  complete(@Body() dto: RecoveryCompleteDto) {
    return this.platform.completeRecovery(dto);
  }
}
