/**
 * Upload-Host relay — the "middle way" so no public link ever has to be typed by hand.
 *
 * Buffer's API cannot receive file uploads; it needs a permanent, public HTTPS URL
 * for every video. This route is wired ONCE via server environment variables and
 * supports two kinds of hosts:
 *
 * 1. Internet Archive (archive.org) — completely free, no storage or bandwidth
 *    caps, no payment method, permanent public URLs. Provider "ia".
 *    S3_ENDPOINT=https://s3.us.archive.org, S3_BUCKET=<item name> (auto-created
 *    on first upload). Docs: https://archive.org/developers/ias3.html
 *
 * 2. Any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3, MinIO) —
 *    provider "s3", presigned PUT URLs (SigV4).
 *
 * The browser never needs CORS on the host: for the Internet Archive the video
 * is streamed through this relay in ~4 MB chunks (same-origin!) and assembled
 * via IA multipart upload; presigned S3 uploads go browser-direct. Videos never
 * sit on this server — chunks pass through memory only.
 *
 * Required env (server-side only, never VITE_):
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET
 * Optional:
 *   S3_ENDPOINT        ia: https://s3.us.archive.org
 *                      r2: https://<accountid>.r2.cloudflarestorage.com · b2: https://s3.<region>.backblazeb2.com · aws: leave empty
 *   S3_REGION          default "auto" (R2/IA). AWS: e.g. "eu-central-1".
 *   S3_PUBLIC_BASE_URL only for S3 hosts without derivable public URL (e.g. R2);
 *                      IA always derives https://archive.org/download/<item>.
 * The S3 bucket must allow the app origin via CORS (PUT/GET/HEAD) — see README.
 * The Internet Archive needs no CORS configuration at all.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const SIGN_TTL = 900; // seconds — upload must start within 15 minutes
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB sanity cap
const PART_SIZE = 4 * 1024 * 1024; // relay chunk size; stays under Vercel's 4.5 MB body limit
const CONTENT_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v' };
const IA_S3 = 'https://s3.us.archive.org';
const KEY_RE = /^\d{8}-\d{8}T\d{6}Z-[0-9a-f]{8}-[A-Za-z0-9._-]+$/;

class UploadError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function uploadEnv() {
  return {
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() || '',
    bucket: process.env.S3_BUCKET?.trim() || '',
    region: process.env.S3_REGION?.trim() || 'auto',
    endpoint: process.env.S3_ENDPOINT?.trim().replace(/\/+$/, '') || '',
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || '',
  };
}

export function uploadHostConfigured(e = uploadEnv()) {
  return Boolean(e.accessKeyId && e.secretAccessKey && e.bucket);
}

function hostOf(endpoint) {
  try { return new URL(endpoint).hostname.toLowerCase(); } catch { return ''; }
}

/** "ia" when S3_ENDPOINT points at the Internet Archive, otherwise "s3". */
export function providerOf(e = uploadEnv()) {
  return /(^|\.)archive\.org$/.test(hostOf(e.endpoint)) ? 'ia' : 's3';
}

/**
 * Credentials the operator pasted once inside the app (stored in that browser's
 * localStorage, same model as the AI keys). Used ONLY when no env host is
 * configured, and only for the Internet Archive relay flow — the server keeps
 * treating env config as the higher-priority source. Never logged, never
 * echoed back in a response.
 */
export function withClientCreds(e = uploadEnv(), req = {}, body = {}) {
  if (uploadHostConfigured(e)) return e; // server env wins
  const headers = req.headers || {};
  const accessKeyId = String(headers['x-sf-ia-access'] ?? body?.iaAccessKey ?? '').trim();
  const secretAccessKey = String(headers['x-sf-ia-secret'] ?? body?.iaSecretKey ?? '').trim();
  const bucket = String(headers['x-sf-ia-item'] ?? body?.iaItem ?? '').trim() || 'shortsfactory-videos';
  if (!accessKeyId || !secretAccessKey) return e;
  const merged = { ...e, accessKeyId, secretAccessKey, bucket, endpoint: IA_S3, region: 'auto' };
  return uploadHostConfigured(merged) ? merged : e;
}

/** Item identifiers: 3–80 chars, letters/digits/._-, no "--" (reserved by IA). */
export function validateIaItem(item) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(item) || item.includes('--')) {
    return 'Der Internet-Archive-Item-Name (S3_BUCKET) muss 3–80 Zeichen lang sein (Buchstaben, Zahlen, . _ -) und kein doppeltes Bindestrichpaar enthalten.';
  }
  return '';
}

/** RFC 3986 percent-encoding, as required by SigV4 (stricter than encodeURIComponent). */
function uriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256Hex = value => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();

/** Presign a PUT request (AWS Signature V4, query string variant, UNSIGNED-PAYLOAD). */
export function presignPut({ host, canonicalUri, accessKeyId, secretAccessKey, region, contentType, expiresIn = SIGN_TTL }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ (UTC)
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ].map(([k, v]) => `${k}=${uriEncode(v)}`).join('&');
  const canonicalRequest = [
    'PUT', canonicalUri, query, `content-type:${contentType.toLowerCase()}\nhost:${host}`, '', 'content-type;host', 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return `https://${host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

/** Strip everything that could escape the prefix, break URLs or create IA derived-file collisions. */
export function sanitizeFileName(filename, fallbackExt = '.mp4') {
  const base = String(filename || '').split(/[\\/]/).pop().trim();
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '').replace(/\s+/g, '-').slice(0, 80);
  const safe = cleaned && /\.\w{2,5}$/.test(cleaned) ? cleaned : `${cleaned || 'video'}${fallbackExt}`;
  return safe || `video${fallbackExt}`;
}

function validateMedia(contentType, size) {
  if (typeof contentType !== 'string' || !CONTENT_TYPES[contentType.toLowerCase()]) {
    throw new UploadError('Nur MP4- (video/mp4) oder WebM-Videos (video/webm) können hochgeladen werden.');
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) {
    throw new UploadError('Ungültige Dateigröße für den Upload.');
  }
  return CONTENT_TYPES[contentType.toLowerCase()];
}

function assertConfigured(e) {
  if (!uploadHostConfigured(e)) {
    throw new UploadError('Kein Upload-Host eingerichtet. Bitte S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY und S3_BUCKET als Server-Umgebungsvariablen setzen.', 503);
  }
}

/** Flat, collision-safe, IA-safe object key: <date>-<time>-<rand>-<file> (no slashes). */
export function buildIaKey(filename, contentType) {
  const ext = CONTENT_TYPES[contentType.toLowerCase()];
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  return `${stamp.slice(0, 8)}-${stamp}-${randomBytes(4).toString('hex')}-${sanitizeFileName(filename, ext)}`;
}

const iaAuth = e => `LOW ${e.accessKeyId}:${e.secretAccessKey}`;
const iaUrl = (e, key, query = '') => `${IA_S3}/${encodeURIComponent(e.bucket)}/${encodeURIComponent(key)}${query}`;

/** Metadata headers are applied when IA auto-creates the item; harmless afterwards. */
function iaHeaders(e, extra = {}) {
  return {
    Authorization: iaAuth(e),
    'x-archive-auto-make-bucket': '1',
    'x-amz-auto-make-bucket': '1',
    'x-archive-interactive-priority': '1',
    'x-archive-meta01-collection': 'opensource_movies',
    'x-archive-meta-mediatype': 'movies',
    'x-archive-meta-title': e.bucket,
    ...extra,
  };
}

async function iaFail(res) {
  let detail = '';
  try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
  if (res.status === 503) {
    return new UploadError('Das Internet Archive ist gerade überlastet (503 SlowDown). Bitte in wenigen Minuten erneut versuchen.', 503);
  }
  return new UploadError(`Internet Archive: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`, res.status >= 500 ? 502 : res.status);
}

const extractUploadId = xml => /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1] || '';

/**
 * IA flow, step 1 — start a multipart upload. Returns key/uploadId/public URLs.
 * The item is auto-created by IA on the first upload (no manual item setup).
 */
export async function iaInitUpload({ filename, contentType, size } = {}, e = uploadEnv()) {
  assertConfigured(e);
  if (providerOf(e) !== 'ia') throw new UploadError('ia-init ist nur mit dem Internet-Archive-Endpunkt möglich.', 400);
  const itemError = validateIaItem(e.bucket);
  if (itemError) throw new UploadError(itemError, 500);
  validateMedia(contentType, size);
  const key = buildIaKey(filename, contentType);
  const res = await fetch(iaUrl(e, key, '?uploads'), {
    method: 'POST',
    headers: iaHeaders(e, { 'x-archive-size-hint': String(size) }),
    signal: AbortSignal.timeout(45000),
  }).catch(() => { throw new UploadError('Internet Archive nicht erreichbar. Bitte später erneut versuchen.', 502); });
  if (!res.ok) throw await iaFail(res);
  const uploadId = extractUploadId(await res.text());
  if (!uploadId) throw new UploadError('Internet Archive hat keine Upload-ID bestätigt.', 502);
  return {
    provider: 'ia', key, uploadId, partSize: PART_SIZE,
    publicUrl: `https://archive.org/download/${e.bucket}/${encodeURIComponent(key)}`,
    publicUrlS3: iaUrl(e, key),
  };
}

/** IA flow, step 2 — stream one part through the relay (binary body, no CORS involved). */
export async function iaUploadPart({ key, uploadId, partNumber, body } = {}, e = uploadEnv()) {
  assertConfigured(e);
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new UploadError('Ungültiger Objekt-Schlüssel.');
  if (typeof uploadId !== 'string' || !/^[\w.\-]{6,300}$/.test(uploadId)) throw new UploadError('Ungültige Upload-ID.');
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new UploadError('Ungültige Teilenummer.');
  const buf = Buffer.isBuffer(body) ? body : body instanceof Uint8Array ? Buffer.from(body) : body ? Buffer.from(body) : null;
  if (!buf || buf.length < 1 || buf.length > PART_SIZE) throw new UploadError('Ungültige Teilgröße (max. 4 MB).');
  const res = await fetch(iaUrl(e, key, `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`), {
    method: 'PUT',
    headers: { Authorization: iaAuth(e) },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(55000),
  }).catch(() => { throw new UploadError('Verbindung zum Internet Archive unterbrochen. Bitte erneut versuchen.', 502); });
  if (!res.ok) throw await iaFail(res);
  const etag = res.headers.get('etag');
  if (!etag) throw new UploadError('Internet Archive hat kein ETag für den Upload-Teil gemeldet.', 502);
  return { etag };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** IA flow, step 3 — complete the multipart upload and pick a public URL that is already live. */
export async function iaCompleteUpload({ key, uploadId, parts } = {}, e = uploadEnv()) {
  assertConfigured(e);
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new UploadError('Ungültiger Objekt-Schlüssel.');
  if (typeof uploadId !== 'string' || !/^[\w.\-]{6,300}$/.test(uploadId)) throw new UploadError('Ungültige Upload-ID.');
  if (!Array.isArray(parts) || !parts.length || parts.some(p => !Number.isInteger(p?.partNumber) || typeof p?.etag !== 'string' || !p.etag)) {
    throw new UploadError('Ungültige Teil-Liste für den Upload-Abschluss.');
  }
  const xml = `<CompleteMultipartUpload>${parts.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  const res = await fetch(iaUrl(e, key, `?uploadId=${encodeURIComponent(uploadId)}`), {
    method: 'POST',
    headers: iaHeaders(e, { 'Content-Type': 'application/xml' }),
    body: xml,
    signal: AbortSignal.timeout(55000),
  }).catch(() => { throw new UploadError('Verbindung zum Internet Archive unterbrochen. Bitte erneut versuchen.', 502); });
  if (!res.ok) throw await iaFail(res);
  const publicUrlS3 = iaUrl(e, key);
  const publicUrlDownload = `https://archive.org/download/${e.bucket}/${encodeURIComponent(key)}`;
  // Prefer the URL that already answers; IA needs a moment for ingestion sometimes.
  for (const [url, waitMs] of [[publicUrlS3, 4000], [publicUrlS3, 6000]]) {
    if (await headOk(url)) return { ok: true, publicUrl: url, publicUrlDownload };
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  return { ok: true, publicUrl: publicUrlDownload, publicUrlDownload, note: 'Datei wird noch vom Internet Archive eingespeist; der Link ist in wenigen Minuten abrufbar.' };
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch { return false; }
}

/**
 * Fallback for the IA: sign a browser-direct PUT with LOW header auth (used only
 * when the relay path fails). NOTE: this deliberately hands the IA key to the
 * operator's own browser — this app must run behind access protection anyway.
 */
export function iaDirectUpload({ filename, contentType, size } = {}, e = uploadEnv()) {
  assertConfigured(e);
  const itemError = validateIaItem(e.bucket);
  if (itemError) throw new UploadError(itemError, 500);
  const ext = validateMedia(contentType, size);
  const key = buildIaKey(filename, contentType);
  return {
    provider: 'ia-direct',
    uploadUrl: iaUrl(e, key),
    headers: { ...iaHeaders(e), 'Content-Type': contentType.toLowerCase(), 'x-archive-size-hint': String(size) },
    publicUrl: `https://archive.org/download/${e.bucket}/${encodeURIComponent(key)}`,
    publicUrlS3: iaUrl(e, key),
  };
}

function derivePublicBase(e) {
  if (e.publicBaseUrl) {
    try {
      const url = new URL(e.publicBaseUrl);
      if (url.protocol !== 'https:') throw new Error();
      return e.publicBaseUrl;
    } catch { throw new UploadError('S3_PUBLIC_BASE_URL muss eine https://-Adresse sein.', 500); }
  }
  if (!e.endpoint) return `https://${e.bucket}.s3.${e.region}.amazonaws.com`; // AWS virtual-host style
  const host = hostOf(e.endpoint);
  if (!host) throw new UploadError('S3_ENDPOINT ist keine gültige URL.', 500);
  const b2 = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host); // e.g. s3.us-west-004.backblazeb2.com
  if (b2) {
    const net = /-(\d{3})$/.exec(b2[1]); // region like "us-west-004" → friendly host f004.us-west-004
    return net ? `https://f${net[1]}.${b2[1]}.backblazeb2.com/file/${e.bucket}` : null;
  }
  return null; // R2 / MinIO / custom: the public base must be configured explicitly
}

export function buildUploadTarget({ filename, contentType, size } = {}, e = uploadEnv()) {
  assertConfigured(e);
  if (providerOf(e) === 'ia') return iaDirectUpload({ filename, contentType, size }, e);
  const ext = validateMedia(contentType, size);
  const safeName = sanitizeFileName(filename, ext);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const key = `shortsfactory/${amzDate.slice(0, 8)}/${amzDate}-${randomBytes(4).toString('hex')}-${safeName}`;

  let host, canonicalUri;
  if (e.endpoint) {
    let url;
    try { url = new URL(e.endpoint); } catch { throw new UploadError('S3_ENDPOINT ist keine gültige URL.', 500); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new UploadError('S3_ENDPOINT muss mit http(s):// beginnen.', 500);
    const basePath = url.pathname.replace(/\/+$/, '');
    const hostHasBucket = url.hostname.toLowerCase().startsWith(`${e.bucket.toLowerCase()}.`);
    const pathHasBucket = basePath === `/${e.bucket}`;
    host = url.host; // includes a non-default port (MinIO & Co.)
    const prefix = hostHasBucket || pathHasBucket ? '' : `/${e.bucket}`; // path-style: bucket in the path
    canonicalUri = `${prefix}/${key.split('/').map(encodeURIComponent).join('/')}`;
  } else {
    host = `${e.bucket}.s3.${e.region}.amazonaws.com`;
    canonicalUri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  const uploadUrl = presignPut({ host, canonicalUri, accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey, region: e.region, contentType: contentType.toLowerCase() });
  const base = derivePublicBase(e);
  if (!base) {
    throw new UploadError('S3_PUBLIC_BASE_URL fehlt: Dieser Endpunkt (z. B. Cloudflare R2) hat keine ableitbare öffentliche Adresse. Bitte die öffentliche Bucket-URL (r2.dev-Subdomain oder eigene Domain) als S3_PUBLIC_BASE_URL setzen.', 500);
  }
  const publicUrl = `${base}/${key}`;
  return { provider: 's3', uploadUrl, publicUrl, key, expiresIn: SIGN_TTL };
}

/** Read a raw binary request body across runtimes (Buffer, string, stream). */
async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (req[Symbol.asyncIterator]) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > PART_SIZE + 1024 * 1024) throw new UploadError('Upload-Teil zu groß.');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Private operator app: deploy behind access protection (see README).
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const e = uploadEnv();
  const provider = uploadHostConfigured(e) ? providerOf(e) : null;
  if (req.method === 'GET') {
    let publicBase = null;
    if (provider) {
      publicBase = provider === 'ia'
        ? `https://archive.org/download/${e.bucket}`
        : (() => { try { return derivePublicBase(e); } catch { return null; } })();
    }
    return res.status(200).json({ configured: Boolean(provider), provider, bucket: e.bucket || null, publicBase });
  }
  try {
    const isJson = String(req.headers?.['content-type'] || '').includes('json');
    const body = isJson || !req.headers?.['content-type']
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
      : { action: new URL(req.url, 'http://local').searchParams.get('action'), binary: await readRawBody(req) };
    if (!body || typeof body !== 'object') throw new UploadError('Ungültige Anfrage.', 400);
    const e2 = withClientCreds(e, req, body);
    const prov = uploadHostConfigured(e2) ? providerOf(e2) : null;

    if (body.action === 'ia-check') {
      // Credential check for the in-app connect form: never creates or changes anything.
      if (!uploadHostConfigured(e2) || prov !== 'ia') throw new UploadError('Bitte access key und secret key eingeben.', 400);
      const itemError = validateIaItem(e2.bucket);
      if (itemError) throw new UploadError(itemError, 400);
      const iaRes = await fetch(`${IA_S3}/${encodeURIComponent(e2.bucket)}/?uploads`, {
        headers: { Authorization: iaAuth(e2) },
        signal: AbortSignal.timeout(30000),
      }).catch(() => { throw new UploadError('Internet Archive nicht erreichbar. Bitte später erneut versuchen.', 502); });
      if ([401, 403].includes(iaRes.status)) {
        return res.status(200).json({ ok: false, error: 'Internet Archive hat den Zugriff verweigert — bitte access key und secret key prüfen.' });
      }
      if (!iaRes.ok && iaRes.status !== 404) throw await iaFail(iaRes); // 404 = Schlüssel ok, Item gibt es noch nicht → wird beim ersten Upload angelegt
      return res.status(200).json({ ok: true, item: e2.bucket });
    }
    if (body.action === 'sign') {
      const target = prov === 'ia'
        ? await iaInitUpload(body, e2)
        : buildUploadTarget(body, e2);
      return res.status(200).json(target);
    }
    if (body.action === 'ia-direct') {
      if (prov !== 'ia') throw new UploadError('ia-direct ist nur mit dem Internet-Archive-Endpunkt möglich.', 400);
      return res.status(200).json(iaDirectUpload(body, e2));
    }
    if (body.action === 'ia-part') {
      if (prov !== 'ia') throw new UploadError('ia-part ist nur mit dem Internet-Archive-Endpunkt möglich.', 400);
      const q = new URL(req.url, 'http://local').searchParams;
      const result = await iaUploadPart({
        key: q.get('key'), uploadId: q.get('uploadId'),
        partNumber: Number(q.get('partNumber')), body: body.binary,
      }, e2);
      return res.status(200).json(result);
    }
    if (body.action === 'ia-complete') {
      if (prov !== 'ia') throw new UploadError('ia-complete ist nur mit dem Internet-Archive-Endpunkt möglich.', 400);
      return res.status(200).json(await iaCompleteUpload(body, e2));
    }
    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Upload-Signatur fehlgeschlagen.', uncertain: false });
  }
}
