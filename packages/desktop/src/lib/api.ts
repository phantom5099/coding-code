import { ApiError } from '@codingcode/core/core/error';

export const API_BASE = `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort')}`;

export { ApiError };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as
      | { code: string; message: string }
      | undefined;
    throw new ApiError(res.status, path, body);
  }
  return res.json() as Promise<T>;
}
