import { useNavigate } from 'react-router-dom';

interface Props {
  to?: string;
  onClick?: () => void;
  className?: string;
}

export function BackButton({ to, onClick, className = '' }: Props) {
  const navigate = useNavigate();
  const handleClick = () => {
    if (onClick) onClick();
    else if (to) navigate(to);
    else navigate(-1);
  };
  return (
    <button
      onClick={handleClick}
      aria-label="Go back"
      className={
        'w-10 h-10 rounded-full bg-cream-100 hover:bg-cream-200 text-ink-900 ' +
        'flex items-center justify-center shadow-sm transition-colors ' +
        className
      }
    >
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path d="M15 18 L9 12 L15 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
