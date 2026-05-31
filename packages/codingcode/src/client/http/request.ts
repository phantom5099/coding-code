export function createRequestHelpers(baseUrl: string) {
  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiPut<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  }

  return { apiGet, apiPost, apiPut, apiDelete };
}
