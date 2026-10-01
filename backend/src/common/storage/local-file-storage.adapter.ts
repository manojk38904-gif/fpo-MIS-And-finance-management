import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { FileStoragePort, StoredFile } from './file-storage.port.js';

/**
 * Safe local-directory adapter — used in tests and as a Phase-1 default
 * (same "Implementation Detail Allowed Within Frozen Rule" category as the
 * original document-metadata design: object-storage PROVIDER choice is an
 * infra/cost decision the frozen text does not fix). `fileKey` is an opaque
 * reference, never a web-servable path — swapping to an S3-compatible
 * adapter later changes only this class, never any caller or API contract.
 * Filenames are never derived from client input (prevents path traversal);
 * only a fresh random id + the validated extension is used.
 */
@Injectable()
export class LocalFileStorageAdapter implements FileStoragePort {
  private readonly uploadsDir: string;

  constructor(config: ConfigService) {
    // `??` alone is not enough here: configuration.ts's own default for
    // `uploadsDir` is `''` (an empty, but defined, string) when UPLOADS_DIR
    // is unset — `'' ?? fallback` evaluates to `''`, not the fallback,
    // because `??` only substitutes on null/undefined. An empty string is
    // never a usable directory (`mkdir('')` fails), so it is treated the
    // same as "not configured" here.
    const configured = config.get<string>('uploadsDir');
    this.uploadsDir = configured && configured.trim() !== '' ? configured : join(process.cwd(), 'uploads');
  }

  async store(params: { buffer: Buffer; originalFileName: string; mimeType: string }): Promise<StoredFile> {
    await mkdir(this.uploadsDir, { recursive: true });
    const safeExt = extname(params.originalFileName).replace(/[^.\w]/g, '').slice(0, 10);
    const fileKey = `${randomUUID()}${safeExt}`;
    await writeFile(join(this.uploadsDir, fileKey), params.buffer);
    return { fileKey };
  }
}
