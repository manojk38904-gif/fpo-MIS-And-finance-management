import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { StaffSetupService } from '../services/staff-setup.service.js';

class CompleteStaffSetupDto {
  @IsString() setupToken!: string;
  @IsString() newPassword!: string;
  @IsString() confirmNewPassword!: string;
}

@Controller('api/v1/auth/staff')
export class StaffSetupController {
  constructor(private readonly staffSetup: StaffSetupService) {}

  @Post('setup-password')
  async setup(@Body() dto: CompleteStaffSetupDto) {
    await this.staffSetup.setupPassword(dto.setupToken, dto.newPassword, dto.confirmNewPassword);
    return { completed: true };
  }
}
