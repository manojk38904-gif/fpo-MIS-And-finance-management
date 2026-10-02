import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../common/auth/jwt-auth.guard.js';
import type { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { FILE_STORAGE_PORT, MALWARE_SCAN_PORT, type FileStoragePort, type MalwareScanPort } from '../../../common/storage/file-storage.port.js';

interface AuthenticatedRequest extends Request { user: JwtPayload; }

const PURPOSE_MIMES: Record<string, ReadonlySet<string>> = {
  BRANDING_LOGO: new Set(['image/png', 'image/jpeg', 'image/svg+xml']),
  LETTERHEAD_BACKGROUND: new Set(['image/png', 'image/jpeg']),
  AUTHORISED_SIGNATURE: new Set(['image/png', 'image/jpeg']),
};

@Controller('api/v1/settings/assets')
@UseGuards(JwtAuthGuard)
export class SettingsAssetController {
  constructor(
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
    @Inject(MALWARE_SCAN_PORT) private readonly scanner: MalwareScanPort,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  @Post(':purpose')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Req() req: AuthenticatedRequest,
    @Param('purpose') purposeRaw: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!req.user.tenantId) throw new ForbiddenException('Tenant user access is required.');
    const purpose = purposeRaw.toUpperCase();
    const allowed = PURPOSE_MIMES[purpose];
    if (!allowed) throw new BadRequestException('Unsupported settings asset purpose.');
    if (!file) throw new BadRequestException('A file is required.');
    if (!allowed.has(file.mimetype)) throw new BadRequestException('Unsupported file type for this settings asset.');

    const maxBytes = this.config.get<number>('upload.maxSizeBytes') ?? 10 * 1024 * 1024;
    if (file.size > maxBytes) throw new BadRequestException('File exceeds the configured upload size limit.');

    const scan = await this.scanner.scan(file.buffer);
    if (!scan.clean) throw new BadRequestException(scan.reason || 'File failed malware scanning.');

    const stored = await this.storage.store({
      buffer: file.buffer,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
    });
    await this.audit.record({
      eventType: 'settings.asset.uploaded',
      tenantId: req.user.tenantId,
      actorUserId: req.user.sub,
      metadata: { purpose, mimeType: file.mimetype, size: file.size },
    });
    return { purpose, fileReference: stored.fileKey };
  }
}
