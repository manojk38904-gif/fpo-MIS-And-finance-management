import { useEffect, useMemo, useState } from 'react';
import { api, extractErrorMessage } from '../api/client';

type Json = Record<string, unknown>;

const SCREENS = [
  ['SA-01','FPO / Tenant Applications'],
  ['SA-02','Tenant Management'],
  ['SA-03','Subscription Plans'],
  ['SA-04','Tenant Subscription'],
  ['SA-05','Platform Usage'],
  ['SA-06','Platform Health'],
  ['SA-07','Support Access'],
  ['SA-08','Platform Audit'],
  ['SA-09','CBBO / Agency Hierarchy'],
  ['SA-10','Security Events'],
] as const;

function JsonBlock({value}:{value:unknown}) { return <pre className="json-box">{JSON.stringify(value,null,2)}</pre>; }

export default function PlatformAdminDashboard() {
  const [screen,setScreen]=useState('SA-01');
  const [data,setData]=useState<unknown>(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [id,setId]=useState('');
  const [reason,setReason]=useState('Reviewed and approved.');
  const [jsonText,setJsonText]=useState('{}');
  const title=useMemo(()=>SCREENS.find(([x])=>x===screen)?.[1] ?? screen,[screen]);

  useEffect(()=>{ setExample(); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[screen]);

  async function run<T>(fn:()=>Promise<T>,success?:string):Promise<T|undefined>{
    setBusy(true);setError('');setMessage('');
    try{const r=await fn();if(success)setMessage(success);return r;}catch(e){setError(extractErrorMessage(e));return undefined;}finally{setBusy(false);}
  }

  function setExample(){
    if(screen==='SA-03') setJsonText(JSON.stringify({planCode:'STANDARD',planName:'Standard',limits:{users:25,branches:5},features:{reports:true},effectiveDate:new Date().toISOString().slice(0,10),reason:'Initial plan configuration'},null,2));
    else if(screen==='SA-04') setJsonText(JSON.stringify({tenantId:'00000000-0000-0000-0000-000000000000',planVersionId:'00000000-0000-0000-0000-000000000000',startDate:new Date().toISOString().slice(0,10),expiryDate:new Date(Date.now()+365*86400000).toISOString().slice(0,10),reason:'Subscription assignment'},null,2));
    else if(screen==='SA-07') setJsonText(JSON.stringify({tenantId:'00000000-0000-0000-0000-000000000000',reason:'Support investigation',ticketContext:'Support ticket reference',requestedDurationMinutes:30,idempotencyKey:crypto.randomUUID()},null,2));
    else setJsonText('{}');
  }

  async function load(){
    const endpoint:Record<string,string>={
      'SA-01':'/super-admin/applications',
      'SA-02':'/super-admin/tenants',
      'SA-03':'/super-admin/subscription-plans',
      'SA-04':'/super-admin/subscriptions',
      'SA-05':'/super-admin/usage',
      'SA-06':'/super-admin/health',
      'SA-07':'/super-admin/support-access',
      'SA-08':'/super-admin/audit',
      'SA-09':'/super-admin/cbbo-agency-hierarchy',
      'SA-10':'/super-admin/security-events',
    };
    const r=await run(()=>api.get(endpoint[screen]));
    if(r)setData(r.data);
  }

  function payload():Json{
    const p=JSON.parse(jsonText);
    if(!p||Array.isArray(p)||typeof p!=='object') throw new Error('JSON object required.');
    return p as Json;
  }

  async function appAction(action:'begin-review'|'approve'|'reject'){
    if(!id) return setError('Application ID required.');
    await run(async()=>{await api.post(`/super-admin/applications/${id}/${action}`,{reason});await load();},`Application ${action} completed.`);
  }

  async function resendFpoSetupLink(){
    if(!id) return setError('Application ID required.');
    await run(async()=>{await api.post(`/super-admin/tenants/${id}/resend-setup-link`,{});},'A new FPO setup link was sent.');
  }

  async function createPlan(){
    await run(async()=>{await api.post('/super-admin/subscription-plans',payload());await load();},'Plan created.');
  }

  async function assignSubscription(){
    await run(async()=>{await api.post('/super-admin/subscriptions',payload());await load();},'Subscription assigned.');
  }

  async function changeSubscription(state:string){
    if(!id) return setError('Tenant ID required.');
    await run(async()=>{await api.post(`/super-admin/subscriptions/${id}/state`,{state,reason});await load();},`Subscription state changed to ${state}.`);
  }

  async function createSupport(){
    await run(async()=>{await api.post('/super-admin/support-access',payload());await load();},'Support access request created.');
  }

  async function revokeSupport(){
    if(!id) return setError('Support request ID required.');
    await run(async()=>{await api.post(`/super-admin/support-access/${id}/revoke`,{});await load();},'Support session revoked.');
  }

  return <div className="workspace platform-shell">
    <aside className="sidebar platform-sidebar">
      <h2>Platform Control Plane</h2>
      <p className="muted">Priority #18 · 10 frozen screens</p>
      {SCREENS.map(([sid,name])=><button key={sid} className={screen===sid?'side-link active':'side-link'} onClick={()=>setScreen(sid)}><span>{sid}</span><small>{name}</small></button>)}
    </aside>
    <main className="workspace-main">
      <div className="page-head"><div><h1>{screen} — {title}</h1><p>Platform-level control surface. Tenant raw-table bypass is not used.</p></div><button onClick={()=>void load()} disabled={busy}>Refresh</button></div>
      {message&&<div className="success">{message}</div>}{error&&<div className="error">{error}</div>}

      {screen==='SA-01'&&<section className="panel"><h3>Application Review</h3><JsonBlock value={data}/><div className="grid2"><label>Application ID<input value={id} onChange={e=>setId(e.target.value)}/></label><label>Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label></div><div className="actions"><button onClick={()=>void appAction('begin-review')}>Begin Review</button><button onClick={()=>void appAction('approve')}>Approve</button><button onClick={()=>void resendFpoSetupLink()}>Resend FPO setup email</button><button className="danger" onClick={()=>void appAction('reject')}>Reject</button></div></section>}

      {screen==='SA-02'&&<section className="panel"><h3>Tenant Management</h3><p className="muted">Platform tenant registry and controlled status view.</p><JsonBlock value={data}/></section>}

      {screen==='SA-03'&&<section className="panel"><h3>Subscription Plans</h3><JsonBlock value={data}/><label>New Plan JSON<textarea rows={12} value={jsonText} onChange={e=>setJsonText(e.target.value)}/></label><button onClick={()=>void createPlan()}>Create Plan</button></section>}

      {screen==='SA-04'&&<section className="panel"><h3>Tenant Subscription</h3><JsonBlock value={data}/><label>Assign Subscription JSON<textarea rows={12} value={jsonText} onChange={e=>setJsonText(e.target.value)}/></label><button onClick={()=>void assignSubscription()}>Assign Subscription</button><div className="grid2"><label>Tenant ID for State Change<input value={id} onChange={e=>setId(e.target.value)}/></label><label>Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label></div><div className="actions"><button onClick={()=>void changeSubscription('ACTIVE')}>Active</button><button onClick={()=>void changeSubscription('GRACE')}>Grace</button><button className="danger" onClick={()=>void changeSubscription('SUSPENDED')}>Suspend</button><button className="secondary" onClick={()=>void changeSubscription('REACTIVATED')}>Reactivate</button></div></section>}

      {screen==='SA-05'&&<section className="panel"><h3>Platform Usage</h3><JsonBlock value={data}/></section>}
      {screen==='SA-06'&&<section className="panel"><h3>Platform Health</h3><JsonBlock value={data}/></section>}

      {screen==='SA-07'&&<section className="panel"><h3>Support Access</h3><JsonBlock value={data}/><label>New Support Request JSON<textarea rows={10} value={jsonText} onChange={e=>setJsonText(e.target.value)}/></label><button onClick={()=>void createSupport()}>Request Tenant Support Access</button><div className="grid2"><label>Support Request ID<input value={id} onChange={e=>setId(e.target.value)}/></label><label>Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label></div><button className="danger" onClick={()=>void revokeSupport()}>Revoke Active Support Session</button></section>}

      {screen==='SA-08'&&<section className="panel"><h3>Platform Audit</h3><JsonBlock value={data}/><p className="muted">Presentation boundary only; Priority #15 remains the authoritative audit-event source.</p></section>}
      {screen==='SA-09'&&<section className="panel disabled-panel"><h3>CBBO / Agency Hierarchy</h3><span className="badge">COMING SOON · DISABLED</span><JsonBlock value={data}/><p>No live hierarchy, mutation API, Agency-to-FPO mapping, or operational workflow is enabled.</p></section>}
      {screen==='SA-10'&&<section className="panel"><h3>Security Events</h3><JsonBlock value={data}/></section>}
    </main>
  </div>;
}
