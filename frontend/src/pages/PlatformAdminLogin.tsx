import { useState } from 'react';
import { platformAdminLogin, platformAdminVerifyMfa } from '../api/auth';
import { api, setPlatformAccessToken, extractErrorMessage } from '../api/client';

/** SYS-01-B — platform admin login is always two-step: password, then mandatory TOTP. */
export default function PlatformAdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const setupToken = new URLSearchParams(window.location.search).get('setupToken');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [totpUri, setTotpUri] = useState<string | null>(null);

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

  async function submitSetupPassword(e: React.FormEvent) { e.preventDefault(); setError(null); setBusy(true); try { const { data } = await api.post('/auth/platform-admin/bootstrap/password', { token: setupToken, password: setupPassword, confirmPassword: setupPasswordConfirm }); setTotpUri(data.totpUri); } catch (e) { setError(extractErrorMessage(e)); } finally { setBusy(false); } }
  async function submitSetupMfa(e: React.FormEvent) { e.preventDefault(); setError(null); setBusy(true); try { await api.post('/auth/platform-admin/bootstrap/mfa', { token: setupToken, code: totpCode }); window.history.replaceState({}, '', '/platform-admin/login'); setTotpUri(null); setError('Setup complete. Sign in with your new password.'); } catch (e) { setError(extractErrorMessage(e)); } finally { setBusy(false); } }
  if (setupToken) return totpUri ? <form className="card" onSubmit={submitSetupMfa}><h1>Set up authenticator</h1>{error && <div className="error">{error}</div>}<p>Add this setup key to Google Authenticator, then enter its 6-digit code:</p><label>Authenticator setup key<input value={totpUri} readOnly /></label><label>6-digit code<input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} required /></label><button disabled={busy}>{busy ? 'Please wait…' : 'Finish setup'}</button></form> : <form className="card" onSubmit={submitSetupPassword}><h1>Create Platform Admin password</h1>{error && <div className="error">{error}</div>}<label>New password<input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} required /></label><label>Confirm new password<input type="password" value={setupPasswordConfirm} onChange={(e) => setSetupPasswordConfirm(e.target.value)} required /></label><button disabled={busy}>{busy ? 'Please wait…' : 'Continue to MFA setup'}</button></form>;

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
      <button type="button" className="secondary" onClick={() => setShowRecoveryHelp((visible) => !visible)}>
        Forgot Admin ID / Password?
      </button>
      {showRecoveryHelp && (
        <div className="info" role="status">
          <strong>Platform Admin access recovery</strong>
          <p>
            For security, the Platform Admin ID is never displayed publicly. Password recovery needs approval from an independent existing Platform Admin.
          </p>
          <p>
            If this is the first Platform Admin account, the system owner must create the first account through the secure one-time setup process. Do not use the FPO user password reset for this screen.
          </p>
        </div>
      )}
    </form>
  );
}
