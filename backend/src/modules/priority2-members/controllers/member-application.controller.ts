import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { CreateMemberApplicationDto, DecideMemberApplicationDto, IssueShareCertificateDto } from '../dto/member-application.dto.js';
import { MemberApplicationStatus } from '../entities/member-application.entity.js';
import { MemberApplicationService } from '../services/member-application.service.js';

@Controller('api/v1/member-applications')
export class MemberApplicationController {
  constructor(private readonly service: MemberApplicationService) {}
  @Post() apply(@Body() dto: CreateMemberApplicationDto) { return this.service.apply(dto); }
  private tenant(req: Request & { user: JwtPayload }) { if (!req.user.tenantId) throw new ForbiddenException('FPO access is required.'); return { tenantId: req.user.tenantId, userId: req.user.sub }; }
  @Get() @UseGuards(JwtAuthGuard) list(@Req() req: Request & { user: JwtPayload }) { return this.service.list(this.tenant(req).tenantId); }
  @Post(':id/decision') @UseGuards(JwtAuthGuard) decide(@Req() req: Request & { user: JwtPayload }, @Param('id') id: string, @Body() dto: DecideMemberApplicationDto) { const a = this.tenant(req); return this.service.decide(a.tenantId, a.userId, id, dto.status as MemberApplicationStatus.APPROVED | MemberApplicationStatus.REJECTED, dto.note); }
  @Get(':id/identity-card') @UseGuards(JwtAuthGuard) card(@Req() req: Request & { user: JwtPayload }, @Param('id') id: string) { return this.service.card(this.tenant(req).tenantId, id); }
  @Post(':id/issue-share-certificate') @UseGuards(JwtAuthGuard) issueCertificate(@Req() req: Request & { user: JwtPayload }, @Param('id') id: string, @Body() dto: IssueShareCertificateDto) { const a=this.tenant(req); return this.service.issueShareCertificate(a.tenantId,a.userId,id,dto.boardResolutionRef); }
  @Get(':id/share-certificate') @UseGuards(JwtAuthGuard) certificate(@Req() req: Request & { user: JwtPayload }, @Param('id') id: string) { return this.service.shareCertificate(this.tenant(req).tenantId,id); }
}
