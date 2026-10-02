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
      setProgress(await getOnboardingProgress());
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleComplete(stepNumber: number) {
    setBusy(true); setError(null);
    try { await completeOnboardingStep(stepNumber); await refresh(); }
    catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function handleSkip(stepNumber: number) {
    setBusy(true); setError(null);
    try { await skipOnboardingStep(stepNumber); await refresh(); }
    catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function handleGoLiveCheck() {
    setBusy(true); setError(null);
    try {
      const result = await checkGoLive();
      setGoLiveBlocked(result.passed ? [] : result.failures);
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function handleGoLive() {
    setBusy(true); setError(null);
    try {
      const result = await goLive();
      if (result.passed) {
        setLive(true);
        setGoLiveBlocked([]);
      } else {
        setGoLiveBlocked(result.failures);
      }
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  }

  if (!progress) return <div className="card">{error ? <div className="error">{error}</div> : 'Loading onboarding progress…'}</div>;

  return (
    <div className="card">
      <h1>Onboarding Progress</h1>
      <p className="muted">SYS-04 · 16-step onboarding with server-side Go-Live validation.</p>
      {error && <div className="error">{error}</div>}
      <ul className="steps">
        {progress.map((s) => (
          <li key={s.stepNumber}>
            <span><strong>Step {s.stepNumber}</strong> — {s.name}<br/><small>{s.status}{s.skippable ? ' · Optional/Skippable' : ' · Mandatory'}</small></span>
            <span className="step-actions">
              <button disabled={busy || s.status === 'COMPLETE'} onClick={() => void handleComplete(s.stepNumber)}>Mark complete</button>
              {s.skippable && <button className="secondary" disabled={busy || s.status === 'SKIPPED'} onClick={() => void handleSkip(s.stepNumber)}>Skip</button>}
            </span>
          </li>
        ))}
      </ul>

      {live ? <p className="success">This FPO is now live.</p> : <>
        <button disabled={busy} onClick={() => void handleGoLiveCheck()}>Check Go-Live Readiness</button>
        {goLiveBlocked && goLiveBlocked.length === 0 && <button disabled={busy} onClick={() => void handleGoLive()}>Go Live</button>}
        {goLiveBlocked && goLiveBlocked.length > 0 && <ul className="error">{goLiveBlocked.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      </>}
    </div>
  );
}
