export type Role = 'Admin' | 'Accountant' | 'Marketing';

export type Position = 'Owner' | 'Manager' | 'Staff';

export interface UserProfile {
  name: string;
  email: string;
  iin: string;
  role: Role;
  organization_id: number;
  organization_name: string;
  is_account_owner: boolean;
  position: string | null;
}

export interface AuthSession {
  user: UserProfile;
  token: string;
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

export interface RegisterCheckInput {
  name: string;
  email: string;
  password: string;
  company_name: string;
}

export type RegisterCheckStatus = 'ok' | 'claim' | 'conflict_email' | 'conflict_company';

export interface RegisterCheckResponse {
  status: RegisterCheckStatus;
  message: string;
  organization_name: string | null;
  role: Role | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  company_name: string;
  phone: string;
  iin: string;
  position: Position;
  frames: FrameCapture[];
  invite_token?: string | null;
}

export interface RegisterResponse {
  status: string;
  message: string;
  role: Role;
  is_account_owner: boolean;
  token: string;
  user: UserProfile;
}

export interface ClientRecord {
  id: number;
  full_name: string;
  address: string;
  phone: string;
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

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: Role;
  position: string | null;
  is_account_owner: boolean;
  has_face: boolean;
  created_at: string;
}

export interface InviteRecord {
  id: number;
  email: string;
  role: Role;
  expires_at: string;
  used_at: string | null;
  revoked: boolean;
  redemption_url: string;
  created_at: string;
}

export interface InvitePreview {
  email: string;
  role: Role;
  organization_name: string;
  expires_at: string;
  valid: boolean;
  reason: string | null;
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

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string') detail = payload.detail;
      else if (Array.isArray(payload?.detail)) {
        detail = payload.detail.map((e: { msg: string }) => e.msg).join(', ');
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export function registerCheck(input: RegisterCheckInput) {
  return request<RegisterCheckResponse>('/api/register/check', { body: input });
}

export function register(input: RegisterInput) {
  return request<RegisterResponse>('/api/register', { body: input });
}

export function login(identifier: string, image: string) {
  // 1:1 verification — backend looks up the user by identifier (email or
  // 12-digit IIN), then compares the live image only against that user's
  // stored face vector.
  return request<{ status: string; user: UserProfile; token: string }>(
    '/api/login',
    { body: { identifier, image } },
  );
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

// ─── Clients ──────────────────────────────────────────────────────────────

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

// ─── Team & invites ──────────────────────────────────────────────────────

export function listTeam(token: string) {
  return request<TeamMember[]>('/api/team', { method: 'GET', token });
}

export function removeTeamMember(token: string, id: number) {
  return request<void>(`/api/team/${id}`, { method: 'DELETE', token });
}

export function listInvites(token: string) {
  return request<InviteRecord[]>('/api/invites', { method: 'GET', token });
}

export function createInvite(token: string, body: { email: string; role: Role }) {
  return request<InviteRecord>('/api/invites', { method: 'POST', token, body });
}

export function revokeInvite(token: string, id: number) {
  return request<void>(`/api/invites/${id}`, { method: 'DELETE', token });
}

export function previewInvite(inviteToken: string) {
  return request<InvitePreview>(`/api/invites/${inviteToken}/preview`, { method: 'GET' });
}
