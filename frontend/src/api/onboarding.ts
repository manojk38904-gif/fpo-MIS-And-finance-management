import { api } from './client';

export interface OnboardingProgress {
  steps: Array<{ stepNumber: number; status: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const { data } = await api.get<OnboardingProgress>('/onboarding/progress');
  return data;
}

export async function completeOnboardingStep(stepNumber: number): Promise<OnboardingProgress> {
  const { data } = await api.post<OnboardingProgress>(`/onboarding/steps/${stepNumber}/complete`, {});
  return data;
}

export async function skipOnboardingStep(stepNumber: number): Promise<OnboardingProgress> {
  const { data } = await api.post<OnboardingProgress>(`/onboarding/steps/${stepNumber}/skip`, {});
  return data;
}

export interface GoLiveCheck {
  canGoLive: boolean;
  blockingReasons?: string[];
  [key: string]: unknown;
}

export async function checkGoLive(): Promise<GoLiveCheck> {
  const { data } = await api.get<GoLiveCheck>('/onboarding/go-live/check');
  return data;
}

export async function goLive(): Promise<{ wentLive: boolean; [key: string]: unknown }> {
  const { data } = await api.post('/onboarding/go-live', {});
  return data;
}
