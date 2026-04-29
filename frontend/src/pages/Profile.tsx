import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { clearSession, loadSession } from '../lib/session';
import { logout, type AuthSession } from '../lib/api';

export function Profile() {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    setSession(loadSession());
  }, []);

  if (session === undefined) return null; // initial render, avoid flash
  if (session === null) return <Navigate to="/login" replace />;

  const { user } = session;

  const handleSignOut = async () => {
    // Best-effort revoke on the server. We clear local state regardless so
    // the user is always logged out on this device even if the network call
    // fails (e.g. offline).
    try {
      await logout(session.token);
    } catch { /* ignore */ }
    clearSession();
    navigate('/login');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md space-y-4"
    >
      <div className="bg-cream-100/50 backdrop-blur-2xl border border-white/5 rounded-[32px] p-7 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gold-400 flex items-center justify-center text-xl font-bold text-ink-900">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold tracking-tight text-ink-900 truncate">{user.name}</h2>
            <p className="text-ink-500 text-sm truncate">{user.email}</p>
          </div>
          <RoleBadge role={user.role} />
        </div>
      </div>

      <InfoRow label="Full name" value={user.name} />
      <InfoRow label="Email" value={user.email} />
      <InfoRow label="IIN" value={user.iin} mono />
      <InfoRow label="Role" value={user.role} />

      <Link
        to="/clients"
        className="block w-full text-center rounded-2xl bg-gold-400 hover:bg-gold-500 hover:scale-[1.02] active:scale-[0.98] text-ink-900 font-semibold py-4 shadow-md transition-all duration-150"
      >
        Open clients dashboard
      </Link>

      <button
        onClick={handleSignOut}
        className="w-full rounded-2xl bg-cream-100 hover:bg-cream-200 hover:scale-[1.02] active:scale-[0.98] text-ink-900 font-medium py-4 transition-all duration-150"
      >
        Sign out
      </button>
    </motion.div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-cream-100/40 backdrop-blur-xl border border-white/5 rounded-2xl px-5 py-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.3)]">
      <div className="text-xs font-medium text-ink-500 mb-0.5">{label}</div>
      <div className={`text-ink-900 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'Admin' ? 'bg-gold-400 text-ink-900'
    : role === 'Accountant' ? 'bg-cream-200 text-ink-900'
    : 'bg-cream-100 text-ink-500';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {role}
    </span>
  );
}
