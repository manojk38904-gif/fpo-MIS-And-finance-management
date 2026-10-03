import { useState } from 'react';
import {
  createDraft,
  updateDraftByResumeToken,
  sendEmailOtp,
  verifyEmailOtp,
  uploadDocument,
  submitRegistration,
  type RegistrationDraft,
  type DocumentType,
} from '../api/registration';
import { extractErrorMessage } from '../api/client';

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'REGISTRATION_CERTIFICATE', label: 'Registration Certificate' },
  { value: 'INCORPORATION_CERTIFICATE', label: 'Incorporation Certificate' },
  { value: 'PAN_UPLOAD', label: 'PAN Card' },
  { value: 'GST_DOCUMENT', label: 'GST Document' },
  { value: 'LOGO_UPLOAD', label: 'FPO Logo' },
];

type Step = 'details' | 'otp' | 'documents' | 'submitted';

/**
 * FPO self-registration wizard — SYS-02/SYS-03 against the real, tested
 * Priority #1 backend. Every field name and endpoint here mirrors the
 * backend DTOs/controller exactly (see src/api/registration.ts); nothing
 * here is invented UI-only business logic.
 */
export default function RegistrationWizard() {
  const [step, setStep] = useState<Step>('details');
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<RegistrationDraft>({ termsAccepted: false });

  function field<K extends keyof RegistrationDraft>(key: K) {
    return {
      value: (draft[key] as string) ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [key]: e.target.value })),
    };
  }

  async function handleSaveAndSendOtp() {
    setError(null);
    setBusy(true);
    try {
      let token = resumeToken;
      if (!token) {
        const created = await createDraft(draft);
        token = created.resumeToken;
        setResumeToken(token);
      } else {
        await updateDraftByResumeToken(token, draft);
      }
      if (!draft.officialEmail) throw new Error('Official email is required to send the OTP.');
      const { otpVerificationId: id } = await sendEmailOtp(token, draft.officialEmail);
      setOtpVerificationId(id);
      setStep('otp');
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    if (!resumeToken || !otpVerificationId) return;
    setError(null);
    setBusy(true);
    try {
      await verifyEmailOtp(resumeToken, otpVerificationId, otp);
      setStep('documents');
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(documentType: DocumentType, file: File) {
    if (!resumeToken) return;
    setError(null);
    setBusy(true);
    try {
      await uploadDocument(resumeToken, documentType, file);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!resumeToken) return;
    setError(null);
    setBusy(true);
    try {
      await submitRegistration(resumeToken);
      setStep('submitted');
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>FPO Registration</h1>
      {error && <div className="error">{error}</div>}

      {step === 'details' && (
        <>
          <label>FPO Name<input {...field('fpoName')} /></label>
          <label>CIN<input {...field('cin')} placeholder="U12345MH2020PLC123456" /></label>
          <label>Registration Number<input {...field('registrationNumber')} placeholder="Company/FPO registration number" /></label>
          <label>Incorporation Date<input {...field('incorporationDate')} type="date" /></label>
          <label>PAN<input {...field('pan')} placeholder="ABCDE1234F" /></label>
          <label>Chairman Name<input {...field('chairmanName')} /></label>
          <label>CEO Name<input {...field('ceoName')} /></label>
          <label>Authorised Person Name<input {...field('authorisedPersonName')} /></label>
          <label>Registered Address<input {...field('registeredAddress')} /></label>
          <label>State<input {...field('state')} /></label>
          <label>District<input {...field('district')} /></label>
          <label>PIN Code<input {...field('pincode')} /></label>
          <label>Official Mobile<input {...field('officialMobile')} placeholder="9876543210" /></label>
          <label>Official Email<input {...field('officialEmail')} type="email" /></label>
          <label>Bank Name<input {...field('bankName')} /></label>
          <label>Bank Account Number<input {...field('bankAccountNumber')} /></label>
          <label>IFSC<input {...field('bankIfsc')} /></label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.termsAccepted ?? false}
              onChange={(e) => setDraft((d) => ({ ...d, termsAccepted: e.target.checked }))}
            />
            I accept the terms &amp; conditions
          </label>
          <button disabled={busy} onClick={handleSaveAndSendOtp}>
            {busy ? 'Please wait…' : 'Save & Send Email OTP'}
          </button>
        </>
      )}

      {step === 'otp' && (
        <>
          <p>Enter the 6-digit OTP sent to {draft.officialEmail}</p>
          <input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} />
          <button disabled={busy} onClick={handleVerifyOtp}>
            {busy ? 'Verifying…' : 'Verify OTP'}
          </button>
        </>
      )}

      {step === 'documents' && (
        <>
          <button disabled={busy} onClick={() => setStep('details')}>Edit Registration Details</button>
          <p>Upload mandatory documents, then submit for verification.</p>
          {DOCUMENT_TYPES.map((d) => (
            <label key={d.value} className="file-row">
              {d.label}
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(d.value, f);
                }}
              />
            </label>
          ))}
          <button disabled={busy} onClick={handleSubmit}>
            {busy ? 'Submitting…' : 'Submit Registration'}
          </button>
        </>
      )}

      {step === 'submitted' && (
        <p>
          ✅ Registration submitted for verification. You will receive your FPO Code and login
          details by email once approved.
        </p>
      )}
    </div>
  );
}
