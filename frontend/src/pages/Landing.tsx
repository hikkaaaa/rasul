import { Link } from 'react-router-dom';
import { Card } from '../components/Card';

export function Landing() {
  return (
    <Card>
      <div className="flex flex-col items-center text-center gap-6">
        <div className="w-20 h-20 rounded-2xl bg-gold-400 flex items-center justify-center shadow-inner">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-ink-900">
            <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7.5 17c1-1.8 2.8-2.7 4.5-2.7s3.5.9 4.5 2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">FaceID Access</h1>
          <p className="text-ink-500 text-sm leading-relaxed">
            Secure, passwordless sign-in using your face. Quick. Seamless.
          </p>
        </div>

        <div className="w-full flex flex-col gap-3 pt-2">
          <Link
            to="/login"
            className="w-full text-center rounded-2xl bg-gold-400 hover:bg-gold-500 hover:scale-[1.02] active:scale-[0.98] text-ink-900 font-semibold py-4 shadow-md transition-all duration-150"
          >
            Sign in with Face ID
          </Link>
          <Link
            to="/signup"
            className="w-full text-center rounded-2xl bg-cream-100 hover:bg-cream-200 hover:scale-[1.02] active:scale-[0.98] text-ink-900 font-medium py-4 transition-all duration-150"
          >
            Create an account
          </Link>
        </div>
      </div>
    </Card>
  );
}
