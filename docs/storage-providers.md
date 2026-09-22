# Media hosting for Buffer — OnlyFiles (the one shipping route)

This is the setup runbook for the upload route in ShortsFactory 4. There is
exactly one route by design: anonymous **OnlyFiles** hosting, verified in the
browser before anything reaches Buffer. No account, no key, no bucket, no env
vars.

## Why a storage host is necessary

Buffer's API does **not** accept a binary file or a Node/browser `Buffer`.
`createPost` receives a media URL, and Buffer fetches that URL when the post is
published. The URL must be:

- HTTPS, direct, and publicly readable without a login;
- stable until the post publishes (can be hours or days later); and
- the file itself, not a dashboard, share-preview, redirect, or expiring signed URL.

The browser therefore transfers the video **directly** to OnlyFiles' public
API. The server (`/api/upload`) never receives video bytes — it only hands out
the endpoint plus the hard caps behind the password gate. This is why the app
does not send a video `Buffer` to Buffer: Buffer has no such upload endpoint.
It sends Buffer the permanent public URL after the upload and verification have
finished.

## How a dispatch upload works

1. **Prepare** — the browser asks `/api/upload` for the endpoint, the 100 MB
   cap and a sanitized filename. Nothing is uploaded yet.
2. **Upload** — the browser posts the Blob as `multipart/form-data` straight to
   `https://api.onlyfiles.com/v1/upload` with `expire=0` (kept forever; the API
   default would be 24 hours). The API answers with CORS `*` and returns
   `data.file.url.full`, `data.file.url.short` and `metadata.id/name`.
3. **Verify (in the browser)** — the client builds the candidate URLs
   (`/dl/{id}/{name}`, `url.full`, `url.short`) and proves that one of them
   really serves the video:
   - a byte-range `fetch` reading the content-type (when the host's CORS
     allows reading it), and
   - a real `<video>` element decoding the URL — no CORS needed, and exactly
     how Buffer consumes the file later.
4. **Dispatch** — only the first verified URL is handed to Buffer. If no
   candidate serves video bytes, the batch stops with a clear error and
   **nothing has been sent to Buffer**.

> **Why browser-side verification?** The previous design probed the URLs from
> the Vercel function. Datacenter-side requests to the host kept getting
> answered with HTML bot-challenge pages, so healthy uploads were rejected with
> "OnlyFiles hat die Datei angenommen, aber keine Adresse liefert das Video
> direkt aus". The browser probe cannot hit that failure mode and is a
> strictly stronger check (real decoding instead of a header sniff).

## Limits

| Limit | Value |
| --- | --- |
| Max file size | 100 MB per file |
| Files per hour / day | 500 / 5,000 |
| Volume per hour / day | 50 GB / 100 GB |
| Retention | kept forever (`expire=0`) |

100 MB is a hard limit per file. If a render is larger, reduce bitrate or
resolution in **Settings → VIDEO** (720p at a medium/low bitrate stays well
under the cap) and re-render.

## References

- [Buffer: Hosting media](https://developers.buffer.com/guides/hosting-media.html)
- [OnlyFiles API](https://onlyfiles.com/api) — `POST https://api.onlyfiles.com/v1/upload`,
  `expire=0` keeps forever, CORS `*`

## Local development

Nothing to configure. `npm run dev` serves the app plus the API routes
(`server/dev-api.ts`); the upload prepare route needs no credentials. Set
`SHORTSFACTORY_PASSWORD` (optional) and `BUFFER_API_KEY` (for real dispatch)
in `.env.local` — see `.env.example`.
