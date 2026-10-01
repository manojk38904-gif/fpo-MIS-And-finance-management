import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../services/auth.service.js';
import { PlatformAdminAuthService } from '../services/platform-admin-auth.service.js';
import {
  PlatformAdminLoginDto,
  PlatformAdminMfaDto,
  RefreshTokenDto,
  SetupPasswordDto,
  TenantLoginDto,
} from '../dto/auth.dto.js';

/**
 * SYS-01-A (tenant/staff/member login), SYS-01-B (Platform Super Admin,
 * split into its own two-step endpoints), refresh/logout, and SYS-05 (setup
 * password). All public/unauthenticated by nature — logging in is how a
 * token is obtained in the first place, never behind JwtAuthGuard.
 *
 * Correction-pass item 16 — request IP/User-Agent are extracted here (never
 * client-body-supplied) and passed down for login-history/security-event
 * telemetry.
 */
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly platformAdminAuthService: PlatformAdminAuthService,
  ) {}

  private requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
    return { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }

  // -------------------------------------------------------------- SYS-01-A
  @Post('login')
  @HttpCode(HttpStatus.OK)
  tenantLogin(@Body() dto: TenantLoginDto, @Req() req: Request) {
    return this.authService.tenantLogin(dto.fpoCode, dto.usernameOrEmailOrMobile, dto.password, this.requestMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshTenantToken(dto.refreshToken, this.requestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logoutTenant(dto.refreshToken);
    return { loggedOut: true };
  }

  // -------------------------------------------------------------- SYS-05
  @Post('setup-password')
  @HttpCode(HttpStatus.OK)
  async setupPassword(@Body() dto: SetupPasswordDto) {
    await this.authService.setupPassword(dto.setupToken, dto.newPassword, dto.confirmNewPassword);
    return { passwordSet: true };
  }

  // -------------------------------------------------------------- SYS-01-B
  @Post('platform-admin/login')
  @HttpCode(HttpStatus.OK)
  platformAdminLoginStep1(@Body() dto: PlatformAdminLoginDto, @Req() req: Request) {
    return this.platformAdminAuthService.loginStep1Password(dto.usernameOrEmail, dto.password, this.requestMeta(req));
  }

  @Post('platform-admin/login/mfa')
  @HttpCode(HttpStatus.OK)
  platformAdminLoginStep2(@Body() dto: PlatformAdminMfaDto, @Req() req: Request) {
    return this.platformAdminAuthService.loginStep2Mfa(dto.mfaSessionToken, dto.totpCode, this.requestMeta(req));
  }

  @Post('platform-admin/refresh')
  @HttpCode(HttpStatus.OK)
  platformAdminRefresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.platformAdminAuthService.refresh(dto.refreshToken, this.requestMeta(req));
  }

  @Post('platform-admin/logout')
  @HttpCode(HttpStatus.OK)
  async platformAdminLogout(@Body() dto: RefreshTokenDto) {
    await this.platformAdminAuthService.logout(dto.refreshToken);
    return { loggedOut: true };
  }
}
