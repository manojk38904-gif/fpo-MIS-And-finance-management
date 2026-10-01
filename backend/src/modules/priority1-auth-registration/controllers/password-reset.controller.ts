import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { PasswordResetService } from '../services/password-reset.service.js';
import { ForgotPasswordDto, ResetPasswordDto } from '../dto/auth.dto.js';

/** SYS-06 — Forgot/Reset Password. Public/unauthenticated by nature. */
@Controller('api/v1/auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  request(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.requestReset(dto.fpoCode, dto.usernameOrEmailOrMobile);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.resetPassword(dto.resetRequestId, dto.otp, dto.newPassword, dto.confirmNewPassword);
    return { passwordReset: true };
  }
}
