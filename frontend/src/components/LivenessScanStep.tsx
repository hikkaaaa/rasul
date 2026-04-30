import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PrimaryButton } from './PrimaryButton';
import {
  FaceScanner,
  type FaceScannerHandle,
  type PromptDirection,
  type ScannerPhase,
} from './FaceScanner';
import { ApiError, validateChallenge, type Challenge, type FrameCapture } from '../lib/api';

// Multi-angle liveness sequence: neutral + a randomized horizontal turn +
// a randomized vertical look + a smile. Randomization stops attackers from
// pre-recording a fixed photo strip.

interface ChallengeStep {
  challenge: Challenge;
  prompt?: PromptDirection;
  instruction: string;
}

function buildSequence(): ChallengeStep[] {
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

export interface LivenessResult {
  frames: FrameCapture[];
}

export interface LivenessScanStepProps {
  onBack: () => void;
  // Called once all 4 frames are captured. Throw an ApiError to surface a
  // backend rejection (duplicate face, wrong pose, etc.) — the component
  // will keep the user on the scan view with a retry button.
  onComplete: (frames: FrameCapture[]) => Promise<void>;
}

type ScanStatus = 'scanning_pose' | 'uploading' | 'success' | 'error';

export function LivenessScanStep({ onBack, onComplete }: LivenessScanStepProps) {
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
    : 'scanning';

  const statusText =
    state === 'uploading' ? 'Verifying your identity…'
    : state === 'success' ? 'Face ID verified'
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
          const captured = [...frames, { challenge: current.challenge, image }];
          setFrames(captured);
          if (!isLast) {
            setCursor((c) => c + 1);
            timeout = setTimeout(poll, 600);
            return;
          }
          setState('uploading');
          try {
            await onComplete(captured);
            setState('success');
          } catch (e) {
            setState('error');
            setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
          }
          return;
        }
        setError(response.message);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Network error or webcam issue.');
      }
      if (mounted && state === 'scanning_pose') {
        timeout = setTimeout(poll, 400);
      }
    };

    poll();
    return () => { mounted = false; clearTimeout(timeout); };
  }, [state, cursor, current, frames, isLast, neutralEmbedding, onComplete]);

  const retry = () => {
    setCursor(0);
    setFrames([]);
    setNeutralEmbedding(null);
    setState('scanning_pose');
    setError(null);
  };

  return (
    <div>
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
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">
              Step {cursor + 1} of {sequence.length}
            </p>
            <h3 className="text-xl font-extrabold tracking-tight text-ink-900">
              {state === 'uploading' ? 'Verifying…' : state === 'success' ? 'All done' : current.instruction}
            </h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              {state === 'uploading'
                ? 'Checking liveness and finalising your account.'
                : state === 'error'
                ? 'Try the sequence again.'
                : 'Hold the pose. The system will capture automatically when ready.'}
            </p>
          </div>

          <div className="h-8 flex items-center justify-center">
            {error && state !== 'error' && (
              <p className={`text-sm font-medium animate-pulse text-center ${error.toLowerCase().includes('no face detected') ? 'text-rose-500' : 'text-gold-300'}`}>{error}</p>
            )}
            {error && state === 'error' && (
              <p className="text-sm font-medium text-rose-500 text-center">{error}</p>
            )}
          </div>

          <div className="lg:mx-auto lg:w-full lg:max-w-xs flex flex-col gap-3">
            {state === 'error' && (
              <PrimaryButton onClick={retry}>Restart sequence</PrimaryButton>
            )}
            {state === 'uploading' && (
              <PrimaryButton loading disabled>Creating Account…</PrimaryButton>
            )}
            {state === 'scanning_pose' && (
              <button
                type="button"
                onClick={onBack}
                className="rounded-2xl bg-cream-100 hover:bg-cream-200/40 border border-cream-200/40 text-ink-900 font-medium py-3 transition-colors"
              >
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
