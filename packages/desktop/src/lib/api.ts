export const API_BASE = `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort')}`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body?: { code: string; message: string }
  ) {
    super(body?.message ?? `HTTP ${status}: ${path}`);
  }
}

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
