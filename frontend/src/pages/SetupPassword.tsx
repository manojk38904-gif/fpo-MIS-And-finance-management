import { useState } from 'react';
import { setupPassword } from '../api/auth';
import { extractErrorMessage } from '../api/client';

/**
 * SYS-04 Step-1 equivalent — the link emailed to a newly-approved FPO
 * carries a one-time setupToken (?token=...) that this page consumes to let
 * the first user choose their own password (the backend never assigns or
 * stores a default password — see TestFpoCodeGeneratorAdapter / production
 * NotImplementedFpoCodeGeneratorAdapter notes in backend/README.md).
 */
export default function SetupPassword() {
  const params = new URLSearchParams(window.location.search);
  const setupToken = params.get('token') ?? params.get('fpoSetupToken') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!setupToken) {
      setError('Setup link is missing its token. Please use the link from your email.');
      return;
    }
    setBusy(true);
    try {
      await setupPassword(setupToken, newPassword, confirmNewPassword);
      setDone(true);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <div className="card"><p>✅ Password set. You can now log in with your FPO Code.</p></div>;
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h1>Set Your Password</h1>
      {error && <div className="error">{error}</div>}
      <label>New Password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
      <label>Confirm New Password<input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required /></label>
      <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Set Password'}</button>
    </form>
  );
}
