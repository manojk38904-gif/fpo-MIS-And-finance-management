import { api } from './client';

export interface OnboardingStep {
  stepNumber: number;
  name: string;
  skippable: boolean;
  status: 'PENDING' | 'CURRENT' | 'COMPLETE' | 'SKIPPED' | string;
}

export type OnboardingProgress = OnboardingStep[];

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const { data } = await api.get<OnboardingProgress>('/onboarding/progress');
  return data;
}

export async function completeOnboardingStep(stepNumber: number): Promise<void> {
  await api.post(`/onboarding/steps/${stepNumber}/complete`, {});
}

export async function skipOnboardingStep(stepNumber: number): Promise<void> {
  await api.post(`/onboarding/steps/${stepNumber}/skip`, {});
}

export interface GoLiveCheck {
  passed: boolean;
  failures: string[];
}

export async function checkGoLive(): Promise<GoLiveCheck> {
  const { data } = await api.get<GoLiveCheck>('/onboarding/go-live/check');
  return data;
}

export async function goLive(): Promise<GoLiveCheck> {
  const { data } = await api.post<GoLiveCheck>('/onboarding/go-live', {});
  return data;
}
