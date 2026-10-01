/**
 * Correction-pass item 12 — document-upload boundary. SYS-02 Step-4 uploads
 * (Registration Certificate, Incorporation Certificate, PAN, conditional
 * GST, Logo) must be stored behind a private-storage abstraction — never a
 * public raw path — with an S3-compatible production adapter and a safe
 * local/in-memory adapter for tests. The malware-scan hook is a separate,
 * explicit step (MalwareScanPort) run before a file is considered stored.
 */
export interface StoredFile {
  fileKey: string;
}

export const FILE_STORAGE_PORT = Symbol('FILE_STORAGE_PORT');

export interface FileStoragePort {
  store(params: { buffer: Buffer; originalFileName: string; mimeType: string }): Promise<StoredFile>;
}

export const MALWARE_SCAN_PORT = Symbol('MALWARE_SCAN_PORT');

export interface MalwareScanPort {
  /** Resolves `{ clean: true }` or `{ clean: false, reason }` — never throws for an infected file (the caller decides the HTTP response). */
  scan(buffer: Buffer): Promise<{ clean: boolean; reason?: string }>;
}
