import { ApiError } from '../../core/error.js';

async function parseErrorBody(
  res: Response
): Promise<{ code: string; message: string } | undefined> {
  try {
    const json = (await res.json()) as { error?: { code: string; message: string } };
    return json?.error;
  } catch {
    return undefined;
  }
}

export function createRequestHelpers(baseUrl: string) {
  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
    return res.json() as Promise<T>;
  }

  async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
    return res.json() as Promise<T>;
  }

  async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
    return res.json() as Promise<T>;
  }

  async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
  }

  return { apiGet, apiPost, apiPut, apiDelete };
}
