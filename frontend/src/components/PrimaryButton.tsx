import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
}

export function PrimaryButton({ children, loading, disabled, className = '', ...rest }: Props) {
  const isDisabled = Boolean(disabled || loading);
  return (
    <button
      {...rest}
      translate="no"
      disabled={isDisabled}
      className={
        'w-full rounded-2xl bg-gold-400 hover:bg-gold-500 hover:scale-[1.02] ' +
        'active:scale-[0.98] disabled:!bg-cream-100/50 disabled:!text-ink-500/50 disabled:hover:scale-100 ' +
        'disabled:cursor-not-allowed disabled:shadow-none text-ink-900 font-semibold py-4 text-base ' +
        'shadow-md transition-all duration-150 ' +
        className
      }
    >
      {loading ? 'Working…' : children}
    </button>
  );
}
