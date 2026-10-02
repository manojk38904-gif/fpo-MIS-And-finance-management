import { useEffect, useMemo, useState } from 'react';
import { api, extractErrorMessage } from '../api/client';

type JsonRecord = Record<string, unknown>;
type Row = JsonRecord & { id?: string; status?: string; configKey?: string; version?: number; roleName?: string; branchName?: string };

const SCREENS = [
  ['SET-01', 'FPO Profile'],
  ['SET-02', 'Logo / Branding'],
  ['SET-03', 'Branch Master'],
  ['SET-05', 'Bank Accounts'],
  ['SET-06', 'Financial Year'],
  ['SET-07', 'Users'],
  ['SET-08', 'Roles & Permissions'],
  ['SET-09', 'Branch Access'],
  ['SET-11', 'Approval Matrix'],
  ['SET-12', 'Numbering Rules'],
  ['SET-13', 'Credit Settings'],
  ['SET-14', 'Interest Settings'],
  ['SET-15', 'Accounting Settings'],
  ['SET-16', 'Purchase Workflow Settings'],
  ['SET-17', 'Inventory Settings'],
  ['SET-20', 'Authorised Signatures'],
  ['SET-21', 'Regulatory Verification Status'],
  ['SET-22', 'Backup / Data Export'],
] as const;

const GOVERNED = new Set(['SET-05', 'SET-09', 'SET-11', 'SET-12', 'SET-13', 'SET-14', 'SET-16', 'SET-17', 'SET-21']);

const payloadExamples: Record<string, JsonRecord> = {
  'SET-05': { bankName: 'Indian Bank', accountNumber: '0000000000', ifsc: 'IDIB000M000', accountHolderName: 'FPO Name', applicability: 'FPO_LEVEL', purpose: 'GENERAL' },
  'SET-09': { userId: '00000000-0000-0000-0000-000000000000', accessScope: 'ALL_BRANCHES', permissionLevel: 'OPERATIONAL', branchIds: [] },
  'SET-11': { productType: 'CASH_LOAN', levels: [{ level: 1, minAmount: 0, maxAmount: 100000, roleId: '00000000-0000-0000-0000-000000000000' }] },
  'SET-12': { modes: { MEMBER_NO: 'CENTRALISED', LOAN_APP_NO: 'CENTRALISED', LOAN_ACCOUNT_NO: 'CENTRALISED', VOUCHER: 'CENTRALISED', RECEIPT: 'CENTRALISED', SANCTION: 'CENTRALISED', AGREEMENT: 'CENTRALISED', NOC: 'CENTRALISED', PURCHASE_SALE_INVOICE: 'CENTRALISED' } },
  'SET-13': { weights: { membershipHistory: 15, fpoBusinessHistory: 15, landholding: 10, cropIncomeCapacity: 15, bankingCapacity: 15, previousRepayment: 15, fieldVerification: 10, existingLiabilities: 5 }, exposureMode: 'SEPARATE', scoreBands: [{ min: 0, max: 49, band: 'HIGH_RISK' }, { min: 50, max: 74, band: 'MEDIUM_RISK' }, { min: 75, max: 100, band: 'LOW_RISK' }] },
  'SET-14': { dayCountConvention: 'ACTUAL_365', roundingMethod: 'NEAREST', decimalPlaces: 2, gracePeriodDays: 0 },
  'SET-16': { mode: 'STANDARD', applicability: 'ALL_BRANCHES', branchIds: [] },
  'SET-17': { valuationMethod: 'FIFO', nearExpiryThresholdDays: 30 },
  'SET-21': { professionalSourceName: '', verificationDate: '', evidenceReference: '', result: 'PENDING_REGULATORY_VERIFICATION' },
};

function Pretty({ value }: { value: unknown }) {
  return <pre className="json-box">{JSON.stringify(value, null, 2)}</pre>;
}

export default function TenantSettingsDashboard() {
  const [screen, setScreen] = useState('SET-01');
  const [rows, setRows] = useState<Row[]>([]);
  const [data, setData] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [configKey, setConfigKey] = useState('DEFAULT');
  const [payloadText, setPayloadText] = useState('{}');
  const [supersedesId, setSupersedesId] = useState('');
  const [decisionReason, setDecisionReason] = useState('Reviewed and confirmed.');
  const [profileText, setProfileText] = useState('{}');
  const [profileVersion, setProfileVersion] = useState(0);
  const [fy, setFy] = useState({ fyCode: '', startDate: '', endDate: '' });
  const [signatureKey, setSignatureKey] = useState('CHAIRPERSON');
  const [exportReason, setExportReason] = useState('Tenant data backup/export request');
  const title = useMemo(() => SCREENS.find(([id]) => id === screen)?.[1] ?? screen, [screen]);

  useEffect(() => {
    const example = payloadExamples[screen];
    if (example) setPayloadText(JSON.stringify(example, null, 2));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await fn();
      if (success) setMessage(success);
      return result;
    } catch (e) {
      setError(extractErrorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setRows([]); setData(null); setError(''); setMessage('');
    if (GOVERNED.has(screen)) {
      const r = await run(() => api.get<Row[]>(`/settings/governed/${screen}`));
      if (r) setRows(r.data);
      return;
    }
    if (screen === 'SET-01') {
      const r = await run(() => api.get('/settings/profile'));
      if (r) {
        setData(r.data);
        const p = r.data as JsonRecord;
        setProfileVersion(Number(p.version ?? 0));
        const editable: JsonRecord = {};
        for (const k of ['fpoName','gstin','registeredAddress','state','district','pincode','officialMobile','officialEmail','website']) {
          if (p[k] !== undefined) editable[k] = p[k];
        }
        setProfileText(JSON.stringify(editable, null, 2));
      }
    } else if (screen === 'SET-02') {
      const r = await run(() => api.get('/settings/branding')); if (r) setData(r.data);
    } else if (screen === 'SET-03') {
      const r = await run(() => api.get<Row[]>('/settings/branches')); if (r) setRows(r.data);
    } else if (screen === 'SET-06') {
      const r = await run(() => api.get<Row[]>('/settings/financial-years')); if (r) setRows(r.data);
    } else if (screen === 'SET-07') {
      const r = await run(() => api.get<Row[]>('/settings/users/requests')); if (r) setRows(r.data);
    } else if (screen === 'SET-08') {
      const r = await run(() => api.get<Row[]>('/settings/roles')); if (r) setRows(r.data);
    } else if (screen === 'SET-15') {
      const r = await run(() => api.get('/settings/accounting')); if (r) setData(r.data);
    } else if (screen === 'SET-20') {
      const r = await run(() => api.get(`/settings/authorised-signatures/${encodeURIComponent(signatureKey)}`)); if (r) setData(r.data);
    } else if (screen === 'SET-22') {
      const [a,b] = await Promise.all([run(() => api.get('/settings/backup-export/requests')), run(() => api.get('/settings/backup-export/public-qr-retention'))]);
      setData({ requests: a?.data ?? [], retention: b?.data ?? null });
    }
  }

  function parsePayload(): JsonRecord {
    const parsed = JSON.parse(payloadText);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Payload must be a JSON object.');
    return parsed as JsonRecord;
  }

  async function createGovernedDraft() {
    await run(async () => {
      const payload = parsePayload();
      const r = await api.post(`/settings/governed/${screen}`, { configKey, payload, ...(supersedesId ? { supersedesId } : {}) });
      await load();
      return r;
    }, 'Draft saved.');
  }

  async function decision(id: string, action: 'submit'|'approve'|'reject'|'send-back') {
    await run(async () => {
      const body = action === 'reject' || action === 'send-back' ? { reason: decisionReason } : {};
      await api.post(`/settings/governed/submissions/${id}/${action}`, body);
      await load();
    }, `${action} completed.`);
  }

  async function saveProfile() {
    await run(async () => {
      const payload = parseJsonObject(profileText);
      await api.put('/settings/profile', { expectedVersion: profileVersion, ...payload });
      await load();
    }, 'Profile updated.');
  }

  async function saveBranding() {
    await run(async () => {
      await api.put('/settings/branding', { payload: parsePayload(), expectedVersion: (data as JsonRecord | null)?.version ?? 0 });
      await load();
    }, 'Branding saved.');
  }

  async function createBranch() {
    await run(async () => {
      await api.post('/settings/branches', parsePayload());
      await load();
    }, 'Branch created.');
  }

  async function createRole() {
    await run(async () => {
      await api.post('/settings/roles', parsePayload());
      await load();
    }, 'Role draft created.');
  }

  async function createUser() {
    await run(async () => {
      await api.post('/settings/users/requests', parsePayload());
      await load();
    }, 'User request draft created.');
  }

  async function createFy() {
    await run(async () => { await api.post('/settings/financial-years', fy); await load(); }, 'Financial year created.');
  }

  async function saveSignature() {
    await run(async () => {
      await api.put(`/settings/authorised-signatures/${encodeURIComponent(signatureKey)}`, { payload: parsePayload(), expectedVersion: (data as JsonRecord | null)?.version ?? 0 });
      await load();
    }, 'Authorised signature configuration saved.');
  }

  async function requestExport() {
    await run(async () => {
      await api.post('/settings/backup-export/requests', { scope: 'ALL_DATA', reason: exportReason, idempotencyKey: crypto.randomUUID() });
      await load();
    }, 'Export request queued.');
  }

  function customCreateExample() {
    if (screen === 'SET-02') return { primaryColor: '#0b7a4b', secondaryColor: '#0b3d2e', logoReference: 'private-object-reference' };
    if (screen === 'SET-03') return { branchCode: 'BR-001', branchName: 'Head Office', branchType: 'HEAD_OFFICE', address: 'Address', state: 'Uttar Pradesh', district: 'Hamirpur', openingDate: new Date().toISOString().slice(0,10) };
    if (screen === 'SET-07') return { fullName: 'New User', mobile: '9000000000', email: 'user@example.org', roleId: '00000000-0000-0000-0000-000000000000', branchAccessScope: 'ALL_BRANCHES' };
    if (screen === 'SET-08') return { roleName: 'Field Officer', description: 'Operational role', permissions: { SETTINGS: ['VIEW'] }, branchScopeDefault: 'SELECTED_BRANCH' };
    if (screen === 'SET-20') return { personName: 'Authorised Signatory', designation: 'Director', imageReference: 'private-object-reference', active: true };
    return null;
  }

  useEffect(() => {
    const ex = customCreateExample();
    if (ex && !GOVERNED.has(screen)) setPayloadText(JSON.stringify(ex, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  return (
    <div className="workspace">
      <aside className="sidebar">
        <h2>FPO Settings</h2>
        <p className="muted">Priority #13 · 18 active screens</p>
        {SCREENS.map(([id,name]) => (
          <button key={id} className={screen === id ? 'side-link active' : 'side-link'} onClick={() => setScreen(id)}>
            <span>{id}</span><small>{name}</small>
          </button>
        ))}
      </aside>
      <main className="workspace-main">
        <div className="page-head"><div><h1>{screen} — {title}</h1><p>Tenant-scoped, server-authorised configuration.</p></div><button onClick={() => void load()} disabled={busy}>Refresh</button></div>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}

        {GOVERNED.has(screen) && (
          <section className="panel">
            <h3>Maker-Checker Configuration</h3>
            <div className="grid2">
              <label>Configuration Key<input value={configKey} onChange={e=>setConfigKey(e.target.value)} /></label>
              <label>Supersedes ID (for a new version)<input value={supersedesId} onChange={e=>setSupersedesId(e.target.value)} /></label>
            </div>
            <label>Configuration JSON<textarea rows={12} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label>
            <button onClick={() => void createGovernedDraft()} disabled={busy}>Save Draft</button>
            <label>Decision Reason<input value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} /></label>
            <div className="table-wrap"><table><thead><tr><th>Key</th><th>Version</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {rows.map((r)=><tr key={String(r.id)}><td>{String(r.configKey ?? '')}</td><td>{String(r.version ?? '')}</td><td><span className="badge">{String(r.status ?? '')}</span></td><td className="actions">
                {r.status === 'DRAFT' || r.status === 'SENT_BACK' ? <button onClick={()=>void decision(String(r.id),'submit')}>Submit</button> : null}
                {r.status === 'PENDING_APPROVAL' ? <><button onClick={()=>void decision(String(r.id),'approve')}>Approve</button><button className="danger" onClick={()=>void decision(String(r.id),'reject')}>Reject</button><button className="secondary" onClick={()=>void decision(String(r.id),'send-back')}>Send Back</button></> : null}
              </td></tr>)}
            </tbody></table></div>
          </section>
        )}

        {screen === 'SET-01' && <section className="panel"><h3>FPO Profile</h3><Pretty value={data}/><label>Editable profile JSON<textarea rows={12} value={profileText} onChange={e=>setProfileText(e.target.value)} /></label><button onClick={()=>void saveProfile()}>Save Profile</button></section>}
        {screen === 'SET-02' && <section className="panel"><h3>Tenant Branding</h3><Pretty value={data}/><label>Branding JSON<textarea rows={9} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label><button onClick={()=>void saveBranding()}>Save Branding</button></section>}
        {screen === 'SET-03' && <section className="panel"><h3>Branch Master</h3><label>New Branch JSON<textarea rows={9} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label><button onClick={()=>void createBranch()}>Create Branch</button><Pretty value={rows}/></section>}
        {screen === 'SET-06' && <section className="panel"><h3>Financial Year</h3><div className="grid3"><label>FY Code<input value={fy.fyCode} onChange={e=>setFy({...fy,fyCode:e.target.value})}/></label><label>Start<input type="date" value={fy.startDate} onChange={e=>setFy({...fy,startDate:e.target.value})}/></label><label>End<input type="date" value={fy.endDate} onChange={e=>setFy({...fy,endDate:e.target.value})}/></label></div><button onClick={()=>void createFy()}>Create Financial Year</button><Pretty value={rows}/></section>}
        {screen === 'SET-07' && <section className="panel"><h3>User Maker-Checker Requests</h3><label>New User Request JSON<textarea rows={9} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label><button onClick={()=>void createUser()}>Save User Draft</button><Pretty value={rows}/></section>}
        {screen === 'SET-08' && <section className="panel"><h3>Roles & Permissions</h3><label>New Role JSON<textarea rows={9} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label><button onClick={()=>void createRole()}>Save Role Draft</button><Pretty value={rows}/></section>}
        {screen === 'SET-15' && <section className="panel"><h3>Accounting Settings</h3><Pretty value={data}/><p className="muted">This screen is intentionally a read-only ownership boundary to Priority #10.</p></section>}
        {screen === 'SET-20' && <section className="panel"><h3>Authorised Signatures</h3><label>Signature Key<input value={signatureKey} onChange={e=>setSignatureKey(e.target.value)}/></label><Pretty value={data}/><label>Signature Metadata JSON<textarea rows={8} value={payloadText} onChange={e=>setPayloadText(e.target.value)} /></label><button onClick={()=>void saveSignature()}>Save Signature</button></section>}
        {screen === 'SET-22' && <section className="panel"><h3>Backup / Data Export</h3><Pretty value={data}/><label>Export Reason<input value={exportReason} onChange={e=>setExportReason(e.target.value)}/></label><button onClick={()=>void requestExport()}>Request Full Data Export</button></section>}
      </main>
    </div>
  );
}

function parseJsonObject(text: string): JsonRecord {
  const parsed = JSON.parse(text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('JSON object required.');
  return parsed as JsonRecord;
}
