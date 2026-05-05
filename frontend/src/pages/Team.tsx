import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  ApiError,
  createInvite,
  listInvites,
  listTeam,
  removeTeamMember,
  revokeInvite,
  type InviteRecord,
  type Role,
  type TeamMember,
} from '../lib/api';
import { clearSession, loadSession } from '../lib/session';

export function Team() {
  const [session] = useState(loadSession);
  const navigate = useNavigate();

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<InviteRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Marketing');
  const [busy, setBusy] = useState(false);
  // The most recently issued invite — surfaced so the owner can copy the
  // link manually (no SMTP wired in dev).
  const [recentLink, setRecentLink] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    let live = true;
    Promise.all([listTeam(session.token), listInvites(session.token)])
      .then(([m, inv]) => {
        if (!live) return;
        setMembers(m);
        setInvites(inv);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) {
          clearSession();
          navigate('/login');
          return;
        }
        if (e instanceof ApiError && e.status === 403) {
          // Non-owners that managed to land here. Bounce them to /profile.
          navigate('/profile', { replace: true });
          return;
        }
        setError(e instanceof Error ? e.message : 'Failed to load team');
      });
    return () => { live = false; };
  }, [session, navigate]);

  if (!session) return <Navigate to="/login" replace />;
  // Owner-only page. Bounce non-owners on the client too — backend still
  // rejects with 403 if they hit the API directly.
  if (!session.user.is_account_owner) return <Navigate to="/profile" replace />;

  const refresh = async () => {
    const [m, inv] = await Promise.all([listTeam(session.token), listInvites(session.token)]);
    setMembers(m);
    setInvites(inv);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createInvite(session.token, { email: inviteEmail, role: inviteRole });
      setRecentLink({ email: created.email, url: created.redemption_url });
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: number) => {
    if (!confirm('Revoke this invite?')) return;
    try {
      await revokeInvite(session.token, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  const handleRemoveMember = async (m: TeamMember) => {
    if (!confirm(`Remove ${m.name} from the team? They'll be signed out and lose access immediately.`)) return;
    try {
      await removeTeamMember(session.token, m.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const pendingInvites = (invites ?? []).filter((i) => !i.revoked && !i.used_at);

  return (
    <Card className="max-w-3xl lg:max-w-5xl p-5 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-5">
        <BackButton to="/profile" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Team Management</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            {session.user.organization_name} · only the account owner can invite teammates
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-rose-500 mb-4">{error}</p>}

      <section className="mb-7">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-500 mb-3">Invite a teammate</h3>
        <form onSubmit={handleInvite} className="grid sm:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <label className="block">
            <span className="block text-xs font-medium text-ink-500 mb-1.5">Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full rounded-2xl bg-cream-50 border border-cream-200 px-4 py-3 text-ink-900 outline-none focus:border-gold-500 focus:bg-cream-100 transition-colors"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-500 mb-1.5">Role</span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="w-full rounded-2xl bg-cream-50 border border-cream-200 px-4 py-3 text-ink-900 outline-none focus:border-gold-500 focus:bg-cream-100 transition-colors"
            >
              <option value="Admin">Admin (Level 1)</option>
              <option value="Accountant">Accountant (Level 2)</option>
              <option value="Marketing">Marketing (Level 3)</option>
            </select>
          </label>
          <div className="sm:pb-0">
            <PrimaryButton type="submit" loading={busy} disabled={busy || !inviteEmail}>
              Send invite
            </PrimaryButton>
          </div>
        </form>

        {recentLink && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 rounded-2xl border border-gold-500/30 bg-gold-500/10 p-4"
          >
            <div className="text-xs font-semibold text-gold-300 uppercase tracking-wider">Invite link for {recentLink.email}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 truncate text-xs text-ink-900 font-mono bg-cream-50 border border-cream-200/40 rounded-lg px-3 py-2">
                {recentLink.url}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(recentLink.url)}
                className="rounded-lg bg-cream-100 hover:bg-cream-200/40 text-ink-900 text-xs font-semibold px-3 py-2 transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-500">Share this link manually — no email is sent automatically.</p>
          </motion.div>
        )}
      </section>

      <section className="mb-7">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-500 mb-3">
          Members {members && <span className="text-ink-500/60 font-medium">· {members.length}</span>}
        </h3>
        {members === null && <p className="text-sm text-ink-500">Loading…</p>}
        <div className="space-y-2">
          {members?.map((m) => (
            <div key={m.id} className="bg-cream-100/60 border border-cream-200/40 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gold-500 text-ink-900 font-bold flex items-center justify-center shrink-0">
                {m.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-ink-900 truncate">{m.name}</span>
                  {m.is_account_owner && (
                    <span className="rounded-full bg-gold-500 text-ink-900 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">Owner</span>
                  )}
                  {!m.has_face && (
                    <span className="rounded-full bg-cream-200/60 text-ink-500 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5">No face yet</span>
                  )}
                </div>
                <div className="text-xs text-ink-500 truncate">
                  {m.email} · {m.role}{m.position ? ` · ${m.position}` : ''}
                </div>
              </div>
              {!m.is_account_owner && (
                <button
                  onClick={() => handleRemoveMember(m)}
                  className="shrink-0 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold px-3 py-2 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-500 mb-3">
          Pending invites {pendingInvites.length > 0 && <span className="text-ink-500/60 font-medium">· {pendingInvites.length}</span>}
        </h3>
        {invites === null && <p className="text-sm text-ink-500">Loading…</p>}
        {invites !== null && pendingInvites.length === 0 && (
          <p className="text-sm text-ink-500">No pending invites.</p>
        )}
        <div className="space-y-2">
          {pendingInvites.map((i) => (
            <div key={i.id} className="bg-cream-100/40 border border-cream-200/40 rounded-2xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink-900 truncate">{i.email}</div>
                <div className="text-xs text-ink-500 truncate">
                  {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => navigator.clipboard?.writeText(i.redemption_url)}
                className="rounded-xl bg-cream-100 hover:bg-cream-200/40 text-ink-900 text-xs font-semibold px-3 py-2 transition-colors"
              >
                Copy link
              </button>
              <button
                onClick={() => handleRevoke(i.id)}
                className="rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold px-3 py-2 transition-colors"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>
    </Card>
  );
}
