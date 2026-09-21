/**
 * Buffer media hosting bridge.
 *
 * Buffer does not accept a file/Buffer upload. It fetches a stable, public
 * HTTPS URL later, when the post is published. This route therefore issues a
 * short-lived S3-compatible PUT URL for Cloudflare R2 or Backblaze B2. The
 * browser sends the video directly to that provider; the Vercel function never
 * receives the video bytes and no Vercel Blob is used.
 *
 * Puter is the third, browser-only option. The client writes the Blob through
 * Puter.js and asks Puter for its public read URL, so it needs no server secret.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { requirePassword } from '../shared/auth.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const PROVIDERS = ['r2', 'b2', 'puter'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // one-part browser PUT ceiling
const PRESIGN_TTL_SECONDS = 15 * 60;
const PATH_PREFIX = 'shortsfactory/';
const ALLOWED_CONTENT_TYPES = new Set(['video/mp4', 'video/webm']);

const META = {
  r2: {
    label: 'Cloudflare R2',
    description: 'S3-kompatibel, unbegrenzter Bucket-Speicher und kein Egress-Aufpreis.',
    setupUrl: 'https://developers.cloudflare.com/r2/',
    mode: 'server',
  },
  b2: {
    label: 'Backblaze B2',
    description: 'S3-kompatibel, günstig pro TB und bis 3× der gespeicherten Daten kostenloser Egress.',
    setupUrl: 'https://www.backblaze.com/cloud-storage/pricing',
    mode: 'server',
  },
  puter: {
    label: 'Puter.js',
    description: 'Browser-Upload ohne Env-Keys; Puter-Konto und User-Pays-Modell.',
    setupUrl: 'https://docs.puter.com/FS/',
    mode: 'browser',
  },
};

class StorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nonEmpty(name) {
  return process.env[name]?.trim() || '';
}

function validPublicBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

/** Return server-only settings for one S3-compatible provider. */
export function storageConfig(provider) {
  if (provider === 'r2') {
    const accountId = nonEmpty('R2_ACCOUNT_ID');
    const accessKeyId = nonEmpty('R2_ACCESS_KEY_ID');
    const secretAccessKey = nonEmpty('R2_SECRET_ACCESS_KEY');
    const bucket = nonEmpty('R2_BUCKET_NAME');
    const publicBaseUrl = validPublicBaseUrl(nonEmpty('R2_PUBLIC_BASE_URL'));
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
    return {
      provider,
      bucket,
      publicBaseUrl,
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        // Keep presigned browser PUTs free of SDK-only checksum headers.
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
    };
  }

  if (provider === 'b2') {
    const endpoint = nonEmpty('B2_S3_ENDPOINT') || nonEmpty('B2_ENDPOINT');
    const accessKeyId = nonEmpty('B2_KEY_ID') || nonEmpty('B2_APPLICATION_KEY_ID');
    const secretAccessKey = nonEmpty('B2_APPLICATION_KEY');
    const bucket = nonEmpty('B2_BUCKET_NAME');
    const publicBaseUrl = validPublicBaseUrl(nonEmpty('B2_PUBLIC_BASE_URL'));
    if (!endpoint || !/^https:\/\//i.test(endpoint) || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
    let region = nonEmpty('B2_S3_REGION');
    if (!region) {
      try { region = new URL(endpoint).hostname.split('.')[1] || 'us-east-1'; }
      catch { region = 'us-east-1'; }
    }
    return {
      provider,
      bucket,
      publicBaseUrl,
      client: new S3Client({
        region,
        endpoint: endpoint.replace(/\/$/, ''),
        credentials: { accessKeyId, secretAccessKey },
        // Keep presigned browser PUTs free of SDK-only checksum headers.
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
    };
  }

  return null;
}

export function providerIsConfigured(provider) {
  return provider === 'puter' || Boolean(storageConfig(provider));
}

export function providerStatuses() {
  return Object.fromEntries(PROVIDERS.map(provider => [provider, {
    provider,
    ...META[provider],
    configured: providerIsConfigured(provider),
  }]));
}

export function defaultProvider() {
  const requested = nonEmpty('STORAGE_PROVIDER').toLowerCase();
  if (PROVIDERS.includes(requested) && providerIsConfigured(requested)) return requested;
  return ['r2', 'b2', 'puter'].find(provider => providerIsConfigured(provider));
}

function safeFilename(filename) {
  const base = String(filename || 'video.mp4').split(/[\\/]/).pop()?.trim() || 'video.mp4';
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return cleaned && /\.(mp4|webm)$/i.test(cleaned) ? cleaned : `${cleaned || 'video'}.mp4`;
}

/** A unique, flat key works for S3 buckets and Puter paths alike. */
export function buildObjectKey(filename) {
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `${PATH_PREFIX}${stamp}-${randomUUID()}-${safeFilename(filename)}`;
}

function publicUrlFor(base, key) {
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function contentTypeOf(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function validateUploadMeta(body) {
  const contentType = contentTypeOf(body.contentType);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new StorageError('Nur MP4- oder WebM-Videos dürfen zu einem Upload-Host gesendet werden.', 400);
  }
  const size = Number(body.size);
  if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
    throw new StorageError('Die Datei ist größer als das App-Limit von 5 GiB für einen direkten Upload.', 413);
  }
  return contentType;
}

export function preparePuterUpload(body) {
  validateUploadMeta(body);
  const key = buildObjectKey(body.filename);
  return { ok: true, provider: 'puter', key };
}

export async function prepareS3Upload(provider, body) {
  const config = storageConfig(provider);
  if (!config) {
    const label = META[provider]?.label || provider;
    throw new StorageError(`${label} ist nicht vollständig konfiguriert. Siehe README und .env.example.`, 503);
  }
  const contentType = validateUploadMeta(body);
  const key = buildObjectKey(body.filename);
  const uploadUrl = await getSignedUrl(config.client, new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
  }), { expiresIn: PRESIGN_TTL_SECONDS });
  return {
    ok: true,
    provider,
    key,
    uploadUrl,
    publicUrl: publicUrlFor(config.publicBaseUrl, key),
    contentType,
    expiresIn: PRESIGN_TTL_SECONDS,
  };
}

export async function prepareUpload(body) {
  const provider = String(body?.provider || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new StorageError('Unbekannter Upload-Provider.', 400);
  if (provider === 'puter') return preparePuterUpload(body);
  return prepareS3Upload(provider, body);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requirePassword(req, res)) return;

  if (req.method === 'GET') {
    const providers = providerStatuses();
    return res.status(200).json({
      configured: Object.values(providers).some(provider => provider.configured),
      provider: defaultProvider(),
      providers,
    });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StorageError('Ungültige Anfrage.', 400);
    if (body.action !== 'prepare') throw new StorageError('Unbekannte Upload-Aktion.', 400);
    return res.status(200).json(await prepareUpload(body));
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Ungültige Anfrage.', uncertain: false });
    return res.status(error.status || 500).json({ error: error.message || 'Upload-Vorbereitung fehlgeschlagen.', uncertain: false });
  }
}
