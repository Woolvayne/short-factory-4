/**
 * One-time-configured upload host: the browser hands finished renders to the
 * configured host and receives the permanent public URL that Buffer gets —
 * no manual link entry ever again.
 *
 * Two providers (chosen once via server env, see api/upload.js):
 * - "s3"  (Cloudflare R2 / Backblaze B2 / AWS S3 / MinIO): presigned PUT,
 *   the video streams browser → bucket directly.
 * - "ia"  (Internet Archive — free, no caps, no payment method): chunked
 *   same-origin relay (4 MB parts → /api/upload → IA multipart). No CORS
 *   setup needed; the IA key never reaches the browser on this path. If the
 *   relay fails (e.g. IA rejects small parts), a browser-direct PUT with
 *   header auth is attempted once as fallback.
 */

export type UploadProvider = 's3' | 'ia';

export interface UploadHostStatus {
  configured: boolean;
  provider?: UploadProvider | null;
  bucket?: string | null;
  publicBase?: string | null;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

/** Keys pasted once in the app; stored in this browser's localStorage only (like the AI keys). */
export interface IaCredentials {
  accessKey: string;
  secretKey: string;
  item: string;
}

const IA_CREDS_KEY = 'shortsfactory.ia_creds.v1';

export function loadIaCredentials(): IaCredentials | null {
  try {
    const raw = JSON.parse(localStorage.getItem(IA_CREDS_KEY) || 'null');
    if (raw && typeof raw.accessKey === 'string' && typeof raw.secretKey === 'string' && typeof raw.item === 'string'
      && raw.accessKey.trim() && raw.secretKey.trim() && raw.item.trim()) {
      return { accessKey: raw.accessKey.trim(), secretKey: raw.secretKey.trim(), item: raw.item.trim() };
    }
  } catch { /* private mode / corrupt */ }
  return null;
}

export function saveIaCredentials(creds: IaCredentials) {
  try { localStorage.setItem(IA_CREDS_KEY, JSON.stringify(creds)); } catch { /* private mode */ }
}

export function clearIaCredentials() {
  try { localStorage.removeItem(IA_CREDS_KEY); } catch { /* private mode */ }
}

export async function fetchUploadStatus(signal?: AbortSignal): Promise<UploadHostStatus> {
  const res = await fetch('/api/upload', { signal });
  if (!res.ok) throw new Error('Upload-Backend nicht erreichbar.');
  const data = await res.json();
  return {
    configured: Boolean(data?.configured),
    provider: data?.provider === 'ia' ? 'ia' : 's3',
    bucket: data?.bucket ?? null,
    publicBase: data?.publicBase ?? null,
  };
}

interface SignResponse {
  provider: 's3' | 'ia';
  uploadUrl?: string;
  publicUrl: string;
  publicUrlS3?: string;
  key: string;
  uploadId?: string;
  partSize?: number;
  note?: string;
  headers?: Record<string, string>;
}

async function postAction(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  creds?: IaCredentials | null
): Promise<SignResponse & { ok?: boolean; etag?: string; error?: string; item?: string }> {
  const body = creds
    ? { ...payload, iaAccessKey: creds.accessKey, iaSecretKey: creds.secretKey, iaItem: creds.item }
    : payload;
  let res: Response;
  try {
    res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error('Upload-Host (Relay) nicht erreichbar.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error(data?.error || `Upload-Anfrage fehlgeschlagen (HTTP ${res.status}).`);
  }
  return data;
}

/** Credential check for the in-app connect form — creates or changes nothing. */
export async function checkIaCredentials(creds: IaCredentials, signal?: AbortSignal): Promise<{ ok: boolean; error?: string; item?: string }> {
  const result = await postAction({ action: 'ia-check' }, signal, creds);
  return { ok: Boolean(result?.ok), error: result?.error, item: result?.item };
}

function xhrPut(url: string, headers: Record<string, string>, body: Blob, signal: AbortSignal | undefined, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload-Host hat HTTP ${xhr.status} gemeldet.`));
    };
    xhr.onerror = () =>
      reject(new Error('Upload fehlgeschlagen — der Host blockiert Browser-Uploads (CORS) oder ist nicht erreichbar.'));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen.', 'AbortError'));
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);
    xhr.send(body);
  });
}

/** IA via same-origin relay: init → 4 MB parts → complete. Key stays server-side unless local creds are used. */
async function iaRelayUpload(
  signed: SignResponse,
  file: Blob,
  opts: { signal?: AbortSignal; onProgress?: (p: UploadProgress) => void; iaCreds?: IaCredentials | null }
): Promise<string> {
  const { key, uploadId } = signed;
  const partSize = signed.partSize ?? 4 * 1024 * 1024;
  if (!key || !uploadId) throw new Error('Upload-Host hat keine Upload-ID gemeldet.');
  const credHeaders: Record<string, string> = opts.iaCreds
    ? { 'x-sf-ia-access': opts.iaCreds.accessKey, 'x-sf-ia-secret': opts.iaCreds.secretKey, 'x-sf-ia-item': opts.iaCreds.item }
    : {};
  const parts: { partNumber: number; etag: string }[] = [];
  const total = file.size;
  let loaded = 0;
  for (let partNumber = 1, offset = 0; offset < total; partNumber++, offset += partSize) {
    const slice = file.slice(offset, Math.min(offset + partSize, total));
    let etag = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const q = `action=ia-part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`;
        const res = await fetch(`/api/upload?${q}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', ...credHeaders },
          body: slice,
          signal: opts.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.etag) throw new Error(data?.error || `Upload-Teil ${partNumber} fehlgeschlagen (HTTP ${res.status}).`);
        etag = data.etag;
        break;
      } catch (e) {
        if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
        if (attempt === 2) throw e;
      }
    }
    parts.push({ partNumber, etag });
    loaded += slice.size;
    opts.onProgress?.({ loaded, total });
  }
  const done = await postAction({ action: 'ia-complete', key, uploadId, parts }, opts.signal, opts.iaCreds);
  return done.publicUrl || signed.publicUrl;
}

/**
 * Sign + upload one rendered video. Resolves with the permanent public URL;
 * the upload must fully succeed before anything is sent to Buffer.
 */
export async function uploadRenderFile(
  file: Blob,
  opts: {
    filename: string;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
    iaCreds?: IaCredentials | null;
  }
): Promise<string> {
  const signed = await postAction(
    { action: 'sign', filename: opts.filename, contentType: opts.contentType, size: file.size },
    opts.signal,
    opts.iaCreds
  );

  if (signed.provider === 'ia') {
    try {
      return await iaRelayUpload(signed, file, opts);
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      // Fallback: single browser-direct PUT with header auth (needs IA CORS).
      let direct: SignResponse;
      try {
        direct = await postAction({ action: 'ia-direct', filename: opts.filename, contentType: opts.contentType, size: file.size }, opts.signal, opts.iaCreds);
      } catch {
        throw e; // relay error is the more specific one
      }
      try {
        await xhrPut(direct.uploadUrl!, direct.headers ?? {}, file, opts.signal, opts.onProgress);
        return direct.publicUrl || signed.publicUrl;
      } catch (e2) {
        throw new Error(`Upload in das Internet Archive fehlgeschlagen (Relay: ${e instanceof Error ? e.message : e} · Direkt: ${e2 instanceof Error ? e2.message : e2}). Es wurde noch nichts an Buffer gesendet.`);
      }
    }
  }

  if (!signed.uploadUrl) throw new Error('Upload-Host hat keine signierte Adresse geliefert.');
  try {
    // content-type is part of the presigned signature — send exactly what was signed.
    await xhrPut(signed.uploadUrl, { 'Content-Type': opts.contentType.toLowerCase() }, file, opts.signal, opts.onProgress);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${message.includes('CORS') ? 'Upload fehlgeschlagen — prüfe die CORS-Freigabe (PUT) des Buckets.' : message} Es wurde noch nichts an Buffer gesendet.`
    );
  }
  return signed.publicUrl;
}
