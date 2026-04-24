export interface UserProfile {
  name: string;
  email: string;
  iin: string;
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

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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

export function signup(input: SignupInput) {
  return request<{ status: string; message: string }>('/api/signup', input);
}

export function login(image: string) {
  return request<{ status: string; user: UserProfile }>('/api/login', { image });
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
  return request<ValidateChallengeResponse>('/api/validate-challenge', input);
}
