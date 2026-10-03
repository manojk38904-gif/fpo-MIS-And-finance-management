import { useState } from 'react';

type Loan = {
  loanApplicationNumber: string; memberApplicationNumber: string; fullName: string; fatherOrSpouseName?: string | null;
  address: string; village: string; district: string; state: string; pincode: string; purposeOfLoan: string;
  sanctionedAmount?: string | null; sanctionedTermMonths?: number | null; interestRate?: string | null;
  processingFeeRate?: string | null; repaymentFrequency?: string | null; sanctionDate?: string | null;
  collateralDetails?: string | null; bankName?: string | null; bankAccountNumber?: string | null; ifsc?: string | null;
  status: string; sanctionLetterIssuedAt?: string | null; agreementExecutedAt?: string | null;
};
export type LoanDocumentData = { fpoName: string; fpoCode: string; cin?: string; registeredAddress?: string; loan: Loan };

const money=(value?:string|null)=>value?`₹${Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';
const date=(value?:string|null)=>value?new Date(value).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}):'—';
const address=(loan:Loan)=>[loan.address,loan.village,loan.district,loan.state,loan.pincode].filter(Boolean).join(', ');

function PrintTemplate({type,data}:{type:'sanction'|'agreement';data:LoanDocumentData}){
  const {loan}=data;
  const details=<table><tbody>
    <tr><th>नाम / Name</th><td>{loan.fullName}</td><th>Loan Application No.</th><td>{loan.loanApplicationNumber}</td></tr>
    <tr><th>ऋण राशि / Loan Amount</th><td>{money(loan.sanctionedAmount)}</td><th>अवधि / Period</th><td>{loan.sanctionedTermMonths??'—'} माह</td></tr>
    <tr><th>ब्याज दर / Interest Rate</th><td>{loan.interestRate??'—'}% प्रति वर्ष</td><th>Processing Fee</th><td>{loan.processingFeeRate??'—'}%</td></tr>
    <tr><th>किस्त आवृत्ति / Repayment</th><td>{loan.repaymentFrequency??'—'}</td><th>Sanction Date</th><td>{date(loan.sanctionDate)}</td></tr>
  </tbody></table>;
  if(type==='sanction') return <section className="print-document loan-document">
    <div className="document-brand"><strong>{data.fpoName}</strong><span>FPO Code: {data.fpoCode}{data.cin?` | CIN: ${data.cin}`:''}</span></div>
    <h1>LOAN SANCTION LETTER</h1><p className="center">ऋण स्वीकृति पत्र</p>
    <div className="document-meta"><span>Ref: {loan.loanApplicationNumber}/SAN</span><span>Date: {date(loan.sanctionDate)}</span></div>
    <p>To,</p><p><b>{loan.fullName}</b><br/>{address(loan)}</p>
    <p><b>Subject: Sanction of loan for {loan.purposeOfLoan}</b></p>
    <p>Dear Sir/Madam,</p><p>With reference to your loan application no. <b>{loan.loanApplicationNumber}</b>, the FPO is pleased to sanction the loan subject to the following approved terms and conditions.</p>
    {details}
    <p>The loan shall be used only for the stated purpose. Repayment, security/collateral and all other conditions shall be governed by the FPO's approved loan policy and the signed loan agreement.</p>
    <p>Please sign below as acceptance of the above sanctioned terms.</p>
    <div className="sign-row"><div>Authorised Signatory<br/>{data.fpoName}</div><div>Borrower Acceptance<br/>{loan.fullName}</div></div>
  </section>;
  return <section className="print-document loan-document">
    <div className="document-brand"><strong>{data.fpoName}</strong><span>FPO Code: {data.fpoCode}</span></div>
    <h1>LOAN AGREEMENT</h1><p className="center">ऋण अनुबंध</p>
    <p>This Agreement is made on <b>{date(loan.sanctionDate)}</b> between <b>{data.fpoName}</b>, having its registered office at {data.registeredAddress||'the registered office of the FPO'} (the “Lender”), and <b>{loan.fullName}</b>, residing at {address(loan)} (the “Borrower”).</p>
    <p>The Borrower has requested a loan for <b>{loan.purposeOfLoan}</b>. The Lender has agreed to provide the sanctioned loan on the terms stated below.</p>
    {details}
    <ol className="agreement-terms">
      <li>The Borrower shall use the loan only for the stated purpose.</li>
      <li>The Borrower shall repay the principal, interest and disclosed charges according to the approved repayment schedule.</li>
      <li>Security/collateral, if any, recorded for this facility: <b>{loan.collateralDetails||'Not applicable / as recorded separately'}</b>.</li>
      <li>Any default, recovery or additional charge shall apply only in accordance with the approved FPO policy and the disclosed repayment schedule.</li>
      <li>The Borrower shall provide correct information and cooperate with FPO monitoring and field verification.</li>
      <li>This agreement is subject to the FPO's approved loan policy and applicable law. The parties should obtain independent legal review where required.</li>
    </ol>
    <p>IN WITNESS WHEREOF, the parties have signed this agreement on the date stated above.</p>
    <div className="sign-row"><div>Authorised Signatory<br/>{data.fpoName}</div><div>Borrower<br/>{loan.fullName}</div></div>
    <div className="sign-row"><div>Witness 1: ____________________</div><div>Witness 2: ____________________</div></div>
  </section>;
}

export default function LoanDocuments({data,onClose,onIssue,onAgreement}:{data:LoanDocumentData;onClose:()=>void;onIssue:()=>Promise<void>;onAgreement:()=>Promise<void>}){
  const [type,setType]=useState<'sanction'|'agreement'>('sanction');
  const [sanctionConfirmed,setSanctionConfirmed]=useState(false); const [agreementConfirmed,setAgreementConfirmed]=useState(false); const [busy,setBusy]=useState(false);
  const issued=Boolean(data.loan.sanctionLetterIssuedAt), executed=Boolean(data.loan.agreementExecutedAt);
  const markIssued=async()=>{setBusy(true);try{await onIssue()}finally{setBusy(false)}};
  const markAgreement=async()=>{setBusy(true);try{await onAgreement()}finally{setBusy(false)}};
  return <section className="card loan-documents"><h2>ऋण दस्तावेज़ और चेकलिस्ट</h2><p className="muted">दस्तावेज़ खोलें, प्रिंट/PDF करें और संबंधित कार्य वास्तविक रूप से पूरा होने पर tick करें।</p>
    <div className="document-checklist">
      <label className="checkbox"><input type="checkbox" checked={issued} readOnly/> Sanction Letter जारी किया गया {issued&&`(${date(data.loan.sanctionLetterIssuedAt)})`}</label>
      <button className="secondary" onClick={()=>setType('sanction')}>Sanction Letter खोलें</button>
      <label className="checkbox"><input type="checkbox" checked={executed} readOnly/> Borrower और FPO द्वारा Loan Agreement हस्ताक्षरित {executed&&`(${date(data.loan.agreementExecutedAt)})`}</label>
      <button className="secondary" onClick={()=>setType('agreement')} disabled={!issued}>Loan Agreement खोलें</button>
    </div>
    <div className="print-actions"><button onClick={()=>window.print()}>PDF डाउनलोड / प्रिंट</button><button className="secondary" onClick={onClose}>बंद करें</button></div>
    <PrintTemplate type={type} data={data}/>
    {type==='sanction'&&!issued&&<div className="document-action"><label className="checkbox"><input type="checkbox" checked={sanctionConfirmed} onChange={e=>setSanctionConfirmed(e.target.checked)}/> मैंने Sanction Letter को प्रिंट/जारी कर दिया है।</label><button disabled={!sanctionConfirmed||busy} onClick={()=>void markIssued()}>जारी होना दर्ज करें ✓</button></div>}
    {type==='agreement'&&issued&&!executed&&<div className="document-action"><label className="checkbox"><input type="checkbox" checked={agreementConfirmed} onChange={e=>setAgreementConfirmed(e.target.checked)}/> Borrower और FPO दोनों ने Agreement पर हस्ताक्षर कर दिए हैं।</label><button disabled={!agreementConfirmed||busy} onClick={()=>void markAgreement()}>Agreement निष्पादित दर्ज करें ✓</button></div>}
  </section>;
}
