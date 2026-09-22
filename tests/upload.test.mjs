import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { prepareOnlyFilesUpload, prepareUpload, uploadStatus } from '../api/upload.js';
import { validateVideoUrl } from '../shared/buffer.js';
import {
  contentTypeServesVideo,
  onlyFilesCandidateUrls,
  parseOnlyFilesResponse,
  verifyOnlyFilesUrl,
} from '../src/lib/uploader.ts';

const savedPassword = process.env.SHORTSFACTORY_PASSWORD;

beforeEach(() => { delete process.env.SHORTSFACTORY_PASSWORD; });
afterEach(() => {
  if (savedPassword === undefined) delete process.env.SHORTSFACTORY_PASSWORD;
  else process.env.SHORTSFACTORY_PASSWORD = savedPassword;
});

async function request(body, method = 'POST', headers = {}) {
  let status = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(data) { payload = data; return this; },
  };
  await handler({ method, headers, body }, response);
  return { status, payload };
}

test('GET exposes the single OnlyFiles route without credentials', async () => {
  const result = await request(undefined, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.payload.configured, true);
  assert.equal(result.payload.provider, 'onlyfiles');
  assert.equal(result.payload.label, 'OnlyFiles');
  assert.equal(result.payload.limits.maxBytes, 100_000_000);
  assert.equal(uploadStatus().provider, 'onlyfiles');
});

test('password protects upload status and prepare routes', async () => {
  process.env.SHORTSFACTORY_PASSWORD = 'correct horse';
  const denied = await request(undefined, 'GET');
  assert.equal(denied.status, 401);
  assert.equal(denied.payload.code, 'auth_required');
  const allowed = await request(undefined, 'GET', { 'x-sf-password': 'correct horse' });
  assert.equal(allowed.status, 200);
  const prepared = await request(
    { action: 'prepare', provider: 'onlyfiles', filename: 'a.mp4', contentType: 'video/mp4', size: 1024 },
    'POST',
    { 'x-sf-password': 'correct horse' }
  );
  assert.equal(prepared.status, 200);
});

test('OnlyFiles preparation is credential-free and enforces the hard caps', () => {
  const ok = prepareOnlyFilesUpload({ filename: 'clip.mp4', contentType: 'video/mp4', size: 50_000_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.provider, 'onlyfiles');
  assert.match(ok.endpoint, /^https:\/\/api\.onlyfiles\.com\//);
  assert.equal(ok.fileField, 'file');
  assert.equal(ok.expire, '0');
  assert.equal(ok.maxBytes, 100_000_000);
  assert.equal(ok.filename, 'clip.mp4');

  assert.throws(
    () => prepareOnlyFilesUpload({ filename: 'big.mp4', contentType: 'video/mp4', size: 150_000_000 }),
    /100 MB/
  );
  assert.throws(
    () => prepareOnlyFilesUpload({ filename: 'huge.mp4', contentType: 'video/mp4', size: 6 * 1024 * 1024 * 1024 }),
    /5 GiB/
  );
  assert.throws(
    () => prepareOnlyFilesUpload({ filename: 'a.mov', contentType: 'video/quicktime', size: 1 }),
    /MP4- oder WebM/
  );
  const cleaned = prepareOnlyFilesUpload({ filename: '../my video?.mp4', contentType: 'video/webm;codecs=vp9', size: 1 });
  assert.equal(cleaned.filename, 'my-video_.mp4');
  assert.equal(cleaned.contentType, 'video/webm');
});

test('prepare rejects every provider other than OnlyFiles, and verify is gone', async () => {
  await assert.rejects(() => prepareUpload({ provider: 'r2', filename: 'a.mp4', contentType: 'video/mp4', size: 1 }), /genau einen Versandweg/);
  await assert.rejects(() => prepareUpload({ provider: 'puter', filename: 'a.mp4', contentType: 'video/mp4', size: 1 }), /genau einen Versandweg/);
  const verifyGone = await request({ action: 'verify', provider: 'onlyfiles', id: 'abc123', filename: 'a.mp4' });
  assert.equal(verifyGone.status, 410);
  assert.equal((await request(undefined, 'PUT')).status, 405);
  assert.equal((await request({ action: 'prepare', provider: 'onlyfiles', filename: 'a.mp4', contentType: 'video/mp4' }, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request({ action: 'nope' })).status, 400);
});

test('OnlyFiles response parsing pulls id, name and the host-owned URLs', () => {
  const docsExample = JSON.stringify({
    status: true,
    data: {
      file: {
        url: { full: 'https://onlyfiles.com/wswdwDwVA4DT/test.txt', short: 'https://onlyfiles.com/wswdwDwVA4DT' },
        metadata: { id: 'wswdwDwVA4DT', name: 'test.txt', size: { bytes: 6861 } },
      },
    },
  });
  const parsed = parseOnlyFilesResponse(docsExample);
  assert.equal(parsed.id, 'wswdwDwVA4DT');
  assert.equal(parsed.name, 'test.txt');
  assert.equal(parsed.fullUrl, 'https://onlyfiles.com/wswdwDwVA4DT/test.txt');
  assert.equal(parsed.shortUrl, 'https://onlyfiles.com/wswdwDwVA4DT');

  assert.throws(() => parseOnlyFilesResponse('{"status":false,"error":{"message":"The file is too large. Max filesize: 100 MB"}}'), /too large/);
  assert.throws(() => parseOnlyFilesResponse('not json at all'), /abgelehnt|Unexpected|JSON/i);
  assert.throws(() => parseOnlyFilesResponse('{"status":true,"data":{"file":{"metadata":{}}}}'), /keine Datei-ID/);
});

test('candidate URLs probe /dl/ first, then the API-provided URLs, deduplicated', () => {
  const candidates = onlyFilesCandidateUrls({
    id: 'abc123',
    name: 'my video.mp4',
    fullUrl: 'https://onlyfiles.com/abc123/my-video.mp4',
    shortUrl: 'https://onlyfiles.com/abc123',
  });
  assert.deepEqual(candidates, [
    'https://onlyfiles.com/dl/abc123/my-video.mp4',
    'https://onlyfiles.com/abc123/my-video.mp4',
    'https://onlyfiles.com/abc123',
  ]);
  // identical URLs collapse; a missing stored name skips the /dl/ shape
  const deduped = onlyFilesCandidateUrls({
    id: 'abc123', name: 'x.mp4',
    fullUrl: 'https://onlyfiles.com/dl/abc123/x.mp4',
    shortUrl: '',
  });
  assert.deepEqual(deduped, ['https://onlyfiles.com/dl/abc123/x.mp4']);
  const noName = onlyFilesCandidateUrls({ id: 'abc123', name: '', fullUrl: '', shortUrl: 'https://onlyfiles.com/abc123' });
  assert.deepEqual(noName, ['https://onlyfiles.com/abc123']);
});

test('content-type gate: real video bytes pass, pages never do', () => {
  assert.equal(contentTypeServesVideo('video/mp4'), true);
  assert.equal(contentTypeServesVideo('video/webm; charset=utf-8'), true);
  assert.equal(contentTypeServesVideo('application/octet-stream'), true);
  assert.equal(contentTypeServesVideo('text/html; charset=utf-8'), false);
  assert.equal(contentTypeServesVideo('text/html'), false);
  assert.equal(contentTypeServesVideo(''), false);
  assert.equal(contentTypeServesVideo(null), false);
});

test('verification returns the first URL that serves real video — never a page', async () => {
  const candidates = [
    'https://onlyfiles.com/dl/abc123/clip.mp4',
    'https://onlyfiles.com/abc123/clip.mp4',
  ];

  const videoServing = { fetchProbe: async () => 'video/mp4', videoProbe: async () => { throw new Error('should not run'); } };
  assert.equal(await verifyOnlyFilesUrl(candidates, undefined, videoServing), candidates[0]);

  // Cloudflare-style HTML challenge on every candidate → media probe decides
  const challengedButPlayable = {
    fetchProbe: async () => false,
    videoProbe: async (url) => { if (url === candidates[1]) return; throw new Error('nope'); },
  };
  assert.equal(await verifyOnlyFilesUrl(candidates, undefined, challengedButPlayable), candidates[1]);

  const htmlOnly = {
    fetchProbe: async () => 'text/html',
    videoProbe: async () => { throw new Error('no video'); },
  };
  await assert.rejects(() => verifyOnlyFilesUrl(candidates, undefined, htmlOnly), /keine der Adressen/);

  const unreachable = {
    fetchProbe: async () => { throw new Error('CORS'); },
    videoProbe: async () => { throw new Error('net down'); },
  };
  await assert.rejects(() => verifyOnlyFilesUrl(candidates, undefined, unreachable), /keine der Adressen/);
});

test('route hygiene: only public onlyfiles.com URLs pass video validation', () => {
  assert.equal(validateVideoUrl('https://onlyfiles.com/dl/abc123/clip.mp4'), '');
  assert.equal(validateVideoUrl('https://onlyfiles.com/abc123/clip.mp4'), '');
  assert.ok(validateVideoUrl('blob:https://example.com/123'));
  assert.ok(validateVideoUrl('https://onlyfiles.com/abc123/clip.mp4?token=secret'));
});
