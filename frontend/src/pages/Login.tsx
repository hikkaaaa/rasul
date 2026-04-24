import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { FaceScanner, type FaceScannerHandle, type ScannerPhase } from '../components/FaceScanner';
import { ApiError, login } from '../lib/api';
import { saveProfile } from '../lib/session';

export function Login() {
  const navigate = useNavigate();
  const scannerRef = useRef<FaceScannerHandle>(null);
  const [phase, setPhase] = useState<ScannerPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Look into the camera');
  const [error, setError] = useState<string | null>(null);

  // Auto-start scanning once the user interacts via the button.
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
      const { user } = await login(image);
      clearInterval(tick);
      setProgress(100);
      setPhase('success');
      setStatus('Welcome back');
      saveProfile(user);
      setTimeout(() => navigate('/profile'), 800);
    } catch (e) {
      clearInterval(tick);
      setPhase('error');
      setProgress(0);
      setStatus('Face not recognized');
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

  // Give the webcam a moment to initialize before the first hint flips.
  useEffect(() => {
    const t = setTimeout(() => setStatus('Tap to scan'), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <Card className="max-w-lg lg:max-w-5xl p-5 sm:p-6 lg:p-7">
      <div className="flex items-center gap-3 mb-5">
        <BackButton to="/" />
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Face Scanning</h2>
      </div>

      <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-8 lg:items-center">
        <FaceScanner
          ref={scannerRef}
          phase={phase}
          status={status}
          progress={phase === 'scanning' ? progress : undefined}
        />

        <div className="mt-6 lg:mt-0 flex flex-col gap-4 lg:text-center">
          <div className="hidden lg:block space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-600">
              Sign in
            </p>
            <h3 className="text-xl font-extrabold tracking-tight text-ink-900">
              Look into the camera
            </h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              We&apos;ll match your face against your registered profile. No password needed.
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

          <div className="lg:mx-auto lg:w-full lg:max-w-xs">
            <PrimaryButton
              onClick={runScan}
              loading={phase === 'scanning'}
              disabled={phase === 'success'}
            >
              {phase === 'error' ? 'Try again' : 'Scan to sign in'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
