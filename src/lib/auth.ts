/**
 * Page-scoped authentication for the private operator app.
 *
 * The password is deliberately kept in a module variable only. A full page
 * reload creates a new JavaScript context, so the gate appears again. API
 * requests carry it over HTTPS in a same-origin header; it is never persisted
 * in localStorage, a cookie, the URL, or the frontend bundle.
 */
let sessionPassword: string | null = null;

export function setSessionPassword(password: string) {
  sessionPassword = password;
}

export function clearSessionPassword() {
  sessionPassword = null;
}

export function authHeaders(): Record<string, string> {
  return sessionPassword ? { 'x-sf-password': sessionPassword } : {};
}

export async function fetchAuthStatus(signal?: AbortSignal): Promise<{ configured: boolean }> {
  const response = await fetch('/api/auth', {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Passwortschutz konnte nicht geprüft werden.');
  return { configured: Boolean(data.configured) };
}

export async function verifyPassword(password: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Passwort ist falsch.');
  setSessionPassword(password);
}
