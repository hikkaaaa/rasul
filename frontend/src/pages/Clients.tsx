import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '../components/Card';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  ApiError,
  createClient,
  deleteClient,
  listClients,
  updateClient,
  type ClientDraft,
  type ClientRecord,
} from '../lib/api';
import { clearSession, loadSession } from '../lib/session';

const EMPTY_DRAFT: ClientDraft = { full_name: '', address: '', phone: '', credit_card: '' };

export function Clients() {
  // Load once into state so the reference is stable across renders.
  // Reading loadSession() directly each render produces a new object every
  // time, which made the listClients effect re-fire on every setRows and
  // hammer the backend in a tight loop.
  const [session] = useState(loadSession);
  const navigate = useNavigate();

  const [rows, setRows] = useState<ClientRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; draft: ClientDraft } | null>(null);

  // Permissions come from /api/me — the backend is still the source of truth.
  // We use them only to hide UI affordances the user can't act on.
  const canCreate = session?.permissions?.['clients.create'] ?? false;
  const canUpdate = session?.permissions?.['clients.update'] ?? false;
  const canDelete = session?.permissions?.['clients.delete'] ?? false;
  const canViewCard = session?.permissions?.['clients.view_credit_card'] ?? false;

  useEffect(() => {
    if (!session) return;
    let live = true;
    listClients(session.token)
      .then((data) => { if (live) setRows(data); })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) {
          clearSession();
          navigate('/login');
          return;
        }
        setError(e instanceof Error ? e.message : 'Failed to load clients');
      });
    return () => { live = false; };
  }, [session, navigate]);

  if (!session) return <Navigate to="/login" replace />;

  const refresh = async () => {
    const data = await listClients(session.token);
    setRows(data);
  };

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editing.id === null) {
        await createClient(session.token, editing.draft);
      } else {
        await updateClient(session.token, editing.id, editing.draft);
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this client record? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteClient(session.token, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-3xl lg:max-w-5xl p-5 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-5">
        <BackButton to="/profile" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Clients</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Signed in as <span className="font-semibold">{session.user.name}</span> ·{' '}
            <RoleBadge role={session.user.role} />
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setEditing({ id: null, draft: { ...EMPTY_DRAFT } })}
            className="rounded-2xl bg-gold-400 hover:bg-gold-500 text-ink-900 font-semibold px-4 py-2.5 text-sm shadow-md transition-all"
          >
            + New client
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-rose-500 mb-4">{error}</p>
      )}

      {rows === null && (
        <p className="text-sm text-ink-500">Loading clients…</p>
      )}

      {rows && rows.length === 0 && (
        <p className="text-sm text-ink-500">No clients yet.</p>
      )}

      <div className="space-y-3">
        {rows?.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            canViewCard={canViewCard}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onEdit={() => setEditing({
              id: client.id,
              draft: {
                full_name: client.full_name,
                address: client.address,
                phone: client.phone,
                // If the user can't view the card, don't pre-fill it (and they
                // can't edit anyway since canUpdate also gates the button).
                credit_card: canViewCard ? (client.credit_card ?? '') : '',
              },
            })}
            onDelete={() => handleDelete(client.id)}
          />
        ))}
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
            onClick={() => !busy && setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-cream-50 rounded-[28px] p-6 shadow-2xl"
            >
              <h3 className="text-xl font-extrabold tracking-tight text-ink-900 mb-4">
                {editing.id === null ? 'New client' : 'Edit client'}
              </h3>
              <DraftForm
                draft={editing.draft}
                onChange={(draft) => setEditing({ ...editing, draft })}
              />
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="flex-1 rounded-2xl bg-cream-100 hover:bg-cream-200 text-ink-900 font-medium py-3 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <PrimaryButton
                  onClick={handleSave}
                  disabled={busy || editing.draft.full_name.trim() === ''}
                  loading={busy}
                >
                  Save
                </PrimaryButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

interface RowProps {
  client: ClientRecord;
  canViewCard: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ClientRow({ client, canViewCard, canUpdate, canDelete, onEdit, onDelete }: RowProps) {
  return (
    <div className="bg-cream-100/60 backdrop-blur-xl border border-white/5 rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="font-extrabold text-ink-900 truncate">{client.full_name}</div>
          <div className="text-xs text-ink-500 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <span><span className="text-ink-400">Address: </span>{client.address || '—'}</span>
            <span><span className="text-ink-400">Phone: </span>{client.phone || '—'}</span>
            <span className="sm:col-span-2 font-mono">
              <span className="text-ink-400 font-sans">Card: </span>
              {client.credit_card ? (
                <>
                  {client.credit_card}
                  {client.credit_card_masked && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-400 font-sans">
                      {canViewCard ? '' : 'masked — restricted role'}
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          {/* Buttons are conditionally rendered based on permissions returned
              by /api/me. The backend re-checks on every request. */}
          {canUpdate && (
            <button
              onClick={onEdit}
              className="rounded-xl bg-cream-50 hover:bg-cream-100 text-ink-900 text-xs font-semibold px-3 py-2 transition-colors"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-semibold px-3 py-2 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DraftFormProps {
  draft: ClientDraft;
  onChange: (draft: ClientDraft) => void;
}

function DraftForm({ draft, onChange }: DraftFormProps) {
  const set = (field: keyof ClientDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [field]: e.target.value });

  return (
    <div className="space-y-3">
      <Field label="Full name" value={draft.full_name} onChange={set('full_name')} />
      <Field label="Address" value={draft.address ?? ''} onChange={set('address')} />
      <Field label="Phone" value={draft.phone ?? ''} onChange={set('phone')} />
      <Field label="Credit card" value={draft.credit_card ?? ''} onChange={set('credit_card')} mono />
    </div>
  );
}

function Field({
  label, value, onChange, mono,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-500 mb-1.5">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        className={`w-full rounded-2xl bg-cream-100 border border-cream-200 px-4 py-3 text-ink-900 outline-none focus:border-gold-500 focus:bg-cream-50 transition-colors ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'Admin' ? 'bg-gold-400 text-ink-900'
    : role === 'Accountant' ? 'bg-cream-200 text-ink-900'
    : 'bg-cream-100 text-ink-500';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {role}
    </span>
  );
}
