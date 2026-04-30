import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { LivenessScanStep } from '../components/LivenessScanStep';
import {
  ApiError,
  fetchMe,
  previewInvite,
  register,
  type InvitePreview,
  type Position,
} from '../lib/api';
import { saveSession } from '../lib/session';

type InviteStep = 'preview' | 'form' | 'face' | 'done';

interface InviteFormValues {
  name: string;
  password: string;
  phone: string;
  iin: string;
  position: Position;
}

export function Invite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null | 'error'>(null);
  const [step, setStep] = useState<InviteStep>('preview');
  const [values, setValues] = useState<InviteFormValues>({
    name: '', password: '', phone: '', iin: '', position: 'Staff',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof InviteFormValues, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    previewInvite(token)
      .then((p) => { if (live) setPreview(p); })
      .catch(() => { if (live) setPreview('error'); });
    return () => { live = false; };
  }, [token]);

  if (!token) return <Card><p className="text-ink-500">Missing invite token.</p></Card>;
  if (preview === null) return <Card><p className="text-ink-500">Loading invite…</p></Card>;
  if (preview === 'error') {
    return (
      <Card>
        <h2 className="text-xl font-extrabold tracking-tight text-ink-900">Invite not found</h2>
        <p className="text-ink-500 text-sm mt-2">This link is invalid or has been removed.</p>
        <Link to="/" className="mt-4 inline-block text-gold-300 hover:text-gold-400 text-sm font-semibold">Go home →</Link>
      </Card>
    );
  }
  if (!preview.valid) {
    return (
      <Card>
        <h2 className="text-xl font-extrabold tracking-tight text-ink-900">Invite unavailable</h2>
        <p className="text-ink-500 text-sm mt-2">{preview.reason ?? 'This invite is no longer valid.'}</p>
        <Link to="/" className="mt-4 inline-block text-gold-300 hover:text-gold-400 text-sm font-semibold">Go home →</Link>
      </Card>
    );
  }

  const validateForm = (): boolean => {
    const next: Partial<Record<keyof InviteFormValues, string>> = {};
    if (values.name.trim().length < 2) next.name = 'Enter your full name';
    if (values.password.length < 8) next.password = 'Password must be at least 8 characters';
    if (!/^\d{12}$/.test(values.iin)) next.iin = 'IIN must be 12 digits';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const finish = async (frames: Parameters<Parameters<typeof LivenessScanStep>[0]['onComplete']>[0]) => {
    setSubmitError(null);
    try {
      const result = await register({
        name: values.name,
        email: preview.email,
        password: values.password,
        // Backend ignores company_name when invite_token is set, but the
        // schema still requires a non-empty value. Reuse the org name.
        company_name: preview.organization_name,
        phone: values.phone,
        iin: values.iin,
        position: values.position,
        frames,
        invite_token: token,
      });
      const me = await fetchMe(result.token);
      saveSession({ user: result.user, token: result.token, permissions: me.permissions });
      setStep('done');
      setTimeout(() => navigate('/profile'), 1400);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Registration failed';
      setSubmitError(msg);
      throw e; // bubbles up to LivenessScanStep so the user sees it inline
    }
  };

  if (step === 'preview') {
    return (
      <Card>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">You've been invited</h2>
        <div className="mt-4 rounded-2xl border border-gold-500/30 bg-gold-500/10 p-4 space-y-1">
          <Row label="Organization" value={preview.organization_name} />
          <Row label="Email" value={preview.email} mono />
          <Row label="Role" value={preview.role} />
          <Row label="Expires" value={new Date(preview.expires_at).toLocaleString()} />
        </div>
        <p className="mt-4 text-sm text-ink-500">
          You'll set a password and enrol your face. Your role and organization are locked by the invite.
        </p>
        <div className="mt-5">
          <PrimaryButton onClick={() => setStep('form')}>Continue</PrimaryButton>
        </div>
      </Card>
    );
  }

  if (step === 'form') {
    return (
      <Card className="max-w-xl">
        <div className="flex items-center gap-3 mb-4">
          <BackButton onClick={() => setStep('preview')} />
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Your details</h2>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (validateForm()) setStep('face'); }}
          className="space-y-4"
        >
          <Field label="Full name" value={values.name} onChange={(v) => setValues({ ...values, name: v })} error={errors.name} />
          <Field
            label="Email"
            value={preview.email}
            onChange={() => {}}
            disabled
            hint="Locked to the invited address"
          />
          <Field label="Password" type="password" value={values.password} onChange={(v) => setValues({ ...values, password: v })} error={errors.password} hint="At least 8 characters" />
          <Field label="Phone number" value={values.phone} onChange={(v) => setValues({ ...values, phone: v })} type="tel" />
          <Field
            label="IIN (12 digits)"
            value={values.iin}
            onChange={(v) => setValues({ ...values, iin: v.replace(/\D/g, '').slice(0, 12) })}
            error={errors.iin}
            inputMode="numeric"
            maxLength={12}
          />
          <Select
            label="Position"
            value={values.position}
            onChange={(v) => setValues({ ...values, position: v as Position })}
            options={[
              { value: 'Owner', label: 'Owner' },
              { value: 'Manager', label: 'Manager' },
              { value: 'Staff', label: 'Staff' },
            ]}
          />
          <p className="text-xs text-ink-500">
            Your role is locked to <span className="font-semibold text-gold-300">{preview.role}</span> by the invite.
          </p>
          <div className="pt-2">
            <PrimaryButton type="submit">Continue to Face ID</PrimaryButton>
          </div>
        </form>
      </Card>
    );
  }

  if (step === 'face') {
    return (
      <Card className="max-w-xl lg:max-w-3xl p-5 sm:p-7 lg:p-8">
        <div className="flex items-center gap-3 mb-4">
          <BackButton onClick={() => setStep('form')} />
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Face verification</h2>
        </div>
        {submitError && <p className="text-sm text-rose-500 mb-3">{submitError}</p>}
        <LivenessScanStep onBack={() => setStep('form')} onComplete={finish} />
      </Card>
    );
  }

  // step === 'done'
  return (
    <Card>
      <div className="flex flex-col items-center text-center gap-5 py-4">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          className="w-20 h-20 rounded-full bg-gold-500 flex items-center justify-center shadow-lg"
        >
          <svg viewBox="0 0 52 52" className="w-10 h-10 text-ink-900">
            <motion.path d="M14 27 l8 8 l16 -18" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
          </svg>
        </motion.div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Welcome aboard, {values.name}!</h2>
          <p className="text-ink-500 text-sm">Joined {preview.organization_name} as {preview.role}.</p>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs uppercase tracking-wider text-ink-500 w-24 shrink-0">{label}</span>
      <span className={`text-sm text-ink-900 ${mono ? 'font-mono' : 'font-semibold'} truncate`}>{value}</span>
    </div>
  );
}

interface FieldP {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  disabled?: boolean;
  inputMode?: 'numeric' | 'text' | 'email' | 'tel';
  maxLength?: number;
}

function Field({ label, value, onChange, error, hint, type = 'text', disabled, ...rest }: FieldP) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-2xl border px-4 py-3 text-ink-900 outline-none transition-colors focus:border-gold-500 ${
          disabled ? 'bg-cream-100/40 border-cream-200/30 text-ink-500' : 'bg-cream-50 border-cream-200 focus:bg-cream-100'
        } ${error ? 'border-rose-300' : ''}`}
        {...rest}
      />
      {error && <span className="block text-xs text-rose-500 mt-1">{error}</span>}
      {!error && hint && <span className="block text-xs text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl bg-cream-50 border border-cream-200 px-4 py-3 text-ink-900 outline-none focus:border-gold-500 focus:bg-cream-100 transition-colors appearance-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
