/**
 * The one shipping route to Buffer: anonymous OnlyFiles hosting.
 *
 * Buffer does not accept file uploads — it fetches a stable public HTTPS URL
 * when the post publishes. The browser posts the rendered video straight to
 * OnlyFiles' CORS-enabled anonymous API (no account, no key, no bucket) and
 * then verifies, in the browser, that one of the returned links really serves
 * the video bytes. Only that verified URL is handed to Buffer.
 *
 * Why browser-side verification? A datacenter-side probe (Vercel function) of
 * onlyfiles.com kept getting bot-challenged with HTML responses, which rejected
 * perfectly healthy uploads. The browser probes with a byte-range fetch and —
 * independent of CORS — with a real <video> element, which is exactly how
 * Buffer will consume the file later. The server never touches video bytes.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadHostStatus {
  configured: boolean;
  label: string;
  maxBytes: number;
}

interface PreparedUpload {
  endpoint: string;
  fileField: string;
  expire: string;
  maxBytes: number;
  filename: string;
}

/** Parsed subset of the OnlyFiles upload response we rely on. */
export interface OnlyFilesUploadResult {
  id: string;
  name: string;
  fullUrl: string;
  shortUrl: string;
}

const AUTH_FAILED = 'Upload-Backend nicht erreichbar.';

/** Every call to the same-origin upload route (status + prepare) runs through here. */
async function callUploadApi(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    const { authHeaders } = await import('./auth.ts');
    response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error(AUTH_FAILED);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    throw new Error(data?.error || `Upload-Vorbereitung fehlgeschlagen (HTTP ${response.status}).`);
  }
  return data as Record<string, unknown>;
}

export async function fetchUploadStatus(signal?: AbortSignal): Promise<UploadHostStatus> {
  let response: Response;
  try {
    const { authHeaders } = await import('./auth.ts');
    response = await fetch('/api/upload', { signal, cache: 'no-store', headers: authHeaders() });
  } catch {
    throw new Error(AUTH_FAILED);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || AUTH_FAILED);
  return {
    configured: Boolean(data.configured),
    label: String(data.label || 'OnlyFiles'),
    maxBytes: Number(data.limits?.maxBytes || 100 * 1000 * 1000),
  };
}

export async function prepareUpload(
  opts: { filename: string; contentType: string; size: number },
  signal?: AbortSignal
): Promise<PreparedUpload> {
  const data = await callUploadApi(
    { action: 'prepare', provider: 'onlyfiles', ...opts },
    signal
  );
  const endpoint = String(data.endpoint || '');
  if (!/^https:\/\//i.test(endpoint)) {
    throw new Error('Das Upload-Backend hat keine gültige Upload-Adresse geliefert.');
  }
  return {
    endpoint,
    fileField: String(data.fileField || 'file'),
    expire: String(data.expire ?? '0'),
    maxBytes: Number(data.maxBytes || 0),
    filename: String(data.filename || opts.filename),
  };
}

/** Browser-direct multipart POST with progress. */
function postMultipart(
  endpoint: string,
  form: FormData,
  signal: AbortSignal | undefined,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    // No manual Content-Type: the browser must set the multipart boundary itself.
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(`OnlyFiles hat HTTP ${xhr.status} gemeldet: ${xhr.responseText.slice(0, 180)}`));
    };
    xhr.onerror = () => reject(new Error('Direkter Upload zu OnlyFiles fehlgeschlagen (Netzwerk oder CORS).'));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen.', 'AbortError'));
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);
    xhr.send(form);
  });
}

/** Pull id, stored name and the host's own URLs out of the upload response. */
export function parseOnlyFilesResponse(raw: string): OnlyFilesUploadResult {
  let payload: {
    status?: boolean;
    error?: { message?: string };
    data?: {
      file?: {
        url?: { full?: string; short?: string };
        metadata?: { id?: string; name?: string };
      };
    };
  } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!payload || payload.status === false) {
    throw new Error(payload?.error?.message || `OnlyFiles hat den Upload abgelehnt: ${raw.slice(0, 180)}`);
  }
  const metadata = payload.data?.file?.metadata;
  const id = String(metadata?.id || '');
  if (!id) throw new Error('OnlyFiles hat keine Datei-ID zurückgegeben.');
  const fullUrl = String(payload.data?.file?.url?.full || '');
  const shortUrl = String(payload.data?.file?.url?.short || '');
  return { id, name: String(metadata?.name || ''), fullUrl, shortUrl };
}

/**
 * Candidate URLs in probe order:
 * 1. `/dl/{id}/{name}` — the direct-download shape (same operator as tmpfiles.org);
 * 2. `url.full` — the URL the API itself hands out (authoritative);
 * 3. `url.short` — id-only fallback, in case the stored name differs.
 */
export function onlyFilesCandidateUrls(result: OnlyFilesUploadResult, publicBase = 'https://onlyfiles.com'): string[] {
  const base = publicBase.replace(/\/$/, '');
  const candidates: string[] = [];
  const push = (value: string) => {
    if (/^https:\/\//i.test(value) && !candidates.includes(value)) candidates.push(value);
  };
  // The stored name is safest to take from the API's own full URL — the host
  // may normalize it (case, dashes) differently than our upload name.
  let storedName = result.name;
  if (result.fullUrl) {
    try {
      const segment = decodeURIComponent(new URL(result.fullUrl).pathname.split('/').pop() || '');
      if (segment && segment !== result.id && /\.[a-z0-9]+$/i.test(segment)) storedName = segment;
    } catch { /* keep metadata name */ }
  }
  if (result.id && storedName) push(`${base}/dl/${encodeURIComponent(result.id)}/${encodeURIComponent(storedName)}`);
  if (result.fullUrl) push(result.fullUrl);
  if (result.shortUrl) push(result.shortUrl);
  return candidates;
}

/** Content-type check shared by the fetch probe: real video bytes, never a page. */
export function contentTypeServesVideo(contentType: string | null | undefined): boolean {
  const type = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  return Boolean(type) && !/^text\/html/i.test(type)
    && (type.startsWith('video/') || type === 'application/octet-stream');
}

export interface VerificationProbes {
  fetchProbe?: (url: string, signal?: AbortSignal) => Promise<string | null | false>;
  videoProbe?: (url: string, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

/**
 * Prove a candidate URL serves decodable video to a normal client:
 * 1. byte-range fetch → exact content-type check (needs CORS on the host);
 * 2. a real <video> element — needs no CORS and is precisely how Buffer
 *    consumes the file. `loadedmetadata` = the URL points at playable bytes.
 */
export async function probeVideoUrl(
  url: string,
  signal: AbortSignal | undefined,
  probes: VerificationProbes = {}
): Promise<boolean> {
  if (signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError');

  if (probes.fetchProbe) {
    try {
      const contentType = await probes.fetchProbe(url, signal);
      if (contentType !== false && contentTypeServesVideo(contentType)) return true;
    } catch {
      /* CORS or network — fall through to the media probe */
    }
  }

  try {
    if (probes.videoProbe) {
      await probes.videoProbe(url, signal);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Default <video> element probe: resolves when metadata loads, rejects on error/timeout. */
export function videoElementProbe(url: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Kein DOM verfügbar.'));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException('Upload abgebrochen.', 'AbortError'));
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    video.style.display = 'none';
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      try { video.load(); } catch { /* detached */ }
      video.remove();
    };
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Kein direkt abspielbares Video an dieser Adresse.')); };
    const onAbort = () => { cleanup(); reject(new DOMException('Upload abgebrochen.', 'AbortError')); };
    const timer = setTimeout(onError, timeoutMs);
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    video.src = url;
    document.body.appendChild(video);
  });
}

/** Default byte-range probe. Resolves with the content-type, or false when the
 *  response clearly is not video; throws on CORS/network so the caller can
 *  fall back to the media probe. */
export async function fetchProbe(url: string, signal?: AbortSignal): Promise<string | null | false> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-4095', Accept: '*/*' },
    cache: 'no-store',
    signal,
  });
  try { response.body?.cancel?.(); } catch { /* already consumed */ }
  if (!(response.ok || response.status === 206)) return false;
  return response.headers.get('content-type');
}

/**
 * Verify the finished upload: walk the candidate URLs and return the first one
 * that really serves the video. Buffer only ever receives a verified URL.
 */
export async function verifyOnlyFilesUrl(
  candidates: string[],
  signal?: AbortSignal,
  probes: VerificationProbes = {}
): Promise<string> {
  for (const url of candidates) {
    if (await probeVideoUrl(url, signal, probes)) return url;
  }
  throw new Error(
    'OnlyFiles hat die Datei angenommen, aber keine der Adressen liefert das Video direkt aus. '
    + 'Bitte erneut versuchen — erst wenn eine Adresse das Video direkt ausliefert, geht etwas an Buffer.'
  );
}

/**
 * Upload one rendered video to OnlyFiles and return the permanent public URL
 * for Buffer. Every failure happens BEFORE anything is sent to Buffer.
 */
export async function uploadRenderFile(
  file: Blob,
  opts: {
    filename: string;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
    probes?: VerificationProbes;
  }
): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError');
  const contentType = opts.contentType.split(';', 1)[0].toLowerCase() || file.type || 'video/mp4';

  const prepared = await prepareUpload(
    { filename: opts.filename, contentType, size: file.size },
    opts.signal
  );
  if (prepared.maxBytes && file.size > prepared.maxBytes) {
    throw new Error(
      `OnlyFiles nimmt maximal ${Math.round(prepared.maxBytes / 1_000_000)} MB pro Datei an — dieses Video hat `
      + `${(file.size / 1_000_000).toFixed(1)} MB. Bitte Bitrate oder Auflösung in den Settings reduzieren. `
      + 'Es wurde nichts hochgeladen.'
    );
  }

  const form = new FormData();
  form.append(prepared.fileField, file, prepared.filename);
  form.append('expire', prepared.expire); // '0' = keep the file forever
  opts.onProgress?.({ loaded: 0, total: file.size });
  const raw = await postMultipart(prepared.endpoint, form, opts.signal, opts.onProgress);

  const result = parseOnlyFilesResponse(raw);
  const candidates = onlyFilesCandidateUrls(result);
  if (opts.signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError');
  opts.onProgress?.({ loaded: file.size, total: file.size });

  return verifyOnlyFilesUrl(candidates, opts.signal, opts.probes ?? { fetchProbe, videoProbe: videoElementProbe });
}
