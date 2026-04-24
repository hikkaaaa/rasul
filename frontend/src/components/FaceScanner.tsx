import { useCallback, useImperativeHandle, useRef, forwardRef } from 'react';
import Webcam from 'react-webcam';
import { AnimatePresence, motion } from 'framer-motion';

export type ScannerPhase = 'idle' | 'scanning' | 'success' | 'error';

export type PromptDirection = 'left' | 'right' | 'up' | 'down' | 'smile';

export interface FaceScannerHandle {
  capture: () => string | null;
}

interface Props {
  phase: ScannerPhase;
  status?: string;
  /** 0–100 while scanning; hides the number when undefined */
  progress?: number;
  /** Directional challenge prompt shown inside the circle */
  prompt?: PromptDirection;
}

const videoConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
} as const;

export const FaceScanner = forwardRef<FaceScannerHandle, Props>(function FaceScanner(
  { phase, status, progress, prompt },
  ref,
) {
  const webcamRef = useRef<Webcam>(null);

  const capture = useCallback((): string | null => {
    return webcamRef.current?.getScreenshot() ?? null;
  }, []);

  useImperativeHandle(ref, () => ({ capture }), [capture]);

  const ringColor =
    phase === 'success' ? 'ring-emerald-400'
    : phase === 'error' ? 'ring-rose-400'
    : prompt ? 'ring-white'
    : 'ring-white';

  return (
    <div className="relative w-full aspect-[3/4] lg:aspect-square rounded-[36px] overflow-hidden bg-gold-400 shadow-xl flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6 pt-8 pb-4">
        <div
          className={`relative w-[82%] max-w-[520px] aspect-square rounded-full overflow-hidden ring-4 ${ringColor} shadow-[0_0_0_12px_rgba(255,255,255,0.2)]`}
        >
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.92}
            videoConstraints={videoConstraints}
            mirrored
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Prompt arrow + label (signup challenges) */}
          <AnimatePresence mode="wait">
            {prompt && phase !== 'success' && (
              <motion.div
                key={prompt}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px] pointer-events-none"
              >
                <PromptIcon kind={prompt} />
              </motion.div>
            )}
          </AnimatePresence>


          {/* Sweeping scan line */}
          <AnimatePresence>
            {phase === 'scanning' && !prompt && (
              <motion.div
                key="scanline"
                initial={{ y: '-100%', opacity: 0 }}
                animate={{ y: '100%', opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-white/80 to-transparent pointer-events-none"
              />
            )}
          </AnimatePresence>

          {/* Pulsing outer ring */}
          <AnimatePresence>
            {phase === 'scanning' && !prompt && (
              <motion.div
                key="pulse"
                initial={{ opacity: 0, scale: 1 }}
                animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.08, 1] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -inset-2 rounded-full ring-4 ring-white pointer-events-none"
              />
            )}
          </AnimatePresence>

          {/* Success checkmark */}
          <AnimatePresence>
            {phase === 'success' && (
              <motion.div
                key="check"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                className="absolute inset-0 flex items-center justify-center bg-emerald-500/40 backdrop-blur-[2px]"
              >
                <svg viewBox="0 0 52 52" className="w-28 h-28 text-white">
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
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="px-6 pb-7 pt-2 flex flex-col items-center text-center gap-1.5">
        {progress !== undefined && phase === 'scanning' ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-extrabold text-ink-900 tabular-nums tracking-tight leading-none"
          >
            {Math.round(progress)}%
          </motion.div>
        ) : null}
        {status && (
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[15px] font-semibold text-ink-900/85 tracking-tight"
          >
            {status}
          </motion.p>
        )}
      </div>
    </div>
  );
});

function PromptIcon({ kind }: { kind: PromptDirection }) {
  const common = 'w-28 h-28 text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]';

  if (kind === 'smile') {
    return (
      <motion.svg
        viewBox="0 0 64 64"
        className={common}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="3.5" />
        <circle cx="24" cy="27" r="2.5" fill="currentColor" />
        <circle cx="40" cy="27" r="2.5" fill="currentColor" />
        <path
          d="M20 38 Q 32 50 44 38"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </motion.svg>
    );
  }

  const rotation: Record<Exclude<PromptDirection, 'smile'>, number> = {
    left: 180,
    right: 0,
    up: -90,
    down: 90,
  };

  return (
    <motion.svg
      viewBox="0 0 64 64"
      className={common}
      style={{ rotate: rotation[kind] }}
      animate={{ scale: [1, 1.12, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
    >
      <path
        d="M12 32 L48 32 M36 20 L52 32 L36 44"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}
