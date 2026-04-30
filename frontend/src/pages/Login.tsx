import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { FaceScanner, type FaceScannerHandle, type ScannerPhase } from '../components/FaceScanner';
import { ApiError, fetchMe, login } from '../lib/api';
import { saveSession } from '../lib/session';

type Step = 'identify' | 'scan';

export function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [direction, setDirection] = useState<1 | -1>(1);

  const advance = () => { setDirection(1); setStep('scan'); };
  const goBack = () => { setDirection(-1); setStep('identify'); };

  return (
    <Card className="max-w-lg lg:max-w-5xl p-5 sm:p-6 lg:p-7">
      <div className="flex items-center gap-3 mb-5">
        <BackButton to="/" />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
          {step === 'identify' ? 'Sign in' : 'Face Verification'}
        </h2>
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          {step === 'identify' && (
            <motion.div
              key="identify"
              initial={{ opacity: 0, x: 32 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 * direction }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <IdentifyStep
                value={identifier}
                onChange={setIdentifier}
                onSubmit={advance}
              />
            </motion.div>
          )}
          {step === 'scan' && (
            <motion.div
              key="scan"
              initial={{ opacity: 0, x: 32 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 * direction }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <ScanStep
                identifier={identifier}
                onBack={goBack}
                onSuccess={() => navigate('/profile')}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

// ─── Step 1: identify ───────────────────────────────────────────────────

interface IdentifyStepProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

function IdentifyStep({ value, onChange, onSubmit }: IdentifyStepProps) {
  const trimmed = value.trim();
  const looksLikeIin = /^\d+$/.test(trimmed);
  // Only enable the button once the user has typed something plausible —
  // an email-shaped string OR a 12-digit number. We don't pre-validate
  // strictly because the backend disambiguates and returns the same
  // generic "doesn't match this account" either way.
  const valid = trimmed.length > 0 && (
    !looksLikeIin || trimmed.length === 12
  );

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(); }}
      className="space-y-5 max-w-md mx-auto"
    >
      <p className="text-ink-500 text-sm">
        Enter your email or 12-digit IIN. We'll then verify your face against that account.
      </p>

      <label className="block">
        <span className="block text-xs font-medium text-ink-500 mb-1.5">Email or IIN</span>
        <input
          type="text"
          autoFocus
          autoComplete="username"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ainur@faceid.app or 010101000001"
          className="w-full rounded-2xl bg-cream-50 border border-cream-200 px-4 py-3 text-ink-900 outline-none transition-colors focus:border-gold-500 focus:bg-cream-100"
        />
      </label>

      <PrimaryButton type="submit" disabled={!valid}>
        Continue
      </PrimaryButton>

      <p className="text-xs text-ink-500 text-center">
        First time here? <a href="/signup" className="text-gold-300 hover:text-gold-400 font-semibold">Create an account</a>.
      </p>
    </form>
  );
}

// ─── Step 2: face scan ─────────────────────────────────────────────────

interface ScanStepProps {
  identifier: string;
  onBack: () => void;
  onSuccess: () => void;
}

function ScanStep({ identifier, onBack, onSuccess }: ScanStepProps) {
  const scannerRef = useRef<FaceScannerHandle>(null);
  const [phase, setPhase] = useState<ScannerPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Look into the camera');
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setError(null);
    const image = scannerRef.current?.capture();
    if (!image) {
      setError('Camera not ready — please allow access and try again.');
      return;
    }

    setPhase('scanning');
    setStatus('Verifying your face…');
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, (elapsed / 2000) * 95));
    }, 60);

    try {
      const { user, token } = await login(identifier, image);
      clearInterval(tick);
      setProgress(100);
      setPhase('success');
      setStatus('Welcome back');
      const me = await fetchMe(token);
      saveSession({ user, token, permissions: me.permissions });
      setTimeout(onSuccess, 800);
    } catch (e) {
      clearInterval(tick);
      setPhase('error');
      setProgress(0);
      setStatus('Face does not match');
      if (e instanceof ApiError) {
        setError(
          e.status === 429
            ? 'Too many attempts. Take a breath and try again in a moment.'
            : e.message,
        );
      } else {
        setError('Something went wrong. Try again.');
      }
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setStatus('Tap to scan'), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-8 lg:items-center">
      <FaceScanner
        ref={scannerRef}
        phase={phase}
        status={status}
        progress={phase === 'scanning' ? progress : undefined}
      />

      <div className="mt-6 lg:mt-0 flex flex-col gap-4 lg:text-center">
        <div className="hidden lg:block space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">
            Verifying
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-ink-900 break-all">
            {identifier}
          </h3>
          <p className="text-sm text-ink-500 leading-relaxed">
            We'll match your face only against this account — no global search.
          </p>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-sm text-rose-500 text-center"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="lg:mx-auto lg:w-full lg:max-w-xs flex flex-col gap-3">
          <PrimaryButton
            onClick={runScan}
            loading={phase === 'scanning'}
            disabled={phase === 'success'}
          >
            {phase === 'error' ? 'Try again' : 'Scan to sign in'}
          </PrimaryButton>
          <button
            type="button"
            onClick={onBack}
            disabled={phase === 'scanning' || phase === 'success'}
            className="rounded-2xl bg-cream-100 hover:bg-cream-200/40 border border-cream-200/40 text-ink-900 font-medium py-3 transition-colors disabled:opacity-50"
          >
            Use a different account
          </button>
        </div>
      </div>
    </div>
  );
}
