import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RegistrationService } from '../services/registration.service.js';
import {
  ReissueResumeTokenDto,
  RegistrationDraftDto,
  SendRegistrationOtpDto,
  VerifyRegistrationOtpDto,
} from '../dto/registration.dto.js';
import { FpoRegistrationDocumentType } from '../entities/fpo-registration-document.entity.js';

/**
 * SYS-02 (+ SYS-03 integration points). Entirely public/unauthenticated —
 * no tenant exists yet. Correction-pass item 6 — every endpoint below that
 * reads or mutates an EXISTING registration takes the opaque `resumeToken`
 * in the URL, never a bare registrationId: knowledge of the UUID alone is
 * no longer sufficient authority (PAN/bank details live on this record).
 * Only the very first `POST /draft` (nothing to protect yet) and the
 * email-gated `POST /resend-resume-link` (re-issuance) differ.
 */
@Controller('api/v1/registration')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Post('draft')
  async createDraft(@Body() dto: RegistrationDraftDto) {
    const { registration, resumeToken } = await this.registrationService.createDraft(dto);
    return { ...registration, resumeToken };
  }

  @Post('resend-resume-link')
  @HttpCode(HttpStatus.OK)
  async resendResumeLink(@Body() dto: ReissueResumeTokenDto) {
    await this.registrationService.reissueResumeToken(dto.registrationId, dto.officialEmail);
    return { sent: true };
  }

  @Get('resume/:resumeToken')
  get(@Param('resumeToken') resumeToken: string) {
    return this.registrationService.getByResumeToken(resumeToken);
  }

  @Post('resume/:resumeToken/draft')
  updateDraft(@Param('resumeToken') resumeToken: string, @Body() dto: RegistrationDraftDto) {
    return this.registrationService.updateDraftByResumeToken(resumeToken, dto);
  }

  @Post('resume/:resumeToken/send-otp')
  @HttpCode(HttpStatus.OK)
  sendOtp(@Param('resumeToken') resumeToken: string, @Body() dto: SendRegistrationOtpDto) {
    return this.registrationService.sendEmailOtpByResumeToken(resumeToken, dto.officialEmail);
  }

  @Post('resume/:resumeToken/verify-otp/:otpVerificationId')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Param('resumeToken') resumeToken: string,
    @Param('otpVerificationId') otpVerificationId: string,
    @Body() dto: VerifyRegistrationOtpDto,
  ) {
    await this.registrationService.verifyEmailOtpByResumeToken(resumeToken, otpVerificationId, dto.otp);
    return { verified: true };
  }

  // -------------------------------------------------------------- item 12
  @Post('resume/:resumeToken/documents/:documentType')
  // 25MB hard multipart ceiling at the parsing layer — a generous safety net
  // only; the configurable, authoritative size/type limits are enforced
  // inside RegistrationService.attachDocumentByResumeToken (item 12).
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadDocument(
    @Param('resumeToken') resumeToken: string,
    @Param('documentType') documentType: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');
    if (!Object.values(FpoRegistrationDocumentType).includes(documentType as FpoRegistrationDocumentType)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.registrationService.attachDocumentByResumeToken(resumeToken, documentType as FpoRegistrationDocumentType, {
      buffer: file.buffer,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
  }

  @Post('resume/:resumeToken/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('resumeToken') resumeToken: string) {
    return this.registrationService.submitByResumeToken(resumeToken);
  }
}
