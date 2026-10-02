import axios from 'axios';

/**
 * Single axios instance for the whole app. Base URL comes from env so the
 * same build can point at local/dev/prod backends without code changes.
 */
export const apiBaseUrl: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

export const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Tenant access token is kept in memory only (not localStorage) to avoid
 * XSS-exfiltrable persistent tokens on a shared/public device. This means a
 * hard page refresh requires re-login — acceptable for Priority #1 and
 * matches the backend's short-lived access-token + refresh-token design.
 */
let tenantAccessToken: string | null = null;
let platformAccessToken: string | null = null;

export function setTenantAccessToken(token: string | null): void {
  tenantAccessToken = token;
}

export function setPlatformAccessToken(token: string | null): void {
  platformAccessToken = token;
}

api.interceptors.request.use((config) => {
  const isPlatformAdmin = config.url?.includes('/platform-admin') || config.url?.includes('/super-admin');
  const token = isPlatformAdmin ? platformAccessToken : tenantAccessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface ApiErrorShape {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorShape | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join(', ') : data.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
