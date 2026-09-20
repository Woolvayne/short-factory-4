/**
 * Upload-Host: Vercel Blob — der einzige Upload-Weg, kein manueller
 * Link-Eintrag mehr.
 *
 * Ablauf pro Video:
 *   1. Browser fragt /api/upload nach einem eingeschränkten Client-Token
 *      (Blob-Client-Protokoll, Pfad-Guard shortsfactory/*, nur MP4/WebM,
 *      max 2 GB, addRandomSuffix).
 *   2. Browser lädt die Datei mit diesem Token DIREKT zu Vercel Blob hoch
 *      (PUT https://vercel.com/api/blob) — das Read/Write-Token berührt den
 *      Upload nicht und verlässt Server bzw. eigenen Browser nie.
 *   3. Vercel liefert die permanente öffentliche URL zurück; die bekommt Buffer.
 *
 * Das Read/Write-Token kommt entweder aus der Server-Umgebung
 * (BLOB_READ_WRITE_TOKEN, automatisch injiziert via Storage → Connect) oder
 * wurde einmal im Versandfenster eingefügt — dann liegt es nur im
 * localStorage dieses Browsers (selbes Modell wie die AI-Keys).
 */

export type UploadProvider = 'vblob';

export interface UploadHostStatus {
  configured: boolean;
  provider?: UploadProvider | null;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

const BLOB_TOKEN_KEY = 'shortsfactory.blob_token.v1';
const BLOB_API = 'https://vercel.com/api/blob'; // Vercel Blob store router
const API_VERSION = '11'; // wire version of the client-upload protocol

/** Token pasted once in the app; stored in this browser's localStorage only. */
export function loadBlobToken(): string | null {
  try {
    const token = String(localStorage.getItem(BLOB_TOKEN_KEY) || '').trim();
    return token || null;
  } catch { /* private mode */ }
  return null;
}

export function saveBlobToken(token: string) {
  try { localStorage.setItem(BLOB_TOKEN_KEY, token.trim()); } catch { /* private mode */ }
}

export function clearBlobToken() {
  try { localStorage.removeItem(BLOB_TOKEN_KEY); } catch { /* private mode */ }
}

export async function fetchUploadStatus(signal?: AbortSignal): Promise<UploadHostStatus> {
  const res = await fetch('/api/upload', { signal });
  if (!res.ok) throw new Error('Upload-Backend nicht erreichbar.');
  const data = await res.json();
  return {
    configured: Boolean(data?.configured),
    provider: data?.provider === 'vblob' ? 'vblob' : null,
  };
}

async function postAction(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  blobToken?: string | null
): Promise<{ ok?: boolean; clientToken?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(blobToken ? { 'x-sf-blob-token': blobToken } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new Error('Upload-Host nicht erreichbar.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error(data?.error || `Upload-Anfrage fehlgeschlagen (HTTP ${res.status}).`);
  }
  return data;
}

/** Token check for the in-app connect form — creates or changes nothing. */
export async function checkBlobToken(token: string, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  const result = await postAction({ action: 'vblob-check', blobToken: token }, signal, token);
  return { ok: Boolean(result?.ok), error: result?.error };
}

/** Flat, collision-safe Vercel-Blob path inside the app lane: shortsfactory/<stamp>-<rand>-<file>. */
function buildBlobPathname(filename: string): string {
  const base = String(filename || '').split(/[\\/]/).pop()!.trim();
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '_').replace(/^\.+/, '').replace(/\s+/g, '-').slice(0, 80);
  const safe = cleaned && /\.\w{2,5}$/.test(cleaned) ? cleaned : `${cleaned || 'video'}.mp4`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const rand = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `shortsfactory/${stamp}-${rand}-${safe}`;
}

/** Plain-language errors out of Vercel Blob's JSON error shape (German operator UI). */
function blobErrorText(status: number, bodyText: string): string {
  let code = '';
  try { code = JSON.parse(bodyText)?.error?.code || ''; } catch { /* not JSON */ }
  if (status === 401 || status === 403 || code === 'unauthorized' || code === 'forbidden') {
    return 'Vercel Blob hat den Upload abgelehnt — Token ungültig oder abgelaufen. Bitte Vercel Blob im Versandfenster neu verbinden.';
  }
  if (status === 404 || status === 410 || code === 'not_found' || code === 'store_not_found') {
    return 'Der Blob-Store wurde nicht gefunden oder ist pausiert — bitte im Vercel-Dashboard prüfen.';
  }
  if (code === 'file_too_large') return 'Die Datei ist zu groß (Limit dieser App: 2 GB).';
  if (code === 'content_type_not_allowed') return 'Nur MP4- oder WebM-Videos sind erlaubt.';
  if (code === 'client_token_expired') return 'Das Upload-Token ist abgelaufen — bitte erneut versuchen.';
  if (status >= 500 || code === 'service_unavailable' || code === 'internal_server_error') {
    return 'Vercel Blob meldet einen Serverfehler — bitte später erneut versuchen.';
  }
  return `Vercel Blob hat HTTP ${status} gemeldet${code ? ` (${code})` : ''}.`;
}

/**
 * Step 2 of the Vercel-Blob path: PUT the file browser-direct with the client
 * token (XHR so progress stays measurable), resolve with the permanent URL.
 */
function putToVercelBlob(
  pathname: string,
  clientToken: string,
  file: Blob,
  contentType: string,
  signal: AbortSignal | undefined,
  onProgress?: (p: UploadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${BLOB_API}/?pathname=${encodeURIComponent(pathname)}`);
    xhr.setRequestHeader('authorization', `Bearer ${clientToken}`);
    xhr.setRequestHeader('x-api-version', API_VERSION);
    xhr.setRequestHeader('x-content-type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (typeof data.url === 'string' && data.url) { resolve(data.url); return; }
        } catch { /* fall through */ }
        reject(new Error('Vercel Blob hat keine öffentliche Adresse gemeldet.'));
        return;
      }
      reject(new Error(blobErrorText(xhr.status, xhr.responseText || '')));
    };
    xhr.onerror = () => reject(new Error('Upload fehlgeschlagen — Vercel Blob ist vom Browser aus nicht erreichbar (Netzwerk/CORS).'));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen.', 'AbortError'));
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });
}

/**
 * The whole Vercel-Blob path for one rendered video: ask /api/upload for a
 * constrained client token, PUT browser-direct, resolve with the permanent
 * public URL. The upload must fully succeed before anything is sent to Buffer.
 */
export async function uploadViaVercelBlob(
  file: Blob,
  opts: {
    filename: string;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  }
): Promise<string> {
  const blobToken = loadBlobToken();
  const pathname = buildBlobPathname(opts.filename);
  const { clientToken } = await postAction(
    { type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: false } },
    opts.signal,
    blobToken
  );
  if (!clientToken || !clientToken.startsWith('vercel_blob_client_')) {
    throw new Error('Upload-Host hat kein gültiges Upload-Token geliefert.');
  }
  try {
    // Exactly the pathname the token was issued for — Vercel rejects mismatches.
    return await putToVercelBlob(pathname, clientToken, file, opts.contentType.toLowerCase(), opts.signal, opts.onProgress);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${message} Es wurde noch nichts an Buffer gesendet.`);
  }
}

/**
 * Upload one rendered video — Vercel Blob only. Resolves with the permanent
 * public URL. Throws a clear German error when nothing is connected.
 */
export async function uploadRenderFile(
  file: Blob,
  opts: {
    filename: string;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  }
): Promise<string> {
  if (!loadBlobToken()) {
    // No in-app token → only the server env can still be connected.
    const status = await fetchUploadStatus(opts.signal).catch(() => null);
    if (!status?.configured) throw new Error('Bitte erst Vercel Blob im Versandfenster verbinden.');
  }
  return uploadViaVercelBlob(file, opts);
}
