export const API_BASE =
  `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort')}`

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json() as Promise<T>
}
