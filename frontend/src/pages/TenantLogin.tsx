import { useState } from 'react';
import { tenantLogin } from '../api/auth';
import { setTenantAccessToken, extractErrorMessage } from '../api/client';

export default function TenantLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [fpoCode, setFpoCode] = useState('');
  const [usernameOrEmailOrMobile, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await tenantLogin({ fpoCode, usernameOrEmailOrMobile, password });
      setTenantAccessToken(tokens.accessToken);
      sessionStorage.setItem('tenantRefreshToken', tokens.refreshToken);
      onLoggedIn();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h1>FPO Login</h1>
      {error && <div className="error">{error}</div>}
      <label>FPO Code<input value={fpoCode} onChange={(e) => setFpoCode(e.target.value)} required /></label>
      <label>
        Username / Email / Mobile
        <input value={usernameOrEmailOrMobile} onChange={(e) => setUser(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button disabled={busy} type="submit">{busy ? 'Logging in…' : 'Login'}</button>
    </form>
  );
}
