import { api } from './client';

export interface ApplicationSummary {
  id: string;
  fpoName: string | null;
  state: string | null;
  district: string | null;
  submittedAt: string | null;
  status: string;
  fpoCode: string | null;
}

export async function listApplications() {
  const { data } = await api.get<{ items: ApplicationSummary[]; total: number }>('/super-admin/applications');
  return data;
}

export async function approveApplication(id: string, reason: string) {
  const { data } = await api.post('/super-admin/applications/' + id + '/approve', { reason });
  return data as { approved: boolean; activated: boolean; activationPending?: boolean; message?: string };
}

export async function rejectApplication(id: string, reason: string) {
  const { data } = await api.post('/super-admin/applications/' + id + '/reject', { reason });
  return data;
}

export async function listTenants() {
  const { data } = await api.get('/super-admin/tenants');
  return data as Array<Record<string, unknown>>;
}

export async function listPlatformAdmins() {
  const { data } = await api.get('/super-admin/platform-administrators');
  return data as Array<Record<string, unknown>>;
}

export async function createPlatformAdmin(input: {
  username: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPPORT_ADMIN';
  password: string;
  totpSecret: string;
  reason: string;
}) {
  const { data } = await api.post('/super-admin/platform-administrators', input);
  return data;
}

export async function listPlans() {
  const { data } = await api.get('/super-admin/subscription-plans');
  return data as Array<Record<string, unknown>>;
}

export async function createPlan(input: {
  planCode: string;
  planName: string;
  limits: Record<string, number | boolean | string>;
  features: Record<string, boolean | string | number>;
  effectiveDate: string;
  reason: string;
}) {
  const { data } = await api.post('/super-admin/subscription-plans', input);
  return data;
}

export async function configureGrace(gracePeriodDays: number, reason: string) {
  const { data } = await api.post('/super-admin/subscriptions/grace-policy', { gracePeriodDays, reason });
  return data;
}

export async function listSubscriptions() {
  const { data } = await api.get('/super-admin/subscriptions');
  return data as Array<Record<string, unknown>>;
}

export async function assignSubscription(input: {
  tenantId: string;
  planVersionId: string;
  startDate: string;
  expiryDate: string;
  reason: string;
}) {
  const { data } = await api.post('/super-admin/subscriptions', input);
  return data;
}

export async function changeSubscriptionState(
  tenantId: string,
  state: 'ACTIVE' | 'NEARING_EXPIRY' | 'GRACE' | 'EXPIRED_READ_ONLY' | 'SUSPENDED' | 'REACTIVATED',
  reason: string,
) {
  const { data } = await api.post('/super-admin/subscriptions/' + tenantId + '/state', { state, reason });
  return data;
}

export async function getPlatformUsage() {
  const { data } = await api.get('/super-admin/usage');
  return data as Record<string, unknown>;
}

export async function getPlatformHealth() {
  const { data } = await api.get('/super-admin/health');
  return data as Record<string, unknown>;
}

export async function createSupportAccess(input: {
  tenantId: string;
  reason: string;
  ticketContext: string;
  requestedDurationMinutes: number;
  idempotencyKey?: string;
}) {
  const { data } = await api.post('/super-admin/support-access', input);
  return data;
}

export async function listSupportAccess() {
  const { data } = await api.get('/super-admin/support-access');
  return data as Array<Record<string, unknown>>;
}

export async function revokeSupportAccess(id: string) {
  const { data } = await api.post('/super-admin/support-access/' + id + '/revoke');
  return data;
}

export async function getAuditBoundary() {
  const { data } = await api.get('/super-admin/audit');
  return data as Record<string, unknown>;
}

export async function getCbboState() {
  const { data } = await api.get('/super-admin/cbbo-agency-hierarchy');
  return data as Record<string, unknown>;
}

export async function getSecurityEventsBoundary() {
  const { data } = await api.get('/super-admin/security-events');
  return data as Record<string, unknown>;
}
