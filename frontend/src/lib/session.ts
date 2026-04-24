import type { UserProfile } from './api';

const KEY = 'faceid.profile';

export function saveProfile(profile: UserProfile): void {
  sessionStorage.setItem(KEY, JSON.stringify(profile));
}

export function loadProfile(): UserProfile | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function clearProfile(): void {
  sessionStorage.removeItem(KEY);
}
