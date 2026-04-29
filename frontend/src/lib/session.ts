import type { AuthSession } from './api';

const KEY = 'faceid.session';

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): AuthSession | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
}

// `permissions` is a flat capability map filled in after /api/me. Persisted
// alongside the session so the UI can reload without re-fetching.
export function updatePermissions(permissions: Record<string, boolean>): void {
  const current = loadSession();
  if (!current) return;
  saveSession({ ...current, permissions });
}
