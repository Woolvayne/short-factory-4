/**
 * Upload adapters used before Buffer dispatch.
 *
 * Buffer only accepts stable public media URLs. R2 and B2 receive the Blob
 * directly from the browser through a short-lived, server-signed PUT URL.
 * Puter.js receives it in the browser and returns a readable public URL. The
 * Vercel function never receives video bytes and Vercel Blob is not involved.
 */
import { authHeaders } from './auth.ts';

export type UploadProvider = 'r2' | 'b2' | 'puter';

export interface ProviderStatus {
  provider: UploadProvider;
  label: string;
  description: string;
  setupUrl: string;
  mode: 'server' | 'browser';
  configured: boolean;
}

export interface UploadHostStatus {
  configured: boolean;
  provider: UploadProvider;
  providers: Record<UploadProvider, ProviderStatus>;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

const PROVIDER_KEY = 'shortsfactory.upload_provider.v1';
const PUTER_SCRIPT = 'https://js.puter.com/v2/';

type PuterApi = {
  fs: {
    write: (path: string, data: Blob) => Promise<{ path?: string } | void>;
    mkdir?: (path: string) => Promise<unknown>;
    getReadURL: (path: string) => Promise<string>;
  };
};

declare global {
  interface Window {
    puter?: PuterApi;
  }
}

export function loadUploadProvider(): UploadProvider {
  try {
    const value = localStorage.getItem(PROVIDER_KEY);
    return value === 'r2' || value === 'b2' || value === 'puter' ? value : 'puter';
  } catch {
    return 'puter';
  }
}

export function saveUploadProvider(provider: UploadProvider) {
  try { localStorage.setItem(PROVIDER_KEY, provider); } catch { /* private mode */ }
}

export function providerLabel(provider: UploadProvider): string {
  return provider === 'r2' ? 'Cloudflare R2' : provider === 'b2' ? 'Backblaze B2' : 'Puter.js';
}

export async function fetchUploadStatus(signal?: AbortSignal): Promise<UploadHostStatus> {
  const res = await fetch('/api/upload', { signal, cache: 'no-store', headers: authHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || 'Upload-Backend nicht erreichbar.');
  return {
    configured: Boolean(data.configured),
    provider: data.provider === 'r2' || data.provider === 'b2' || data.provider === 'puter' ? data.provider : 'puter',
    providers: data.providers as Record<UploadProvider, ProviderStatus>,
  };
}

async function prepareUpload(
  provider: UploadProvider,
  opts: { filename: string; contentType: string; size: number },
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action: 'prepare', provider, ...opts }),
      signal,
    });
  } catch {
    throw new Error('Upload-Backend nicht erreichbar.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    throw new Error(data?.error || `Upload-Vorbereitung fehlgeschlagen (HTTP ${response.status}).`);
  }
  return data as Record<string, unknown>;
}

function putToSignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  signal: AbortSignal | undefined,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size });
        resolve();
      } else {
        reject(new Error(`Der Upload-Provider hat HTTP ${xhr.status} gemeldet.`));
      }
    };
    xhr.onerror = () => reject(new Error('Direkter Upload fehlgeschlagen. Prüfe Bucket-CORS und die öffentliche Domain des Providers.'));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen.', 'AbortError'));
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });
}

let puterLoad: Promise<PuterApi> | null = null;

async function loadPuter(): Promise<PuterApi> {
  if (window.puter) return window.puter;
  if (!puterLoad) {
    puterLoad = new Promise<PuterApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${PUTER_SCRIPT}"]`);
      const script = existing || document.createElement('script');
      const done = () => window.puter ? resolve(window.puter) : reject(new Error('Puter.js wurde geladen, aber die API fehlt.'));
      const fail = () => reject(new Error('Puter.js konnte nicht geladen werden.'));
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', fail, { once: true });
      if (!existing) {
        script.src = PUTER_SCRIPT;
        script.async = true;
        document.head.appendChild(script);
      } else if (window.puter) {
        done();
      }
    }).catch(error => {
      puterLoad = null;
      throw error;
    });
  }
  return puterLoad;
}

async function uploadToPuter(
  file: Blob,
  opts: { filename: string; signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void }
): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError');
  const data = await prepareUpload('puter', { filename: opts.filename, contentType: file.type || 'video/mp4', size: file.size }, opts.signal);
  const key = String(data.key || '');
  if (!key) throw new Error('Puter-Pfad fehlt.');
  const puter = await loadPuter();
  // Puter paths are user files; create the lane if this is the first upload.
  if (puter.fs.mkdir) await puter.fs.mkdir('shortsfactory').catch(() => undefined);
  opts.onProgress?.({ loaded: 0, total: file.size });
  const saved = await puter.fs.write(key, file);
  if (opts.signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError');
  const publicUrl = await puter.fs.getReadURL(String(saved && typeof saved === 'object' && saved.path ? saved.path : key));
  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) throw new Error('Puter hat keine öffentliche HTTPS-Adresse geliefert.');
  opts.onProgress?.({ loaded: file.size, total: file.size });
  return publicUrl;
}

/** Upload one rendered video and return the permanent public URL for Buffer. */
export async function uploadRenderFile(
  file: Blob,
  opts: {
    provider: UploadProvider;
    filename: string;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  }
): Promise<string> {
  if (opts.provider === 'puter') {
    return uploadToPuter(file, { filename: opts.filename, signal: opts.signal, onProgress: opts.onProgress });
  }

  const data = await prepareUpload(opts.provider, {
    filename: opts.filename,
    contentType: opts.contentType.split(';', 1)[0].toLowerCase() || 'video/mp4',
    size: file.size,
  }, opts.signal);
  const uploadUrl = String(data.uploadUrl || '');
  const publicUrl = String(data.publicUrl || '');
  if (!uploadUrl || !publicUrl) throw new Error(`${providerLabel(opts.provider)} hat keine Upload-/Public-URL geliefert.`);
  try {
    await putToSignedUrl(uploadUrl, file, String(data.contentType || opts.contentType), opts.signal, opts.onProgress);
    return publicUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Es wurde noch nichts an Buffer gesendet.`);
  }
}
