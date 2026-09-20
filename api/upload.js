/**
 * Upload-Host: Vercel Blob — der einzige verbliebene Upload-Weg, damit nie
 * wieder ein Link von Hand eingetragen werden muss.
 *
 * Buffer's API kann keine Datei-Uploads empfangen; sie braucht eine permanente,
 * öffentliche HTTPS-URL pro Video. Diese Route wird EINMAL über ein Vercel-Blob-
 * Read/Write-Token verbunden und liefert dem Browser danach pro Upload ein
 * kurzlebiges, eingeschränktes Client-Token. Der Browser lädt die Videodatei
 * damit DIREKT zu Vercel Blob hoch (PUT https://vercel.com/api/blob) —
 * dieselbe Client-Upload-Route, die das offizielle @vercel/blob-SDK nutzt, hier
 * ohne SDK-Abhängigkeit nachgebaut. Videos laufen nie durch diesen Server.
 *
 * Auflösung des Hosts (resolveHost), Priorität von oben nach unten:
 *   1. Server-Env BLOB_READ_WRITE_TOKEN — wird von Vercel automatisch injiziert,
 *      wenn der Blob-Store im Dashboard via Storage → Connect ans Projekt
 *      gehängt wird (oder manuell als Umgebungsvariable gesetzt wird).
 *   2. In-App-Token: einmal im Versandfenster eingefügt (Header
 *      x-sf-blob-token bzw. body.blobToken); gespeichert liegt es nur im
 *      localStorage des eigenen Browsers, im selben Modell wie die AI-Keys.
 *
 * Das Read/Write-Token verlässt den Server nie und wird in keiner Antwort
 * zurückgegeben. Das ausgestellte Client-Token enthält nur die storeId des
 * Tokens plus eine HMAC-Signatur — kein Token-Material.
 *
 * Required env (server-side only, never VITE_):
 *   BLOB_READ_WRITE_TOKEN   vercel.com → Projekt → Storage → Blob → .env.local
 */
import { createHmac } from 'node:crypto';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const BLOB_API = 'https://vercel.com/api/blob'; // Vercel Blob store router
const API_VERSION = '11'; // wire version of the client-upload protocol
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per video
const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/webm'];
const CLIENT_TOKEN_TTL = 60 * 60 * 1000; // client token stays valid for 1 hour
const PATH_PREFIX = 'shortsfactory/';
const PATHNAME_RE = /^[\w./-]{1,300}$/; // letters, digits, ./_- only

class UploadError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Server-configured Vercel Blob read/write token (Storage → Connect or env). */
export function blobTokenFromEnv() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || '';
}

/**
 * Resolve the upload host — Vercel Blob only. The server env token always
 * wins; otherwise the in-app token travels with the request (header
 * x-sf-blob-token or body.blobToken, stored in the operator's browser only).
 * Returns null when nothing is configured.
 */
export function resolveHost(req = {}, body = {}) {
  const envToken = blobTokenFromEnv();
  if (envToken) return { provider: 'vblob', token: envToken, source: 'env' };
  const headers = req.headers || {};
  const inAppToken = String(headers['x-sf-blob-token'] ?? body?.blobToken ?? '').trim();
  if (inAppToken) return { provider: 'vblob', token: inAppToken, source: 'app' };
  return null;
}

const storeIdOf = token => String(token).split('_')[3] || '';

/**
 * Generate a restricted client token offline (no network call) — identical to
 * @vercel/blob's generateClientTokenFromReadWriteToken: base64(JSON payload),
 * HMAC-SHA256 over the payload string with the read/write token, wrapped as
 * vercel_blob_client_<storeId>_<base64(signature.payload)>.
 */
export function generateClientToken(readWriteToken, constraints) {
  const storeId = storeIdOf(readWriteToken);
  if (!storeId) {
    throw new UploadError('Das ist kein gültiges Vercel-Blob-Read/Write-Token (erwartetes Format: vercel_blob_rw_<store>_<secret>).', 400);
  }
  const payload = Buffer.from(JSON.stringify(constraints), 'utf8').toString('base64');
  const signature = createHmac('sha256', readWriteToken).update(payload, 'utf8').digest('hex');
  return `vercel_blob_client_${storeId}_${Buffer.from(`${signature}.${payload}`, 'utf8').toString('base64')}`;
}

/** Is this JSON body a @vercel/blob client-upload handshake? */
export function isBlobClientRequest(body) {
  return Boolean(body && typeof body === 'object' && body.type === 'blob.generate-client-token');
}

/**
 * The blob client-protocol bridge: the browser asks for a client token
 * ({ type: 'blob.generate-client-token', payload: { pathname, ... } }) and
 * receives one that is hard-constrained to this app's lane:
 *   - path guard: shortsfactory/* only (no traversal, no double slashes)
 *   - allowedContentTypes: MP4 / WebM only
 *   - maximumSizeInBytes: 2 GB
 *   - addRandomSuffix: every upload gets its own suffix, nothing is overwritten
 * Vercel enforces these constraints server-side when the browser uploads.
 */
export function handleBlobClientUpload(body, host) {
  const payload = body?.payload ?? {};
  const pathname = String(payload.pathname ?? '');
  if (!pathname.startsWith(PATH_PREFIX) || pathname.slice(PATH_PREFIX.length).length < 3
    || pathname.includes('..') || pathname.includes('//') || !PATHNAME_RE.test(pathname)) {
    throw new UploadError('Ungültiger Pfad. Uploads laufen ausschließlich unter shortsfactory/*.', 400);
  }
  return {
    type: 'blob.generate-client-token',
    clientToken: generateClientToken(host.token, {
      pathname,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      maximumSizeInBytes: MAX_BYTES,
      addRandomSuffix: true,
      validUntil: Date.now() + CLIENT_TOKEN_TTL,
    }),
  };
}

/** Plain-language mapping of a Vercel Blob API failure (German operator UI). */
export function blobErrorMessage(status, bodyText = '') {
  let code = '';
  try { code = JSON.parse(bodyText)?.error?.code || ''; } catch { /* not JSON */ }
  if (status === 401 || status === 403 || code === 'unauthorized' || code === 'forbidden') {
    return 'Token abgelehnt — bitte das Read/Write-Token im Vercel-Dashboard prüfen (Storage → Blob).';
  }
  if (status === 404 || status === 410 || code === 'not_found' || code === 'store_not_found') {
    return 'Store nicht gefunden oder pausiert — bitte den Blob-Store im Vercel-Dashboard prüfen.';
  }
  if (code === 'file_too_large') return 'Datei zu groß für Vercel Blob (Limit dieser App: 2 GB).';
  if (code === 'content_type_not_allowed') return 'Nur MP4- oder WebM-Videos sind erlaubt.';
  if (code === 'rate_limited' || status === 429) return 'Vercel Blob ist kurzzeitig ratenbegrenzt — bitte in wenigen Minuten erneut versuchen.';
  if (status >= 500) return `Vercel Blob meldet einen Serverfehler (HTTP ${status}) — bitte später erneut versuchen.`;
  return `Vercel Blob: HTTP ${status}${code ? ` (${code})` : ''}.`;
}

/**
 * vblob-check — verify a read/write token directly against Vercel's list
 * endpoint (GET https://vercel.com/api/blob?limit=1). Creates and changes
 * nothing. Resolves { ok: true } on success and { ok, error } for rejected
 * tokens; throws an UploadError (502) on network/server failures.
 */
export async function vblobCheck(token) {
  if (!storeIdOf(token)) {
    return { ok: false, error: 'Das ist kein gültiges Read/Write-Token (erwartetes Format: vercel_blob_rw_<store>_<secret> aus dem Vercel-Dashboard).' };
  }
  const res = await fetch(`${BLOB_API}/?limit=1`, {
    headers: { authorization: `Bearer ${token}`, 'x-api-version': API_VERSION },
    signal: AbortSignal.timeout(30000),
  }).catch(() => {
    throw new UploadError('Vercel Blob ist nicht erreichbar. Bitte später erneut versuchen.', 502);
  });
  if (res.ok) return { ok: true };
  const text = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status >= 500) {
    throw new UploadError(blobErrorMessage(res.status, text), 502);
  }
  return { ok: false, error: blobErrorMessage(res.status, text) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Private operator app: deploy behind access protection (see README).
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'GET') {
    const envToken = blobTokenFromEnv();
    return res.status(200).json({ configured: Boolean(envToken), provider: envToken ? 'vblob' : null });
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UploadError('Ungültige Anfrage.', 400);

    if (isBlobClientRequest(body)) {
      // The browser upload handshake — needs any configured token source.
      const host = resolveHost(req, body);
      if (!host) {
        throw new UploadError('Kein Upload-Host eingerichtet: BLOB_READ_WRITE_TOKEN als Server-Umgebungsvariable setzen oder Vercel Blob einmal im Versandfenster verbinden.', 503);
      }
      return res.status(200).json(handleBlobClientUpload(body, host));
    }

    if (body.action === 'vblob-check') {
      // Credential check for the in-app connect form: creates/changes nothing.
      // A token handed in explicitly wins (that is the one being verified),
      // otherwise the server env token is checked.
      const token = String(req.headers?.['x-sf-blob-token'] ?? body?.blobToken ?? '').trim() || blobTokenFromEnv();
      if (!token) throw new UploadError('Bitte zuerst das Read/Write-Token einfügen.', 400);
      return res.status(200).json(await vblobCheck(token));
    }

    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  } catch (err) {
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Ungültige Anfrage.', uncertain: false });
    return res.status(err.status || 500).json({ error: err.message || 'Vercel-Blob-Anfrage fehlgeschlagen.', uncertain: false });
  }
}
