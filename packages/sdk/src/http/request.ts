import { ApiError } from '../error.js';

/** 服务端错误统一信封是 `{ error: { code, message } }`（见 server/util.ts 的 errorResponse）。 */
export async function parseErrorBody(
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
  async function unwrap<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
    return res.json() as Promise<T>;
  }

  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    return unwrap<T>(res, path);
  }

  async function withBody<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return unwrap<T>(res, path);
  }

  async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    return withBody<T>('POST', path, body);
  }

  async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    return withBody<T>('PUT', path, body);
  }

  async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
    return withBody<T>('PATCH', path, body);
  }

  async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new ApiError(res.status, path, await parseErrorBody(res));
  }

  return { apiGet, apiPost, apiPut, apiPatch, apiDelete };
}
