import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

// `className` fully overrides defaults — pass whatever sizing/padding you need.
export function Card({
  children,
  className = 'max-w-md p-8',
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={
        'w-full bg-cream-100/50 backdrop-blur-2xl border border-white/5 rounded-[36px] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)] ' +
        className
      }
    >
      {children}
    </motion.div>
  );
}
