/**
 * Upload-Host relay — the "middle way" so no public link ever has to be typed by hand.
 *
 * Buffer's API cannot receive file uploads; it needs a permanent, public HTTPS URL
 * for every video. This route is wired ONCE to any S3-compatible bucket
 * (Cloudflare R2, Backblaze B2, AWS S3, MinIO …) via server environment variables.
 * Afterwards the browser gets a short-lived presigned PUT URL here and uploads each
 * finished render straight to the bucket — the video never flows through this server
 * (serverless body limits stay irrelevant) — and the app receives the permanent
 * public URL that is then handed to Buffer.
 *
 * Required env (server-side only, never VITE_):
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET
 * Optional:
 *   S3_REGION          default "auto" (R2). AWS: e.g. "eu-central-1".
 *   S3_ENDPOINT        e.g. https://<accountid>.r2.cloudflarestorage.com (R2)
 *                      or https://s3.us-west-004.backblazeb2.com (B2). AWS: leave empty.
 *   S3_PUBLIC_BASE_URL e.g. https://pub-<hash>.r2.dev or a custom domain.
 *                      Derived automatically for AWS and B2 friendly URLs.
 * The bucket must allow the app origin via CORS (PUT/GET/HEAD) — see README.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const SIGN_TTL = 900; // seconds — upload must start within 15 minutes
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB sanity cap
const CONTENT_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v' };

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

/** Strip everything that could escape the shortsfactory/ prefix or break URLs. */
export function sanitizeFileName(filename, fallbackExt = '.mp4') {
  const base = String(filename || '').split(/[\\/]/).pop().trim();
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '').replace(/\s+/g, '-').slice(0, 80);
  const safe = cleaned && /\.\w{2,5}$/.test(cleaned) ? cleaned : `${cleaned || 'video'}${fallbackExt}`;
  return safe || `video${fallbackExt}`;
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
  let host;
  try { host = new URL(e.endpoint).hostname.toLowerCase(); } catch { throw new UploadError('S3_ENDPOINT ist keine gültige URL.', 500); }
  const b2 = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host); // e.g. s3.us-west-004.backblazeb2.com
  if (b2) {
    const net = /-(\d{3})$/.exec(b2[1]); // region like "us-west-004" → friendly host f004.us-west-004
    return net ? `https://f${net[1]}.${b2[1]}.backblazeb2.com/file/${e.bucket}` : null;
  }
  return null; // R2 / MinIO / custom: the public base must be configured explicitly
}

export function buildUploadTarget({ filename, contentType, size } = {}, e = uploadEnv()) {
  if (!uploadHostConfigured(e)) {
    throw new UploadError('Kein Upload-Host eingerichtet. Bitte S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY und S3_BUCKET als Server-Umgebungsvariablen setzen.', 503);
  }
  if (typeof contentType !== 'string' || !CONTENT_TYPES[contentType.toLowerCase()]) {
    throw new UploadError('Nur MP4- (video/mp4) oder WebM-Videos (video/webm) können hochgeladen werden.');
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) {
    throw new UploadError('Ungültige Dateigröße für den Upload.');
  }
  const safeName = sanitizeFileName(filename, CONTENT_TYPES[contentType.toLowerCase()]);
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
  return { uploadUrl, publicUrl, key, expiresIn: SIGN_TTL };
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
  if (req.method === 'GET') {
    return res.status(200).json({
      configured: uploadHostConfigured(e),
      kind: 's3',
      bucket: e.bucket || null,
      publicBase: uploadHostConfigured(e) ? derivePublicBase(e) : null,
    });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body?.action === 'sign') {
      const target = buildUploadTarget(body, e);
      return res.status(200).json(target);
    }
    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Upload-Signatur fehlgeschlagen.', uncertain: false });
  }
}
