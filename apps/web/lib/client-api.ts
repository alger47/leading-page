/**
 * API fetch wrapper for the browser. Reads the double-submit CSRF cookie and
 * sends it as a header on mutating requests (server enforces the pair).
 */

export function csrfToken(): string {
  return document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('csrf='))
    ?.slice(5) ?? '';
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.method && init.method.toUpperCase() !== 'GET') {
    const token = csrfToken();
    if (token) headers.set('x-csrf-token', token);
  }
  const res = await fetch(path, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as T };
}