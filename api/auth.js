import { configuredPassword, passwordMatches } from '../shared/auth.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = configuredPassword();
  if (req.method === 'GET') {
    // This reveals only whether the operator deliberately enabled the gate.
    return res.status(200).json({ configured: Boolean(expected) });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ ok: false, error: 'Ungültige Anfrage.' });
  }

  if (!expected) return res.status(200).json({ ok: true, configured: false });
  if (!passwordMatches(typeof body?.password === 'string' ? body.password : '')) {
    return res.status(401).json({ ok: false, configured: true, error: 'Passwort ist falsch.' });
  }
  return res.status(200).json({ ok: true, configured: true });
}
