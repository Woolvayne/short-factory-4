# Storage providers for Buffer media

This is the setup runbook for the four upload adapters in ShortsFactory 4.
Choose one in the **BUFFER DISPATCH** window. You can configure all four and
switch between them; the choice is remembered in this browser.

## Why a storage host is necessary

Buffer's API does **not** accept a binary file or a Node/browser `Buffer`.
`createPost` receives a media URL, and Buffer fetches that URL when the post is
published. The URL must be:

- HTTPS, direct, and publicly readable without a login;
- stable until the post publishes; and
- the file itself, not a dashboard, share-preview, redirect, or expiring signed URL.

The app therefore asks its server only for a short-lived upload authorization
for R2/B2. The browser transfers the video directly to the provider. The
short-lived PUT URL is never sent to Buffer. Puter is entirely browser-side.
OnlyFiles is also browser-direct: its public API answers with `access-control-allow-origin: *`,
so the browser posts the file itself and the server only verifies which URL
really serves the video.

This is why the app does not send a video `Buffer` to Buffer: Buffer has no such
upload endpoint. It sends Buffer the permanent public URL after the upload has
finished.

## Recommendation at a glance

| Provider | Capacity / transfer position | Best for | Caveat |
| --- | --- | --- | --- |
| **OnlyFiles** | Free, anonymous, no account, no API key, no bucket. 100 MB per file, 500 files / 50 GB per hour and 5,000 / 100 GB per day — unlimited number of files overall if you stay inside the hourly/daily caps. `expire=0` keeps the file forever. API is CORS-enabled. | Zero-setup: the answer to "kostenlos, unendlich viele Dateien, kein Konto, nichts einrichten". | 100 MB hard limit per file. For longer 1080p renders, reduce bitrate/quality in Settings or use R2/B2/Puter. |
| **Cloudflare R2** | Unlimited data storage per bucket; Internet egress has no per-GB charge. The free tier is 10 GB-month plus request allowances, then pay for storage/operations. | Production and high delivery volume; recommended when you need >100 MB files. | A public custom domain is recommended. The managed `r2.dev` endpoint is rate-limited and intended for testing. |
| **Backblaze B2** | Starts at $6.95/TB/month; first 10 GB storage free; free egress up to 3× average monthly stored data, then $0.01/GB unless a CDN/compute partner route applies. | Low-cost S3-compatible storage and archive. | To cover 100 GB/month inside the standard allowance, keep roughly 34 GB or more stored on average, or accept the small overage. |
| **Puter.js** | Puter advertises free/unlimited object storage tutorials and a user-pays model. Its docs also describe a free monthly allowance and upgrades after that allowance, not a contractual 100 GB/month quota. | One operator who wants no server credentials or bucket setup but larger files than 100 MB. | Treat it as a convenience/personal option, not a guaranteed 100 GB production SLA. Its account must remain active and the returned URL must work anonymously. |

**Bottom line:** **OnlyFiles** is the only adapter that matches all four
requirements at once — kostenlos, kein Konto, nichts einzurichten, unbegrenzt
viele Dateien (inside the generous hourly/daily quotas) — with a 100 MB per-file
cap. For >100 MB files, Cloudflare R2 is the closest match to “100 GB or unlimited”
for this use case. B2 is a very good inexpensive alternative. Puter is the
answer to the “Putter?” idea (the service is spelled **Puter**) and is fully
implemented.

Official references:

- [Buffer: Hosting media](https://developers.buffer.com/guides/hosting-media.html)
- [OnlyFiles API](https://onlyfiles.com/api) — `POST https://api.onlyfiles.com/v1/upload`, `expire=0` keeps forever, CORS `*` verified live 2026-09-22
- [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 browser CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- [B2 S3-compatible API and presigned URLs](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Puter Cloud Storage](https://docs.puter.com/FS/)
- [Puter User-Pays Model](https://docs.puter.com/user-pays-model/)

## 0. Common setup

### Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Only the variables for the provider(s) you want to use need to be filled in.
Restart `npm run dev` after changing `.env.local`; Vite copies server-only
values into the local API middleware at startup.

OnlyFiles needs **no** env vars at all — just `npm run dev` and open the dispatch
window; the **OnlyFiles** card says `bereit` immediately.

### Vercel

Open **Project → Settings → Environment Variables**, add the server variables
below for the desired environments, and redeploy. Do not use `VITE_` for any
secret. The browser only receives a provider status and a signed upload URL;
access keys never enter the JavaScript bundle.

Also set:

```text
BUFFER_API_KEY=...
SHORTSFACTORY_PASSWORD=use-a-long-random-password
STORAGE_PROVIDER=onlyfiles
```

`STORAGE_PROVIDER` may be `onlyfiles`, `r2`, `b2`, or `puter`; it chooses the initial card.
The dispatch window can switch to any other provider that is configured. When nothing
is configured, the app defaults to `onlyfiles`.

## 0a. OnlyFiles — zero-setup anonymous (default)

OnlyFiles is a free anonymous file host whose upload API is CORS-enabled
(`access-control-allow-origin: *`), so the browser can POST the Blob directly
to `https://api.onlyfiles.com/v1/upload`. No account, no API key, no bucket.

Limits (from https://onlyfiles.com/api):

- Max 100 MB per file
- Max 500 files or 50 GB per hour
- Max 5,000 files or 100 GB per day
- `expire` may be `0` to keep forever (default 24h is 86400)

Flow:

1. Browser asks same-origin `/api/upload` with `action=prepare, provider=onlyfiles` —
   the server only checks that the mime is `video/mp4` or `video/webm` and that the
   file is ≤100 MB, then returns the endpoint and `expire=0`.
2. Browser POSTs the Blob as `multipart/form-data` (`file` + `expire=0`) straight to
   OnlyFiles with XHR progress.
3. OnlyFiles returns `{ status: true, data: { file: { metadata: { id, name } } } }`.
4. Browser asks same-origin `/api/upload` with `action=verify, provider=onlyfiles, id, filename` —
   the server rebuilds only `https://onlyfiles.com/dl/{id}/{name}` and
   `https://onlyfiles.com/{id}/{name}` from the validated id (no client-supplied URL,
   so no SSRF), probes them with a `Range: bytes=0-4095` GET, and returns the first URL
   that answers with `video/*` or `application/octet-stream` instead of `text/html`.
   That verified URL is what Buffer receives.

If a rendered video is >100 MB, the prepare step fails with a German hint to reduce
bitrate/resolution in **Settings → VIDEO** or switch to R2/B2/Puter. The app has a
separate 5 GiB ceiling for S3-compatible direct uploads.

## 1. Cloudflare R2 (recommended for >100 MB)

### Create the bucket and keys

1. Cloudflare Dashboard → **R2 Object Storage** → create a bucket, for
   example `shortsfactory-media`.
2. In R2, create an API token scoped to that bucket with **Object Read & Write**
   access. Copy the access key ID and secret access key once.
3. For production, connect a custom domain to the bucket under **Settings →
   Domain access**. Enable public read access. The value for
   `R2_PUBLIC_BASE_URL` is that HTTPS origin only, for example
   `https://media.example.com`.
4. Managed `r2.dev` public access is fine for a first test, but Cloudflare
   documents that it is rate-limited. Prefer a custom domain for publishing.

### Configure browser CORS

Presigned URLs authenticate the PUT, but browsers still require bucket CORS.
In the R2 bucket’s CORS policy, replace the origins with the exact Vercel
production origin and local origin:

```json
[
  {
    "AllowedOrigins": [
      "https://your-project.vercel.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Do not leave `AllowedOrigins` as `*` in a production bucket. The public read
domain is intentionally public because Buffer must fetch it without logging in;
the S3 endpoint and write keys remain private.

### Environment variables

```text
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=shortsfactory-media
R2_PUBLIC_BASE_URL=https://media.example.com
```

After redeploying, open the dispatch window. The **Cloudflare R2** card should
say `bereit`. A test upload creates a key below `shortsfactory/`, signs a PUT
for 15 minutes, and then Buffer receives the stable custom-domain URL.

## 2. Backblaze B2

### Create the bucket and application key

1. Backblaze Console → **B2 Cloud Storage → Buckets → Create a Bucket**.
2. Set the bucket to **Public**. A private bucket cannot give Buffer an
   anonymous stable URL. For stronger URL control, put a public CDN/custom
   domain in front of the public bucket.
3. Create an application key restricted to this bucket with read/write access.
   Do not use the master application key.
4. On the bucket page, copy its S3 endpoint. It looks like
   `https://s3.eu-central-003.backblazeb2.com`. The region is the segment after
   `s3.` (`eu-central-003` in this example).
5. The default public B2 URL is typically
   `https://f000.backblazeb2.com/file/BUCKET_NAME`. Use the actual file-host
   shown by your account, or use your own public CDN domain.

### Configure CORS

For the S3-compatible API, create `cors.json` and apply it with the AWS CLI:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://your-project.vercel.app",
        "http://localhost:5173"
      ],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

```bash
aws s3api put-bucket-cors \
  --bucket shortsfactory-media \
  --cors-configuration file://cors.json \
  --endpoint-url https://s3.eu-central-003.backblazeb2.com
```

The B2 bucket must still be public for Buffer’s later anonymous GET. B2
supports AWS SigV4 presigned upload URLs; ShortsFactory uses exactly that S3
compatibility layer.

### Environment variables

```text
STORAGE_PROVIDER=b2
B2_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
B2_S3_REGION=eu-central-003
B2_KEY_ID=...
B2_APPLICATION_KEY=...
B2_BUCKET_NAME=shortsfactory-media
B2_PUBLIC_BASE_URL=https://f000.backblazeb2.com/file/shortsfactory-media
```

`B2_S3_REGION` can be omitted; the API route derives it from the endpoint.
Keep `B2_PUBLIC_BASE_URL` free of a trailing slash. It is not the S3 endpoint;
it is the anonymous download origin.

## 3. Puter.js (the “Putter” option)

Puter.js is implemented as a browser adapter. The app dynamically loads
`https://js.puter.com/v2/`, calls `puter.fs.write(path, file)` for the rendered
Blob, and calls `puter.fs.getReadURL(path)` for the URL passed to Buffer. No
Puter API key or server env variable is needed.

1. Leave the R2/B2 variables empty if Puter is the only provider.
2. Set `STORAGE_PROVIDER=puter` (optional; the UI defaults to OnlyFiles when no
   server provider is configured, but Puter is still `bereit`).
3. Open the dispatch window and choose **Puter.js**.
4. On the first upload, complete the Puter sign-in/authorization popup.
5. Open the returned URL in a private browser window. It must play/download
   without a Puter login. If it does not, do not send the post; use R2 or B2.

Puter’s User-Pays model makes it attractive for a personal operator: the
account using the app bears its own storage and bandwidth use. The docs do not
promise a fixed 100 GB/month quota or uptime SLA, so keep R2/B2 configured as a
fallback for important scheduled posts. Deleting or losing access to the Puter
account also breaks old Buffer URLs.

## 4. Dispatch and troubleshooting

The upload sequence is deliberately fail-closed:

1. Prepare every selected render one at a time.
2. Upload to the chosen provider with progress.
3. Stop immediately if any upload fails or is cancelled.
4. Only after all URLs are public and stable, call Buffer sequentially.

A failed upload therefore sends **nothing** to Buffer. A Buffer transport error
is marked uncertain and the journal tells you to check Buffer before retrying;
this prevents accidental duplicate posts.

| Symptom | Fix |
| --- | --- |
| Provider card is `nicht konfiguriert` | Check all required variables, remove `VITE_`, restart/redeploy, then reload the page. OnlyFiles and Puter need no env vars. |
| PUT returns CORS/network error | Add the exact app origin to the bucket CORS rule, including `http://localhost:5173` for local use. Do not add a path or trailing slash. OnlyFiles does not need bucket CORS — its API already returns `*`. |
| Upload succeeds but Buffer cannot fetch media | Make the public bucket/domain readable without login; test the exact URL in an incognito window. For OnlyFiles, the server verify step already guarantees the URL serves video bytes, not HTML. |
| Presigned URL returns 403 | The upload URL expired, or the browser sent a different `Content-Type`. Retry so the app creates a fresh 15-minute URL. |
| B2 URL is a preview or 404 | `B2_PUBLIC_BASE_URL` must be the file origin (`.../file/BUCKET`), not the dashboard or S3 API endpoint. |
| Puter asks for login repeatedly | Complete the Puter authorization in the same tab, or switch to R2/B2/OnlyFiles for a server-configured or zero-setup host. |
| OnlyFiles rejects with 100 MB | Reduce bitrate/resolution in **Settings → VIDEO** (e.g. 720p med/low, 30 fps) or switch to R2/B2/Puter. |
| Scheduled post fails hours later | Do not delete the object or use an expiring URL. Buffer fetches when it publishes, not only when the post is created. OnlyFiles `expire=0` is permanent. |

## 5. Password protection

Set `SHORTSFACTORY_PASSWORD` on the server. The browser first calls `/api/auth`
to learn whether the gate is enabled, and then submits the password once for
that page lifetime. The password is held only in JavaScript memory and is sent
to same-origin API routes over HTTPS as `x-sf-password`. A reload creates a new
page context, so the form appears again. `api/auth`, `api/upload`, `api/buffer`,
and `api/tts` never accept protected requests without the correct password.

This is a single-operator gate, not a multi-user account system. Use Vercel
HTTPS and a strong random password. Never put it in a `VITE_` variable or in
`localStorage`.
