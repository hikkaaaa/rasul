import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { clearProfile, loadProfile } from '../lib/session';
import type { UserProfile } from '../lib/api';

export function Profile() {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  if (profile === undefined) return null; // initial render, avoid flash
  if (profile === null) return <Navigate to="/login" replace />;

  const handleSignOut = () => {
    clearProfile();
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
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight text-ink-900 truncate">{profile.name}</h2>
            <p className="text-ink-500 text-sm truncate">{profile.email}</p>
          </div>
        </div>
      </div>

      <InfoRow label="Full name" value={profile.name} />
      <InfoRow label="Email" value={profile.email} />
      <InfoRow label="IIN" value={profile.iin} mono />

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
