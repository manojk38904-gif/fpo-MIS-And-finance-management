import { useState } from 'react';
import { platformAdminLogin, platformAdminVerifyMfa } from '../api/auth';
import { setPlatformAccessToken, extractErrorMessage } from '../api/client';

/** SYS-01-B — platform admin login is always two-step: password, then mandatory TOTP. */
export default function PlatformAdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { mfaSessionToken: token } = await platformAdminLogin(usernameOrEmail, password);
      setMfaSessionToken(token);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaSessionToken) return;
    setError(null);
    setBusy(true);
    try {
      const tokens = await platformAdminVerifyMfa(mfaSessionToken, totpCode);
      setPlatformAccessToken(tokens.accessToken);
      sessionStorage.setItem('platformRefreshToken', tokens.refreshToken);
      onLoggedIn();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (mfaSessionToken) {
    return (
      <form className="card" onSubmit={handleMfaSubmit}>
        <h1>Platform Admin — Enter TOTP Code</h1>
        {error && <div className="error">{error}</div>}
        <label>6-digit authenticator code<input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} required /></label>
        <button disabled={busy} type="submit">{busy ? 'Verifying…' : 'Verify'}</button>
      </form>
    );
  }

  return (
    <form className="card" onSubmit={handlePasswordSubmit}>
      <h1>Platform Super Admin Login</h1>
      {error && <div className="error">{error}</div>}
      <label>Username / Email<input value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button disabled={busy} type="submit">{busy ? 'Please wait…' : 'Continue'}</button>
    </form>
  );
}
