/**
 * Buffer media hosting bridge — OnlyFiles (the one shipping route).
 *
 * Buffer does not accept a file upload. It fetches a stable public HTTPS URL
 * later, when the post is published. The browser therefore posts the rendered
 * video straight to OnlyFiles' CORS-enabled anonymous API (no account, no key,
 * no bucket, `expire=0` keeps the file) and verifies the returned links itself,
 * in the browser, exactly the way Buffer will read them later.
 *
 * This route never sees video bytes. It only hands out the endpoint plus the
 * hard caps so the client can fail before burning an upload, and it keeps the
 * password gate in front of every dispatch decision.
 */
import { requirePassword } from '../shared/auth.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * OnlyFiles — free anonymous hosting, verified 2026-09-22 against
 * https://onlyfiles.com/api. No account, no key: `expire=0` keeps the file
 * forever, 100 MB per file, 500 files / 50 GB per hour and 5,000 files /
 * 100 GB per day.
 */
const ONLYFILES = {
  uploadEndpoint: 'https://api.onlyfiles.com/v1/upload',
  /** The API answers with `data.file.url.full` / `url.short`; `/dl/{id}/{name}`
   *  is the additional direct-download shape. The browser probes all of them. */
  publicBase: 'https://onlyfiles.com',
  fileField: 'file',
  /** `expire=0` means "keep forever"; the API default would be 24 hours. */
  expireForever: '0',
  maxBytes: 100 * 1000 * 1000, // documented "max 100 MB" per file
};

const META = {
  label: 'OnlyFiles',
  description: 'Anonym, ohne Konto und ohne Einrichtung: unbegrenzt viele Dateien, Dauer-Link, 100 MB pro Datei.',
  setupUrl: 'https://onlyfiles.com/api',
};

class StorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ALLOWED_CONTENT_TYPES = new Set(['video/mp4', 'video/webm']);
/** Hard app ceiling for any single dispatch upload. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

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

function contentTypeOf(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * Zero-setup upload: nothing but the file itself. The browser posts it as
 * `multipart/form-data` to the public API, which answers with CORS `*`. This
 * route only hands out the endpoint plus the hard 100 MB per-file cap so the
 * client can fail before burning an upload. Verification of the finished
 * upload happens in the browser (see src/lib/uploader.ts) — a datacenter-side
 * probe of onlyfiles.com is what used to break every dispatch.
 */
export function prepareOnlyFilesUpload(body) {
  const contentType = contentTypeOf(body.contentType);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new StorageError('Nur MP4- oder WebM-Videos dürfen zum Upload-Host gesendet werden.', 400);
  }
  const size = Number(body.size);
  if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
    throw new StorageError('Die Datei ist größer als das App-Limit von 5 GiB für einen direkten Upload.', 413);
  }
  if (Number.isFinite(size) && size > ONLYFILES.maxBytes) {
    throw new StorageError(
      `OnlyFiles nimmt maximal 100 MB pro Datei an — dieses Video hat ${(size / 1_000_000).toFixed(1)} MB. `
      + 'Bitrate oder Auflösung in den Settings reduzieren. Es wurde nichts hochgeladen.',
      413
    );
  }
  return {
    ok: true,
    provider: 'onlyfiles',
    label: META.label,
    endpoint: ONLYFILES.uploadEndpoint,
    publicBase: ONLYFILES.publicBase,
    fileField: ONLYFILES.fileField,
    expire: ONLYFILES.expireForever,
    maxBytes: ONLYFILES.maxBytes,
    contentType,
    filename: safeFilename(body.filename),
  };
}

export function uploadStatus() {
  return {
    ok: true,
    configured: true,
    provider: 'onlyfiles',
    ...META,
    limits: {
      maxBytes: ONLYFILES.maxBytes,
      expire: 'kept forever',
      filesPerHour: 500,
      bytesPerHour: '50 GB',
      filesPerDay: 5000,
      bytesPerDay: '100 GB',
    },
  };
}

export async function prepareUpload(body) {
  const provider = String(body?.provider || 'onlyfiles').toLowerCase();
  if (provider !== 'onlyfiles') {
    throw new StorageError(
      'Es gibt genau einen Versandweg: OnlyFiles (anonym, kein Konto, kein Key).', 400);
  }
  return prepareOnlyFilesUpload(body);
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
    return res.status(200).json(uploadStatus());
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StorageError('Ungültige Anfrage.', 400);
    if (body.action === 'prepare') return res.status(200).json(await prepareUpload(body));
    if (body.action === 'verify') {
      // Verification moved into the browser: a server-side probe of
      // onlyfiles.com got bot-challenged and rejected healthy uploads.
      throw new StorageError(
        'Die Verifikation läuft jetzt direkt im Browser — dieser Endpunkt wird nicht mehr benötigt.', 410);
    }
    throw new StorageError('Unbekannte Upload-Aktion.', 400);
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Ungültige Anfrage.', uncertain: false });
    return res.status(error.status || 500).json({ error: error.message || 'Upload-Vorbereitung fehlgeschlagen.', uncertain: false });
  }
}
