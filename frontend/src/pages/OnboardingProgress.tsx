import { useEffect, useState } from 'react';
import {
  getOnboardingProgress,
  completeOnboardingStep,
  skipOnboardingStep,
  checkGoLive,
  goLive,
  type OnboardingProgress as Progress,
} from '../api/onboarding';
import { extractErrorMessage } from '../api/client';

export default function OnboardingProgress() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goLiveBlocked, setGoLiveBlocked] = useState<string[] | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const p = await getOnboardingProgress();
      setProgress(p);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleComplete(stepNumber: number) {
    setBusy(true);
    setError(null);
    try {
      await completeOnboardingStep(stepNumber);
      await refresh();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip(stepNumber: number) {
    setBusy(true);
    setError(null);
    try {
      await skipOnboardingStep(stepNumber);
      await refresh();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoLiveCheck() {
    setBusy(true);
    setError(null);
    try {
      const result = await checkGoLive();
      setGoLiveBlocked(result.canGoLive ? [] : result.blockingReasons ?? ['Not ready yet.']);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoLive() {
    setBusy(true);
    setError(null);
    try {
      await goLive();
      setLive(true);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!progress) return <div className="card">{error ? <div className="error">{error}</div> : 'Loading onboarding progress…'}</div>;

  return (
    <div className="card">
      <h1>Onboarding Progress</h1>
      {error && <div className="error">{error}</div>}
      <ul className="steps">
        {progress.steps.map((s) => (
          <li key={s.stepNumber}>
            <span>Step {s.stepNumber} — {s.status}</span>
            <span className="step-actions">
              <button disabled={busy} onClick={() => handleComplete(s.stepNumber)}>Mark complete</button>
              <button disabled={busy} onClick={() => handleSkip(s.stepNumber)}>Skip</button>
            </span>
          </li>
        ))}
      </ul>

      {live ? (
        <p>✅ This FPO is now live.</p>
      ) : (
        <>
          <button disabled={busy} onClick={handleGoLiveCheck}>Check Go-Live Readiness</button>
          {goLiveBlocked && goLiveBlocked.length === 0 && (
            <button disabled={busy} onClick={handleGoLive}>Go Live</button>
          )}
          {goLiveBlocked && goLiveBlocked.length > 0 && (
            <ul className="error">
              {goLiveBlocked.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
