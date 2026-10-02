import { useEffect, useState } from 'react';
import {
  approveApplication,
  assignSubscription,
  changeSubscriptionState,
  configureGrace,
  createPlan,
  createPlatformAdmin,
  createSupportAccess,
  getAuditBoundary,
  getCbboState,
  getPlatformHealth,
  getPlatformUsage,
  getSecurityEventsBoundary,
  listApplications,
  listPlatformAdmins,
  listPlans,
  listSubscriptions,
  listSupportAccess,
  listTenants,
  rejectApplication,
  revokeSupportAccess,
  type ApplicationSummary,
} from '../api/platform';
import { extractErrorMessage } from '../api/client';

type Tab =
  | 'applications'
  | 'tenants'
  | 'admins'
  | 'plans'
  | 'subscriptions'
  | 'usage'
  | 'health'
  | 'support'
  | 'audit'
  | 'cbbo'
  | 'security';

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export default function PlatformAdminDashboard() {
  const [tab, setTab] = useState<Tab>('applications');
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(selected: Tab = tab) {
    setBusy(true);
    setError(null);
    try {
      if (selected === 'applications') setData(await listApplications());
      else if (selected === 'tenants') setData(await listTenants());
      else if (selected === 'admins') setData(await listPlatformAdmins());
      else if (selected === 'plans') setData(await listPlans());
      else if (selected === 'subscriptions') setData(await listSubscriptions());
      else if (selected === 'usage') setData(await getPlatformUsage());
      else if (selected === 'health') setData(await getPlatformHealth());
      else if (selected === 'support') setData(await listSupportAccess());
      else if (selected === 'audit') setData(await getAuditBoundary());
      else if (selected === 'cbbo') setData(await getCbboState());
      else if (selected === 'security') setData(await getSecurityEventsBoundary());
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load(tab);
  }, [tab]);

  async function withReason(action: (reason: string) => Promise<unknown>, promptText: string) {
    const reason = window.prompt(promptText);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await action(reason.trim());
      if (
        typeof result === 'object' &&
        result &&
        'activationPending' in result &&
        Boolean((result as { activationPending?: boolean }).activationPending)
      ) {
        setError((result as { message?: string }).message ?? 'Approval saved; activation is pending.');
      }
      await load();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[Tab, string]> = [
    ['applications', 'FPO Applications'],
    ['tenants', 'Tenants'],
    ['admins', 'Platform Admins'],
    ['plans', 'Plans'],
    ['subscriptions', 'Subscriptions'],
    ['usage', 'Usage'],
    ['health', 'Health'],
    ['support', 'Support Access'],
    ['audit', 'Audit'],
    ['cbbo', 'CBBO / Agency'],
    ['security', 'Security Events'],
  ];

  return (
    <main className="platform-shell">
      <div className="platform-title-row">
        <div>
          <h1>Platform Administration</h1>
          <p>Priority #18 control-plane. Tenant business data remains in its owning modules.</p>
        </div>
        <button onClick={() => void load()} disabled={busy}>Refresh</button>
      </div>

      <div className="platform-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab-active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {busy && <div className="notice">Loading…</div>}

      {!busy && tab === 'applications' && <ApplicationsPanel data={data} onAction={withReason} />}
      {!busy && tab === 'admins' && <AdminsPanel data={data} afterSave={() => load()} />}
      {!busy && tab === 'plans' && <PlansPanel data={data} afterSave={() => load()} />}
      {!busy && tab === 'subscriptions' && <SubscriptionsPanel data={data} afterSave={() => load()} />}
      {!busy && tab === 'support' && <SupportPanel data={data} afterSave={() => load()} />}
      {!busy && !['applications', 'admins', 'plans', 'subscriptions', 'support'].includes(tab) && <JsonBlock value={data} />}
    </main>
  );
}

function ApplicationsPanel({
  data,
  onAction,
}: {
  data: unknown;
  onAction: (action: (reason: string) => Promise<unknown>, promptText: string) => Promise<void>;
}) {
  const items = ((data as { items?: ApplicationSummary[] } | null)?.items ?? []);
  if (items.length === 0) return <div className="notice">No submitted applications are waiting for review.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>FPO</th><th>Location</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{a.fpoName ?? a.id}</td>
              <td>{[a.district, a.state].filter(Boolean).join(', ') || '—'}</td>
              <td>{a.status}</td>
              <td>{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}</td>
              <td className="row-actions">
                <button onClick={() => void onAction((reason) => approveApplication(a.id, reason), 'Approval reason')}>Approve</button>
                <button className="danger" onClick={() => void onAction((reason) => rejectApplication(a.id, reason), 'Rejection reason')}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminsPanel({ data, afterSave }: { data: unknown; afterSave: () => Promise<void> }) {
  const rows = Array.isArray(data) ? data : [];
  const [form, setForm] = useState({
    username: '',
    email: '',
    role: 'SUPPORT_ADMIN' as 'SUPER_ADMIN' | 'SUPPORT_ADMIN',
    password: '',
    totpSecret: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createPlatformAdmin(form);
      setForm({ username: '', email: '', role: 'SUPPORT_ADMIN', password: '', totpSecret: '', reason: '' });
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div className="platform-grid">
      <section className="panel">
        <h2>Platform Administrators</h2>
        <JsonBlock value={rows} />
      </section>
      <form className="panel" onSubmit={submit}>
        <h2>Create Platform Administrator</h2>
        {error && <div className="error">{error}</div>}
        <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'SUPER_ADMIN' | 'SUPPORT_ADMIN' })}>
            <option value="SUPPORT_ADMIN">Support Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        <label>Initial password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <label>TOTP secret<input value={form.totpSecret} onChange={(e) => setForm({ ...form, totpSecret: e.target.value })} required /></label>
        <label>Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
        <button type="submit">Create</button>
      </form>
    </div>
  );
}

function PlansPanel({ data, afterSave }: { data: unknown; afterSave: () => Promise<void> }) {
  const rows = Array.isArray(data) ? data : [];
  const [form, setForm] = useState({
    planCode: '',
    planName: '',
    staffUsers: '10',
    effectiveDate: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createPlan({
        planCode: form.planCode,
        planName: form.planName,
        limits: { staffUsers: Number(form.staffUsers) },
        features: {},
        effectiveDate: form.effectiveDate,
        reason: form.reason,
      });
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div className="platform-grid">
      <section className="panel"><h2>Plan Versions</h2><JsonBlock value={rows} /></section>
      <form className="panel" onSubmit={submit}>
        <h2>Create Plan</h2>
        {error && <div className="error">{error}</div>}
        <label>Plan code<input value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })} required /></label>
        <label>Plan name<input value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} required /></label>
        <label>Staff-user limit<input type="number" min="0" value={form.staffUsers} onChange={(e) => setForm({ ...form, staffUsers: e.target.value })} required /></label>
        <label>Effective date<input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required /></label>
        <label>Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
        <button type="submit">Create Plan</button>
      </form>
    </div>
  );
}

function SubscriptionsPanel({ data, afterSave }: { data: unknown; afterSave: () => Promise<void> }) {
  const rows = Array.isArray(data) ? data : [];
  const [graceDays, setGraceDays] = useState('7');
  const [form, setForm] = useState({ tenantId: '', planVersionId: '', startDate: '', expiryDate: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  async function saveGrace() {
    const reason = window.prompt('Reason for changing the platform grace period');
    if (!reason) return;
    try {
      await configureGrace(Number(graceDays), reason);
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await assignSubscription(form);
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function setState(tenantId: string, state: 'SUSPENDED' | 'REACTIVATED' | 'EXPIRED_READ_ONLY') {
    const reason = window.prompt('Reason for lifecycle change');
    if (!reason) return;
    try {
      await changeSubscriptionState(tenantId, state, reason);
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div className="platform-grid">
      <section className="panel">
        <h2>Subscriptions</h2>
        {error && <div className="error">{error}</div>}
        <div className="inline-form">
          <input type="number" min="0" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          <button onClick={() => void saveGrace()}>Set Grace Days</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tenant</th><th>State</th><th>Expiry</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((raw, i) => {
                const row = raw as Record<string, unknown>;
                return (
                  <tr key={String(row.id ?? i)}>
                    <td>{String(row.tenantId ?? '')}</td>
                    <td>{String(row.state ?? '')}</td>
                    <td>{String(row.expiryDate ?? '')}</td>
                    <td className="row-actions">
                      <button className="danger" onClick={() => void setState(String(row.tenantId), 'SUSPENDED')}>Suspend</button>
                      <button onClick={() => void setState(String(row.tenantId), 'REACTIVATED')}>Reactivate</button>
                      <button onClick={() => void setState(String(row.tenantId), 'EXPIRED_READ_ONLY')}>Read-only</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <form className="panel" onSubmit={assign}>
        <h2>Assign Subscription</h2>
        <label>Tenant ID<input value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required /></label>
        <label>Plan version ID<input value={form.planVersionId} onChange={(e) => setForm({ ...form, planVersionId: e.target.value })} required /></label>
        <label>Start date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
        <label>Expiry date<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} required /></label>
        <label>Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
        <button type="submit">Assign</button>
      </form>
    </div>
  );
}

function SupportPanel({ data, afterSave }: { data: unknown; afterSave: () => Promise<void> }) {
  const rows = Array.isArray(data) ? data : [];
  const [form, setForm] = useState({ tenantId: '', reason: '', ticketContext: '', requestedDurationMinutes: '30' });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createSupportAccess({
        tenantId: form.tenantId,
        reason: form.reason,
        ticketContext: form.ticketContext,
        requestedDurationMinutes: Number(form.requestedDurationMinutes),
      });
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function revoke(id: string) {
    try {
      await revokeSupportAccess(id);
      await afterSave();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div className="platform-grid">
      <section className="panel">
        <h2>Support Access Requests</h2>
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tenant</th><th>Ticket</th><th>Status</th><th>Ends</th><th /></tr></thead>
            <tbody>
              {rows.map((raw, i) => {
                const row = raw as Record<string, unknown>;
                return (
                  <tr key={String(row.id ?? i)}>
                    <td>{String(row.tenantId ?? '')}</td>
                    <td>{String(row.ticketContext ?? '')}</td>
                    <td>{String(row.status ?? '')}</td>
                    <td>{String(row.endsAt ?? '—')}</td>
                    <td>{row.status === 'ACTIVE' && <button className="danger" onClick={() => void revoke(String(row.id))}>Revoke</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <form className="panel" onSubmit={submit}>
        <h2>Request Read-only Support Access</h2>
        <label>Tenant ID<input value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required /></label>
        <label>Ticket context<input value={form.ticketContext} onChange={(e) => setForm({ ...form, ticketContext: e.target.value })} required /></label>
        <label>Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></label>
        <label>Minutes<input type="number" min="1" value={form.requestedDurationMinutes} onChange={(e) => setForm({ ...form, requestedDurationMinutes: e.target.value })} required /></label>
        <button type="submit">Request Tenant Consent</button>
      </form>
    </div>
  );
}
