import { api } from './client';

export interface TenantLoginInput {
  fpoCode: string;
  usernameOrEmailOrMobile: string;
  password: string;
  rememberMe?: boolean;
}

export interface TenantTokens {
  accessToken: string;
  refreshToken: string;
  [key: string]: unknown;
}

export async function tenantLogin(input: TenantLoginInput): Promise<TenantTokens> {
  const { data } = await api.post<TenantTokens>('/auth/login', input);
  return data;
}

export async function setupPassword(
  setupToken: string,
  newPassword: string,
  confirmNewPassword: string,
): Promise<void> {
  await api.post('/auth/setup-password', { setupToken, newPassword, confirmNewPassword });
}

export async function tenantLogout(refreshToken: string): Promise<void> {
  await api.post('/auth/logout', { refreshToken });
}

export interface PlatformAdminMfaChallenge {
  mfaSessionToken: string;
  [key: string]: unknown;
}

export async function platformAdminLogin(
  usernameOrEmail: string,
  password: string,
): Promise<PlatformAdminMfaChallenge> {
  const { data } = await api.post<PlatformAdminMfaChallenge>('/auth/platform-admin/login', {
    usernameOrEmail,
    password,
  });
  return data;
}

export async function platformAdminVerifyMfa(
  mfaSessionToken: string,
  totpCode: string,
): Promise<TenantTokens> {
  const { data } = await api.post<TenantTokens>('/auth/platform-admin/login/mfa', {
    mfaSessionToken,
    totpCode,
  });
  return data;
}

export interface PasswordResetRequestResult {
  resetRequestId: string;
  [key: string]: unknown;
}

export async function requestPasswordReset(
  fpoCode: string,
  usernameOrEmailOrMobile: string,
): Promise<PasswordResetRequestResult> {
  const { data } = await api.post<PasswordResetRequestResult>('/auth/password-reset/request', {
    fpoCode,
    usernameOrEmailOrMobile,
  });
  return data;
}

export async function confirmPasswordReset(
  resetRequestId: string,
  otp: string,
  newPassword: string,
  confirmNewPassword: string,
): Promise<void> {
  await api.post('/auth/password-reset/confirm', { resetRequestId, otp, newPassword, confirmNewPassword });
}
