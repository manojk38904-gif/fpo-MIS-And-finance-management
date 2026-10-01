import { Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { OnboardingService } from '../services/onboarding.service.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * SYS-04 — step progress + Go-Live. Authenticated, tenant-scoped (never a
 * Platform Super Admin route — tenantId/userId come only from the
 * guard-verified JWT, never a client-supplied body/param, so a forged tenant
 * id can never be presented here).
 */
@Controller('api/v1/onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  private requireTenantUser(req: AuthenticatedRequest): { tenantId: string; userId: string } {
    if (!req.user.tenantId) {
      throw new ForbiddenException('This action requires a tenant (FPO) user, not a Platform Super Admin.');
    }
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Get('progress')
  getProgress(@Req() req: AuthenticatedRequest) {
    const { tenantId } = this.requireTenantUser(req);
    return this.onboardingService.getProgress(tenantId);
  }

  @Post('steps/:stepNumber/complete')
  completeStep(@Req() req: AuthenticatedRequest, @Param('stepNumber', ParseIntPipe) stepNumber: number) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.onboardingService.completeStep(tenantId, stepNumber, userId);
  }

  @Post('steps/:stepNumber/skip')
  skipStep(@Req() req: AuthenticatedRequest, @Param('stepNumber', ParseIntPipe) stepNumber: number) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.onboardingService.skipStep(tenantId, stepNumber, userId);
  }

  @Get('go-live/check')
  checkGoLive(@Req() req: AuthenticatedRequest) {
    const { tenantId } = this.requireTenantUser(req);
    return this.onboardingService.checkGoLive(tenantId);
  }

  @Post('go-live')
  goLive(@Req() req: AuthenticatedRequest) {
    const { tenantId, userId } = this.requireTenantUser(req);
    return this.onboardingService.goLive(tenantId, userId);
  }
}
