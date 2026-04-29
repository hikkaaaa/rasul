export type Role = 'Admin' | 'Accountant' | 'Marketing';

export interface UserProfile {
  name: string;
  email: string;
  iin: string;
  role: Role;
}

export interface AuthSession {
  user: UserProfile;
  token: string;
  // Filled in after /api/me. The frontend uses these flags to hide buttons
  // the user can't use; the backend independently rejects unauthorized calls.
  permissions: Record<string, boolean>;
}

export type Challenge =
  | 'neutral'
  | 'turn_left'
  | 'turn_right'
  | 'look_up'
  | 'look_down'
  | 'smile';

export interface FrameCapture {
  challenge: Challenge;
  image: string;
}

export interface SignupInput {
  name: string;
  email: string;
  iin: string;
  frames: FrameCapture[];
}

export interface ClientRecord {
  id: number;
  full_name: string;
  address: string;
  phone: string;
  // null when the caller's role can't view credit card data and no card exists
  credit_card: string | null;
  credit_card_masked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientDraft {
  full_name: string;
  address?: string;
  phone?: string;
  credit_card?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'POST', body, token } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    // No content — caller likely doesn't care about a return shape.
    return undefined as T;
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string') detail = payload.detail;
      else if (Array.isArray(payload?.detail)) {
        detail = payload.detail.map((e: { msg: string }) => e.msg).join(', ');
      }
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export function signup(input: SignupInput) {
  return request<{ status: string; message: string; role: Role | null }>('/api/signup', { body: input });
}

export function login(image: string) {
  return request<{ status: string; user: UserProfile; token: string }>('/api/login', { body: { image } });
}

export function logout(token: string) {
  return request<void>('/api/logout', { token });
}

export function fetchMe(token: string) {
  return request<{ user: UserProfile; permissions: Record<string, boolean> }>(
    '/api/me',
    { method: 'GET', token },
  );
}

export interface ValidateChallengeInput {
  challenge: Challenge;
  image: string;
  neutral_embedding?: number[] | null;
}

export interface ValidateChallengeResponse {
  status: string;
  message: string;
  embedding?: number[] | null;
}

export function validateChallenge(input: ValidateChallengeInput) {
  return request<ValidateChallengeResponse>('/api/validate-challenge', { body: input });
}

// ─── Clients (RBAC-controlled resource) ───────────────────────────────────

export function listClients(token: string) {
  return request<ClientRecord[]>('/api/clients', { method: 'GET', token });
}

export function createClient(token: string, draft: ClientDraft) {
  return request<ClientRecord>('/api/clients', { method: 'POST', token, body: draft });
}

export function updateClient(token: string, id: number, patch: Partial<ClientDraft>) {
  return request<ClientRecord>(`/api/clients/${id}`, { method: 'PATCH', token, body: patch });
}

export function deleteClient(token: string, id: number) {
  return request<void>(`/api/clients/${id}`, { method: 'DELETE', token });
}
