/**
 * One-time-configured upload host: the browser signs a presigned PUT via
 * /api/upload, then streams the rendered video straight into the user's own
 * S3-compatible bucket (Cloudflare R2 / Backblaze B2 / AWS S3 / MinIO).
 * The video never passes through this app's server. The returned permanent
 * public URL is what Buffer receives — no manual link entry ever again.
 */

export interface UploadHostStatus {
  configured: boolean;
  kind?: string;
  bucket?: string | null;
  publicBase?: string | null;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

export async function fetchUploadStatus(signal?: AbortSignal): Promise<UploadHostStatus> {
  const res = await fetch('/api/upload', { signal });
  if (!res.ok) throw new Error('Upload-Backend nicht erreichbar.');
  const data = await res.json();
  return {
    configured: Boolean(data?.configured),
    kind: data?.kind,
    bucket: data?.bucket ?? null,
    publicBase: data?.publicBase ?? null,
  };
}

interface SignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export async function signUpload(
  filename: string,
  contentType: string,
  size: number,
  signal?: AbortSignal
): Promise<SignResponse> {
  let res: Response;
  try {
    res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign', filename, contentType, size }),
      signal,
    });
  } catch {
    throw new Error('Upload-Host nicht erreichbar. Es wurde nichts hochgeladen.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.uploadUrl || !data?.publicUrl) {
    throw new Error(data?.error || `Upload-Signatur fehlgeschlagen (HTTP ${res.status}).`);
  }
  return data as SignResponse;
}

/**
 * Sign + PUT one rendered video to the bucket. Resolves with the permanent
 * public URL; the PUT result must be a 2xx before anything is sent to Buffer.
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
  const { uploadUrl, publicUrl } = await signUpload(opts.filename, opts.contentType, file.size, opts.signal);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    // content-type is part of the presigned signature — send exactly what was signed.
    xhr.setRequestHeader('Content-Type', opts.contentType.toLowerCase());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload-Host hat HTTP ${xhr.status} gemeldet. Es wurde nichts an Buffer gesendet.`));
    };
    xhr.onerror = () =>
      reject(new Error('Upload fehlgeschlagen — prüfe die CORS-Freigabe (PUT) des Buckets und die Erreichbarkeit des Hosts.'));
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen.', 'AbortError'));
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => opts.signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });

  return publicUrl;
}
