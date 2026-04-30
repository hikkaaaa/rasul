import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  ApiError,
  fetchMe,
  register,
  registerCheck,
  type Position,
  type Role,
} from '../lib/api';
import { saveSession } from '../lib/session';
import { LivenessScanStep, type LivenessResult } from '../components/LivenessScanStep';

type StepKey = 'basics' | 'contact' | 'face' | 'done';

const STEPS: { key: Exclude<StepKey, 'done'>; label: string }[] = [
  { key: 'basics', label: 'Basic Details' },
  { key: 'contact', label: 'Contact Details' },
  { key: 'face', label: 'Verification' },
];

interface BasicsValues {
  name: string;
  email: string;
  password: string;
  company_name: string;
}

interface ContactValues {
  phone: string;
  iin: string;
  position: Position;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState<StepKey>('basics');

  const [basics, setBasics] = useState<BasicsValues>({
    name: '', email: '', password: '', company_name: '',
  });
  const [contact, setContact] = useState<ContactValues>({
    phone: '', iin: '', position: 'Owner',
  });
  // Filled by /api/register/check on Step 1 → Step 2 transition. Tells the
  // user whether they're creating a new company or claiming a seeded slot.
  const [claimNote, setClaimNote] = useState<{ org: string; role: Role } | null>(null);

  // Direction we're animating between steps (1 = forward, -1 = back) so the
  // slide-in matches the user's intent.
  const [direction, setDirection] = useState<1 | -1>(1);

  const goNext = (next: StepKey) => { setDirection(1); setStep(next); };
  const goPrev = (prev: StepKey) => { setDirection(-1); setStep(prev); };

  const finishRegistration = async (frames: LivenessResult['frames']) => {
    const payload = {
      ...basics,
      ...contact,
      frames,
      invite_token: null,
    };
    const result = await register(payload);
    const me = await fetchMe(result.token);
    saveSession({ user: result.user, token: result.token, permissions: me.permissions });
    setStep('done');
    setTimeout(() => navigate(result.is_account_owner ? '/team' : '/profile'), 1400);
  };

  if (step === 'done') {
    return (
      <Card>
        <DoneStep name={basics.name} />
      </Card>
    );
  }

  return (
    <Card className="max-w-xl lg:max-w-3xl p-5 sm:p-7 lg:p-8">
      <div className="flex items-center gap-3 mb-4">
        <BackButton to="/" />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Sign up</h2>
      </div>

      <Stepper current={step} />

      <div className="relative mt-2 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          {step === 'basics' && (
            <SlideIn key="basics" direction={direction}>
              <BasicsStep
                values={basics}
                onChange={setBasics}
                onNext={async () => {
                  const res = await registerCheck(basics);
                  if (res.status === 'conflict_email' || res.status === 'conflict_company') {
                    throw new Error(res.message);
                  }
                  if (res.status === 'claim' && res.organization_name && res.role) {
                    setClaimNote({ org: res.organization_name, role: res.role });
                  } else {
                    setClaimNote(null);
                  }
                  goNext('contact');
                }}
              />
            </SlideIn>
          )}
          {step === 'contact' && (
            <SlideIn key="contact" direction={direction}>
              <ContactStep
                values={contact}
                onChange={setContact}
                claimNote={claimNote}
                onBack={() => goPrev('basics')}
                onNext={() => goNext('face')}
              />
            </SlideIn>
          )}
          {step === 'face' && (
            <SlideIn key="face" direction={direction}>
              <LivenessScanStep
                onBack={() => goPrev('contact')}
                onComplete={finishRegistration}
              />
            </SlideIn>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────

interface StepperProps {
  current: StepKey;
}

function Stepper({ current }: StepperProps) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4 py-3 mb-2 select-none">
      {STEPS.map((s, i) => {
        const state: 'done' | 'current' | 'pending' =
          i < idx ? 'done' : i === idx ? 'current' : 'pending';
        return (
          <div key={s.key} className="flex items-center gap-3 sm:gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ' +
                  (state === 'done'
                    ? 'bg-gold-500 text-ink-900'
                    : state === 'current'
                    ? 'bg-gold-500 text-ink-900 ring-4 ring-gold-500/25'
                    : 'bg-cream-100 text-ink-500 border border-cream-200/40')
                }
              >
                {state === 'done' ? (
                  <svg viewBox="0 0 12 12" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5l3 3 5-6" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={'text-[11px] sm:text-xs font-semibold whitespace-nowrap ' + (state === 'pending' ? 'text-ink-500' : 'text-ink-900')}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="w-8 sm:w-14 h-px bg-cream-200/50 mt-[-18px]" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Slide transition ───────────────────────────────────────────────────

interface SlideInProps {
  children: React.ReactNode;
  direction: 1 | -1;
}

function SlideIn({ children, direction }: SlideInProps) {
  return (
    <motion.div
      custom={direction}
      initial={{ opacity: 0, x: direction * 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction * -32 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ─── Step 1: basics ─────────────────────────────────────────────────────

interface BasicsStepProps {
  values: BasicsValues;
  onChange: (v: BasicsValues) => void;
  onNext: () => Promise<void>;
}

function BasicsStep({ values, onChange, onNext }: BasicsStepProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Partial<BasicsValues>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): boolean => {
    const next: Partial<BasicsValues> = {};
    if (values.name.trim().length < 2) next.name = 'Enter your full name';
    if (!EMAIL_RE.test(values.email)) next.email = 'Enter a valid email';
    if (values.password.length < 8) next.password = 'Password must be at least 8 characters';
    if (values.company_name.trim().length < 1) next.company_name = 'Enter a company name';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await onNext();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not validate details');
    } finally {
      setBusy(false);
    }
  };

  const set = (field: keyof BasicsValues, v: string) =>
    onChange({ ...values, [field]: v });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-ink-500 text-sm mb-2">A few quick details about you and your company.</p>

      <Field label="Full name" value={values.name} onChange={(v) => set('name', v)} error={errors.name} autoComplete="name" />
      <Field label="Email" type="email" value={values.email} onChange={(v) => set('email', v)} error={errors.email} autoComplete="email" />
      <Field label="Password" type="password" value={values.password} onChange={(v) => set('password', v)} error={errors.password} autoComplete="new-password" hint="At least 8 characters" />
      <Field label="Company name" value={values.company_name} onChange={(v) => set('company_name', v)} error={errors.company_name} autoComplete="organization" />

      <label className="flex items-start gap-3 mt-3 group cursor-pointer pr-4">
        <div className="relative flex items-center justify-center mt-0.5">
          <input type="checkbox" className="peer sr-only" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <div className="w-5 h-5 rounded border border-cream-200/50 bg-cream-50 transition-all peer-checked:bg-gold-500 peer-checked:border-gold-500 group-hover:border-gold-500/50 flex items-center justify-center">
            <svg className={`w-3.5 h-3.5 text-ink-900 transition-transform ${confirmed ? 'scale-100' : 'scale-0'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <span className="text-sm font-medium text-ink-500 group-hover:text-ink-700 transition-colors leading-snug">
          I confirm that all the information provided is true and accurate.
        </span>
      </label>

      {submitError && <p className="text-sm text-rose-500 -mt-1">{submitError}</p>}

      <div className="pt-2">
        <PrimaryButton
          type="submit"
          disabled={
            busy ||
            !confirmed ||
            values.name.trim() === '' ||
            values.email.trim() === '' ||
            values.password === '' ||
            values.company_name.trim() === ''
          }
          loading={busy}
        >
          Continue
        </PrimaryButton>
      </div>
    </form>
  );
}

// ─── Step 2: contact ────────────────────────────────────────────────────

interface ContactStepProps {
  values: ContactValues;
  onChange: (v: ContactValues) => void;
  claimNote: { org: string; role: Role } | null;
  onBack: () => void;
  onNext: () => void;
}

function ContactStep({ values, onChange, claimNote, onBack, onNext }: ContactStepProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof ContactValues, string>>>({});

  const validate = (): boolean => {
    const next: Partial<Record<keyof ContactValues, string>> = {};
    if (!/^\d{12}$/.test(values.iin)) next.iin = 'IIN must be 12 digits';
    if (!values.position) next.position = 'Pick a role';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {claimNote ? (
        <div className="rounded-2xl border border-gold-500/30 bg-gold-500/10 p-4 text-sm">
          <div className="font-semibold text-ink-900">
            Claiming an existing account in <span className="font-extrabold">{claimNote.org}</span>
          </div>
          <p className="text-ink-500 mt-1">
            Your role is preset to <span className="font-semibold text-gold-300">{claimNote.role}</span>.
            The position you pick below is just a job title shown to teammates.
          </p>
        </div>
      ) : (
        <p className="text-ink-500 text-sm">Phone, IIN, and the position you'll have at this company.</p>
      )}

      <Field
        label="Phone number"
        value={values.phone}
        onChange={(v) => onChange({ ...values, phone: v })}
        autoComplete="tel"
        type="tel"
      />
      <Field
        label="IIN (12 digits)"
        value={values.iin}
        onChange={(v) => onChange({ ...values, iin: v.replace(/\D/g, '').slice(0, 12) })}
        error={errors.iin}
        inputMode="numeric"
        maxLength={12}
      />
      <SelectField
        label="Position / Role"
        value={values.position}
        onChange={(v) => onChange({ ...values, position: v as Position })}
        options={[
          { value: 'Owner', label: 'Owner' },
          { value: 'Manager', label: 'Manager' },
          { value: 'Staff', label: 'Staff' },
        ]}
      />

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-2xl bg-cream-100 hover:bg-cream-200/40 border border-cream-200/40 text-ink-900 font-medium py-4 transition-colors"
        >
          Back
        </button>
        <PrimaryButton type="submit" disabled={!values.iin || !values.position}>
          Continue to Face ID
        </PrimaryButton>
      </div>
    </form>
  );
}

// ─── Done ──────────────────────────────────────────────────────────────

function DoneStep({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-4">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className="w-20 h-20 rounded-full bg-gold-500 flex items-center justify-center shadow-lg"
      >
        <svg viewBox="0 0 52 52" className="w-10 h-10 text-ink-900">
          <motion.path
            d="M14 27 l8 8 l16 -18"
            fill="none"
            stroke="currentColor"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </svg>
      </motion.div>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Welcome, {name}!</h2>
        <p className="text-ink-500 text-sm">Setting things up — taking you in…</p>
      </div>
    </div>
  );
}

// ─── Form atoms ────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text' | 'email' | 'tel';
  maxLength?: number;
}

function Field({ label, value, onChange, error, hint, type = 'text', ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-2xl bg-cream-50 border px-4 py-3 text-ink-900 outline-none transition-colors focus:border-gold-500 focus:bg-cream-100 ${
          error ? 'border-rose-300' : 'border-cream-200'
        }`}
        {...rest}
      />
      {error && <span className="block text-xs text-rose-500 mt-1">{error}</span>}
      {!error && hint && <span className="block text-xs text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl bg-cream-50 border border-cream-200 px-4 py-3 text-ink-900 outline-none transition-colors focus:border-gold-500 focus:bg-cream-100 appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
