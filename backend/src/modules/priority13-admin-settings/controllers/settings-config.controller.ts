import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import {
  DataExportRequestDto,
  DecisionDto,
  DirectSettingSaveDto,
  FinancialYearCreateDto,
  GovernedSettingDraftDto,
  ProfileUpdateDto,
  RetentionConfigurationDto,
} from '../dto/settings-config.dto.js';
import { SettingsConfigService } from '../services/settings-config.service.js';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Controller('api/v1/settings')
@UseGuards(JwtAuthGuard)
export class SettingsConfigController {
  constructor(private readonly settings: SettingsConfigService) {}

  private tenant(req: AuthenticatedRequest) {
    if (!req.user.tenantId) throw new ForbiddenException('This action requires a tenant (FPO) user.');
    return { tenantId: req.user.tenantId, userId: req.user.sub };
  }

  @Get('profile')
  profile(@Req() req: AuthenticatedRequest) {
    return this.settings.getProfile(this.tenant(req).tenantId);
  }

  @Put('profile')
  updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: ProfileUpdateDto) {
    const ctx = this.tenant(req);
    return this.settings.updateProfile(ctx.tenantId, ctx.userId, dto);
  }

  @Get('branding')
  branding(@Req() req: AuthenticatedRequest) {
    return this.settings.getCurrentDirect(this.tenant(req).tenantId, 'SET-02');
  }

  @Put('branding')
  saveBranding(@Req() req: AuthenticatedRequest, @Body() dto: DirectSettingSaveDto) {
    const ctx = this.tenant(req);
    return this.settings.saveDirectFromDto(ctx.tenantId, ctx.userId, 'SET-02', 'DEFAULT', dto);
  }

  @Get('financial-years')
  financialYears(@Req() req: AuthenticatedRequest) {
    return this.settings.listFinancialYears(this.tenant(req).tenantId);
  }

  @Post('financial-years')
  createFinancialYear(@Req() req: AuthenticatedRequest, @Body() dto: FinancialYearCreateDto) {
    const ctx = this.tenant(req);
    return this.settings.createFinancialYear(ctx.tenantId, ctx.userId, dto);
  }

  @Get('governed/:screenId')
  listGoverned(@Req() req: AuthenticatedRequest, @Param('screenId') screenId: string) {
    return this.settings.listGoverned(this.tenant(req).tenantId, screenId.toUpperCase());
  }

  @Post('governed/:screenId')
  createGoverned(@Req() req: AuthenticatedRequest, @Param('screenId') screenId: string, @Body() dto: GovernedSettingDraftDto) {
    const ctx = this.tenant(req);
    return this.settings.createGovernedDraft(ctx.tenantId, ctx.userId, screenId.toUpperCase(), dto);
  }

  @Post('governed/submissions/:id/submit')
  async submit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const ctx = this.tenant(req);
    await this.settings.submitGoverned(ctx.tenantId, ctx.userId, id);
    return { submitted: true };
  }

  @Post('governed/submissions/:id/approve')
  async approve(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: DecisionDto) {
    const ctx = this.tenant(req);
    await this.settings.decideGoverned(ctx.tenantId, ctx.userId, id, 'APPROVE', dto.reason);
    return { approved: true };
  }

  @Post('governed/submissions/:id/reject')
  async reject(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: DecisionDto) {
    const ctx = this.tenant(req);
    await this.settings.decideGoverned(ctx.tenantId, ctx.userId, id, 'REJECT', dto.reason);
    return { rejected: true };
  }

  @Post('governed/submissions/:id/send-back')
  async sendBack(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: DecisionDto) {
    const ctx = this.tenant(req);
    await this.settings.decideGoverned(ctx.tenantId, ctx.userId, id, 'SEND_BACK', dto.reason);
    return { sentBack: true };
  }

  @Get('accounting')
  accounting(@Req() req: AuthenticatedRequest) {
    this.tenant(req);
    return this.settings.accountingSettingsBoundary();
  }

  @Get('authorised-signatures/:key')
  signature(@Req() req: AuthenticatedRequest, @Param('key') key: string) {
    return this.settings.getCurrentDirect(this.tenant(req).tenantId, 'SET-20', key);
  }

  @Put('authorised-signatures/:key')
  saveSignature(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() dto: DirectSettingSaveDto) {
    const ctx = this.tenant(req);
    return this.settings.saveDirectFromDto(ctx.tenantId, ctx.userId, 'SET-20', key, dto);
  }

  @Get('regulatory-verification')
  regulatory(@Req() req: AuthenticatedRequest) {
    return this.settings.regulatoryPoints(this.tenant(req).tenantId);
  }

  @Get('backup-export/requests')
  exportRequests(@Req() req: AuthenticatedRequest) {
    return this.settings.listDataExports(this.tenant(req).tenantId);
  }

  @Post('backup-export/requests')
  requestExport(@Req() req: AuthenticatedRequest, @Body() dto: DataExportRequestDto) {
    const ctx = this.tenant(req);
    return this.settings.requestDataExport(ctx.tenantId, ctx.userId, dto);
  }

  @Post('backup-export/requests/:id/cancel')
  async cancelExport(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const ctx = this.tenant(req);
    await this.settings.cancelDataExport(ctx.tenantId, ctx.userId, id);
    return { cancelled: true };
  }

  @Get('backup-export/public-qr-retention')
  retention(@Req() req: AuthenticatedRequest) {
    return this.settings.getRetention(this.tenant(req).tenantId);
  }

  @Put('backup-export/public-qr-retention')
  saveRetention(@Req() req: AuthenticatedRequest, @Body() dto: RetentionConfigurationDto) {
    const ctx = this.tenant(req);
    return this.settings.saveRetention(ctx.tenantId, ctx.userId, dto);
  }
}
