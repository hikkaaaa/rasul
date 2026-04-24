import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  FaceScanner,
  type FaceScannerHandle,
  type PromptDirection,
  type ScannerPhase,
} from '../components/FaceScanner';
import { ApiError, signup, validateChallenge, type Challenge, type FrameCapture } from '../lib/api';

type Step = 'form' | 'scan' | 'done';

interface FormValues {
  name: string;
  email: string;
  iin: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Register() {
  const [step, setStep] = useState<Step>('form');
  const [values, setValues] = useState<FormValues>({ name: '', email: '', iin: '' });
  const [errors, setErrors] = useState<Partial<FormValues>>({});

  const validate = (): boolean => {
    const next: Partial<FormValues> = {};
    if (values.name.trim().length < 2) next.name = 'Enter your full name';
    if (!EMAIL_RE.test(values.email)) next.email = 'Enter a valid email';
    if (!/^\d{12}$/.test(values.iin)) next.iin = 'IIN must be 12 digits';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <AnimatePresence mode="wait">
      {step === 'form' && (
        <motion.div
          key="form"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <FormStep
            values={values}
            errors={errors}
            onChange={(field, v) => setValues((s) => ({ ...s, [field]: v }))}
            onNext={() => validate() && setStep('scan')}
          />
        </motion.div>
      )}

      {step === 'scan' && (
        <motion.div
          key="scan"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <ScanStep values={values} onBack={() => setStep('form')} onDone={() => setStep('done')} />
        </motion.div>
      )}

      {step === 'done' && (
        <motion.div
          key="done"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <DoneStep name={values.name} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Step 1: form ──────────────────────────────────────────────────────────

interface FormStepProps {
  values: FormValues;
  errors: Partial<FormValues>;
  onChange: (field: keyof FormValues, v: string) => void;
  onNext: () => void;
}

function FormStep({ values, errors, onChange, onNext }: FormStepProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-6">
        <BackButton to="/" />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Set up Face ID</h2>
      </div>
      <p className="text-ink-500 text-sm mb-6">
        A few quick details, then we&apos;ll scan your face.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onNext();
        }}
        className="space-y-4"
      >
        <Field label="Full name" value={values.name} onChange={(v) => onChange('name', v)} error={errors.name} autoComplete="name" />
        <Field label="Email" type="email" value={values.email} onChange={(v) => onChange('email', v)} error={errors.email} autoComplete="email" />
        <Field
          label="IIN"
          value={values.iin}
          onChange={(v) => onChange('iin', v.replace(/\D/g, '').slice(0, 12))}
          error={errors.iin}
          inputMode="numeric"
          maxLength={12}
          autoComplete="off"
        />
        
        <label className="flex items-start gap-3 mt-4 group cursor-pointer pr-4">
          <div className="relative flex items-center justify-center mt-0.5">
            <input 
              type="checkbox" 
              className="peer sr-only" 
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <div className="w-5 h-5 rounded border border-cream-200/50 bg-cream-50 transition-all peer-checked:bg-gold-500 peer-checked:border-gold-500 group-hover:border-gold-500/50 flex items-center justify-center">
              <svg 
                className={`w-3.5 h-3.5 text-[#000000] transition-transform ${confirmed ? 'scale-100' : 'scale-0'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <span className="text-sm font-medium text-ink-500 group-hover:text-ink-400 transition-colors leading-snug">
            I confirm that all the information provided is true and accurate.
          </span>
        </label>

        <div className="pt-4">
          <PrimaryButton 
            type="submit" 
            disabled={!confirmed || values.name.trim() === '' || values.email.trim() === '' || values.iin.trim() === ''}
          >
            Continue
          </PrimaryButton>
        </div>
      </form>
    </Card>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
}

function Field({ label, value, onChange, error, type = 'text', ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <input
        type={type}
        name={rest.name || label.toLowerCase().replace(/\s+/g, '-')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-2xl bg-cream-50 border px-4 py-3 text-ink-900 outline-none transition-colors focus:border-gold-500 focus:bg-cream-100 ${
          error ? 'border-rose-300' : 'border-cream-200'
        }`}
        {...rest}
      />
      {error && <span className="block text-xs text-rose-500 mt-1">{error}</span>}
    </label>
  );
}

// ─── Step 2: liveness scan ─────────────────────────────────────────────────

interface ScanStepProps {
  values: FormValues;
  onBack: () => void;
  onDone: () => void;
}

interface ChallengeStep {
  challenge: Challenge;
  prompt?: PromptDirection;
  instruction: string;
}

function buildSequence(): ChallengeStep[] {
  // Neutral always first. Randomize the specific L/R and U/D asks so an
  // attacker can't pre-record a fixed script of photos.
  const horizontal: ChallengeStep = Math.random() < 0.5
    ? { challenge: 'turn_left', prompt: 'left', instruction: 'Turn your head to the LEFT' }
    : { challenge: 'turn_right', prompt: 'right', instruction: 'Turn your head to the RIGHT' };
  const vertical: ChallengeStep = Math.random() < 0.5
    ? { challenge: 'look_up', prompt: 'up', instruction: 'Look UP' }
    : { challenge: 'look_down', prompt: 'down', instruction: 'Look DOWN' };
  return [
    { challenge: 'neutral', instruction: 'Look straight at the camera' },
    horizontal,
    vertical,
    { challenge: 'smile', prompt: 'smile', instruction: 'Smile or open your mouth' },
  ];
}

type ScanStatus = 'scanning_pose' | 'uploading' | 'success' | 'error';

function ScanStep({ values, onBack, onDone }: ScanStepProps) {
  const scannerRef = useRef<FaceScannerHandle>(null);
  const [sequence] = useState<ChallengeStep[]>(() => buildSequence());
  const [cursor, setCursor] = useState(0);
  const [state, setState] = useState<ScanStatus>('scanning_pose');
  const [frames, setFrames] = useState<FrameCapture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [neutralEmbedding, setNeutralEmbedding] = useState<number[] | null>(null);

  const current = sequence[cursor];
  const isLast = cursor === sequence.length - 1;

  const scannerPhase: ScannerPhase =
    state === 'success' ? 'success'
    : state === 'error' ? 'error'
    : state === 'uploading' ? 'scanning'
    : 'scanning';

  const statusText =
    state === 'uploading' ? 'Verifying your identity…'
    : state === 'success' ? 'Face ID set up'
    : state === 'error' ? 'Could not complete scan'
    : current.instruction;

  useEffect(() => {
    if (state !== 'scanning_pose') return;

    let mounted = true;
    let timeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!mounted) return;
      
      const image = scannerRef.current?.capture();
      if (!image) {
        // Webcam might not be loaded yet
        timeout = setTimeout(poll, 500);
        return;
      }

      try {
        const response = await validateChallenge({
          challenge: current.challenge,
          image,
          neutral_embedding: neutralEmbedding,
        });

        if (!mounted) return;

        if (response.status === 'success') {
           setError(null);
           
           if (current.challenge === 'neutral' && response.embedding) {
               setNeutralEmbedding(response.embedding);
           }
           
           const capturedFrames = [...frames, { challenge: current.challenge, image }];
           setFrames(capturedFrames);
           
           if (!isLast) {
               setCursor(c => c + 1);
               // Small delay so user notices success before the next prompt starts
               timeout = setTimeout(poll, 600);
               return;
           } else {
               setState('uploading');
               try {
                   await signup({
                       name: values.name,
                       email: values.email,
                       iin: values.iin,
                       frames: capturedFrames,
                   });
                   setState('success');
                   setTimeout(onDone, 1200);
               } catch (e) {
                   setState('error');
                   setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
               }
           }
           return;
        } else {
           setError(response.message);
        }
      } catch (e) {
         setError(e instanceof ApiError ? e.message : 'Network error or webcam issue.');
      }

      if (mounted && state === 'scanning_pose') {
         timeout = setTimeout(poll, 400); 
      }
    };

    poll();

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [state, cursor, current, frames, isLast, neutralEmbedding, values, onDone]);

  const retrySequence = () => {
    setCursor(0);
    setFrames([]);
    setNeutralEmbedding(null);
    setState('scanning_pose');
    setError(null);
  };

  return (
    <Card className="max-w-lg lg:max-w-5xl p-5 sm:p-6 lg:p-7">
      <div className="flex items-center gap-3 mb-5">
        <BackButton onClick={onBack} />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Face Scanning</h2>
      </div>

      <ProgressDots total={sequence.length} completed={frames.length} />

      <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-8 lg:items-center mt-4">
        <FaceScanner
          ref={scannerRef}
          phase={scannerPhase}
          status={statusText}
          prompt={state === 'scanning_pose' ? current.prompt : undefined}
        />

        <div className="mt-6 lg:mt-0 flex flex-col gap-4 lg:text-center">
          <div className="hidden lg:block space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-600">
              Step {cursor + 1} of {sequence.length}
            </p>
            <h3 className="text-xl font-extrabold tracking-tight text-ink-900">
              {state === 'uploading'
                ? 'Verifying…'
                : state === 'success'
                ? 'All done'
                : current.instruction}
            </h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              {state === 'uploading'
                ? 'Checking liveness and creating your account.'
                : state === 'error'
                ? 'Try the sequence again.'
                : 'Simply hold the pose. The system will automatically capture when ready.'}
            </p>
          </div>

          <div className="h-8 flex items-center justify-center">
            {error && state !== 'error' && (
               <p className={`text-sm font-medium animate-pulse text-center ${error.toLowerCase().includes('no face detected') ? 'text-rose-500' : 'text-gold-400'}`}>{error}</p>
            )}
            {error && state === 'error' && (
               <p className="text-sm font-medium text-rose-500 text-center">{error}</p>
            )}
          </div>

          <div className="lg:mx-auto lg:w-full lg:max-w-xs">
            {state === 'error' && (
              <PrimaryButton onClick={retrySequence}>
                Restart sequence
              </PrimaryButton>
            )}
            {state === 'uploading' && (
              <PrimaryButton loading disabled>
                Creating Account...
              </PrimaryButton>
            )}
            {state === 'success' && (
              <PrimaryButton disabled>
                Done
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProgressDots({ total, completed }: { total: number; completed: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full transition-colors ${
            i < completed ? 'bg-gold-500' : 'bg-cream-200'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Step 3: success ───────────────────────────────────────────────────────

function DoneStep({ name }: { name: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => navigate('/login'), 1800);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <Card>
      <div className="flex flex-col items-center text-center gap-5 py-4">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          className="w-20 h-20 rounded-full bg-gold-400 flex items-center justify-center shadow-lg"
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
          <p className="text-ink-500 text-sm">
            Your Face ID is ready. Redirecting you to sign in…
          </p>
        </div>
      </div>
    </Card>
  );
}
