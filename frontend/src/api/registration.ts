import { api } from './client';

/** Mirrors backend RegistrationDraftDto exactly — every field optional for PATCH-style draft saves. */
export interface RegistrationDraft {
  fpoName?: string;
  cin?: string;
  registrationNumber?: string;
  incorporationDate?: string;
  pan?: string;
  gstin?: string;
  chairmanName?: string;
  ceoName?: string;
  authorisedPersonName?: string;
  registeredAddress?: string;
  state?: string;
  district?: string;
  pincode?: string;
  officialMobile?: string;
  officialEmail?: string;
  website?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  termsAccepted?: boolean;
}

export interface DraftResponse {
  registrationId: string;
  resumeToken: string;
  status: string;
  [key: string]: unknown;
}

export async function createDraft(draft: RegistrationDraft): Promise<DraftResponse> {
  const { data } = await api.post<DraftResponse>('/registration/draft', draft);
  return data;
}

export async function getDraftByResumeToken(resumeToken: string): Promise<DraftResponse> {
  const { data } = await api.get<DraftResponse>(`/registration/resume/${resumeToken}`);
  return data;
}

export async function updateDraftByResumeToken(
  resumeToken: string,
  draft: RegistrationDraft,
): Promise<DraftResponse> {
  const { data } = await api.post<DraftResponse>(`/registration/resume/${resumeToken}/draft`, draft);
  return data;
}

export async function resendResumeLink(registrationId: string, officialEmail: string): Promise<void> {
  await api.post('/registration/resend-resume-link', { registrationId, officialEmail });
}

export async function sendEmailOtp(resumeToken: string, officialEmail: string): Promise<{ otpVerificationId: string }> {
  const { data } = await api.post<{ otpVerificationId: string }>(
    `/registration/resume/${resumeToken}/send-otp`,
    { officialEmail },
  );
  return data;
}

export async function verifyEmailOtp(
  resumeToken: string,
  otpVerificationId: string,
  otp: string,
): Promise<void> {
  await api.post(`/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`, { otp });
}

/** Must match backend FpoRegistrationDocumentType exactly (case-sensitive). */
export type DocumentType =
  | 'REGISTRATION_CERTIFICATE'
  | 'INCORPORATION_CERTIFICATE'
  | 'PAN_UPLOAD'
  | 'GST_DOCUMENT'
  | 'LOGO_UPLOAD';

export async function uploadDocument(
  resumeToken: string,
  documentType: DocumentType,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await api.post(`/registration/resume/${resumeToken}/documents/${documentType}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function submitRegistration(resumeToken: string): Promise<DraftResponse> {
  const { data } = await api.post<DraftResponse>(`/registration/resume/${resumeToken}/submit`, {});
  return data;
}
