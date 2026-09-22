import { timingSafeEqual } from 'node:crypto';

/**
 * Optional deployment password. It intentionally lives only on the server:
 * never expose SHORTSFACTORY_PASSWORD through a VITE_ variable.
 */
export function configuredPassword() {
  return process.env.SHORTSFACTORY_PASSWORD?.trim() || '';
}

export function passwordMatches(candidate) {
  const expected = configuredPassword();
  if (!expected || typeof candidate !== 'string') return !expected;
  const actual = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * Protect same-origin API routes with the in-memory password held by the app.
 * A page reload clears that client memory, so the gate asks for the password
 * again. No password is stored in localStorage, cookies, URLs, or responses.
 */
export function requirePassword(req, res) {
  const expected = configuredPassword();
  if (!expected) return true;

  const provided = req?.headers?.['x-sf-password'];
  if (passwordMatches(typeof provided === 'string' ? provided : '')) return true;

  res.status(401).json({
    error: 'Passwort erforderlich oder falsch.',
    code: 'auth_required',
  });
  return false;
}
