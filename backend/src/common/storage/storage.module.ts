import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE_PORT, MALWARE_SCAN_PORT } from './file-storage.port.js';
import { LocalFileStorageAdapter } from './local-file-storage.adapter.js';
import { StubMalwareScanAdapter } from './stub-malware-scan.adapter.js';

@Global()
@Module({
  providers: [
    { provide: FILE_STORAGE_PORT, useClass: LocalFileStorageAdapter },
    { provide: MALWARE_SCAN_PORT, useClass: StubMalwareScanAdapter },
  ],
  exports: [FILE_STORAGE_PORT, MALWARE_SCAN_PORT],
})
export class StorageModule {}
