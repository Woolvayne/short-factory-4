import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import handler, { uploadEnv, uploadHostConfigured, presignPut, buildUploadTarget, sanitizeFileName, providerOf, validateIaItem } from '../api/upload.js';
import { validateVideoUrl } from '../shared/buffer.js';

const ENV_KEYS = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_PUBLIC_BASE_URL'];
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setEnv(over = {}) {
  const base = {
    S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret-key', S3_BUCKET: 'shorts-bucket',
    S3_REGION: '', S3_ENDPOINT: '', S3_PUBLIC_BASE_URL: '', ...over,
  };
  for (const k of ENV_KEYS) process.env[k] = base[k] ?? saved[k] ?? '';
}
beforeEach(() => setEnv());
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** Freeze the clock so SigV4 output becomes directly comparable. */
function withFixedTime(iso, fn) {
  const fixed = new Date(iso);
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed.getTime(); }
  };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}

async function request(body, method = 'POST', headers = {}, url = '/api/upload') {
  let status = 200, payload;
  const response = { setHeader() {}, status(code) { status = code; return this; }, json(data) { payload = data; if (status >= 400 && process.env.DBG) console.error('DBG', status, JSON.stringify(data)); } };
  await handler({ method, headers, body, url }, response);
  return { status, payload };
}

test('upload host counts as configured only with all three credentials', () => {
  assert.equal(uploadHostConfigured(uploadEnv()), true);
  setEnv({ S3_SECRET_ACCESS_KEY: '' });
  assert.equal(uploadHostConfigured(uploadEnv()), false);
});

test('GET reports configuration without ever leaking secrets', async () => {
  const ok = await request(undefined, 'GET');
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.configured, true);
  assert.equal(ok.payload.bucket, 'shorts-bucket');
  assert.equal(ok.payload.publicBase, 'https://shorts-bucket.s3.auto.amazonaws.com');
  assert.ok(!JSON.stringify(ok.payload).includes('secret-key'));
  setEnv({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '', S3_BUCKET: '' });
  const off = await request(undefined, 'GET');
  assert.equal(off.payload.configured, false);
  assert.equal(off.payload.bucket, null);
});

test('signing is refused without configuration and never simulated', async () => {
  setEnv({ S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' });
  const res = await request({ action: 'sign', filename: 'a.mp4', contentType: 'video/mp4', size: 10 });
  assert.equal(res.status, 503);
  assert.equal(res.payload.uncertain, false);
  assert.match(res.payload.error, /S3_ACCESS_KEY_ID/);
});

test('presigned PUT is correct AWS SigV4 — verified against an independent computation', () => {
  const params = {
    host: 'shorts-bucket.s3.eu-central-1.amazonaws.com',
    canonicalUri: '/shortsfactory/20260920/vid.mp4',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key',
    region: 'eu-central-1', contentType: 'video/mp4',
  };
  const url = withFixedTime('2026-09-20T12:34:56Z', () => presignPut(params));
  const u = new URL(url);
  assert.equal(u.host, params.host);
  assert.equal(u.pathname, params.canonicalUri);
  assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(u.searchParams.get('X-Amz-Date'), '20260920T123456Z');
  assert.match(u.searchParams.get('X-Amz-Credential'), /^AKIDEXAMPLE\/20260920\/eu-central-1\/s3\/aws4_request$/);
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host');
  const amzDate = '20260920T123456Z';
  const scope = `20260920/eu-central-1/s3/aws4_request`;
  const query = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(`AKIDEXAMPLE/${scope}`)}&X-Amz-Date=${amzDate}&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost`;
  const canonicalRequest = ['PUT', params.canonicalUri, query, `content-type:video/mp4\nhost:${params.host}`, '', 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const k = (key, data) => createHmac('sha256', key).update(data).digest();
  const signingKey = k(k(k(k(`AWS4${params.secretAccessKey}`, '20260920'), 'eu-central-1'), 's3'), 'aws4_request');
  const expected = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  assert.equal(u.searchParams.get('X-Amz-Signature'), expected);
});

test('public URL derivation: AWS, B2 friendly URL, R2 requires explicit public base', () => {
  const aws = buildUploadTarget({ filename: 'v.mp4', contentType: 'video/mp4', size: 5 });
  assert.match(aws.publicUrl, /^https:\/\/shorts-bucket\.s3\.auto\.amazonaws\.com\/shortsfactory\//);
  assert.equal(validateVideoUrl(aws.publicUrl), '');

  setEnv({ S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', S3_REGION: 'us-west-004' });
  const b2 = buildUploadTarget({ filename: 'v.mp4', contentType: 'video/mp4', size: 5 });
  assert.match(b2.publicUrl, /^https:\/\/f004\.us-west-004\.backblazeb2\.com\/file\/shorts-bucket\/shortsfactory\//);
  assert.match(b2.uploadUrl, /^https:\/\/s3\.us-west-004\.backblazeb2\.com\/shorts-bucket\/shortsfactory\//);
  assert.equal(validateVideoUrl(b2.publicUrl), '');

  setEnv({ S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com', S3_REGION: 'auto' });
  assert.throws(() => buildUploadTarget({ filename: 'v.mp4', contentType: 'video/mp4', size: 5 }), /S3_PUBLIC_BASE_URL/);

  setEnv({ S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com', S3_REGION: 'auto', S3_PUBLIC_BASE_URL: 'https://pub-abc.r2.dev' });
  const r2 = buildUploadTarget({ filename: 'v.mp4', contentType: 'video/mp4', size: 5 });
  assert.match(r2.publicUrl, /^https:\/\/pub-abc\.r2\.dev\/shortsfactory\//);
  assert.match(r2.uploadUrl, /^https:\/\/abc123\.r2\.cloudflarestorage\.com\/shorts-bucket\/shortsfactory\//);
  assert.equal(validateVideoUrl(r2.publicUrl), '');
});

test('object keys stay inside shortsfactory/, sanitized and collision-safe', () => {
  assert.equal(sanitizeFileName('../../evil path/My Video (1).mp4'), 'My-Video-_1_.mp4');
  assert.equal(sanitizeFileName(''), 'video.mp4');
  assert.equal(sanitizeFileName('no-extension'), 'no-extension.mp4');
  const a = buildUploadTarget({ filename: 'shortsfactory_01.mp4', contentType: 'video/mp4', size: 5 });
  const b = buildUploadTarget({ filename: 'shortsfactory_01.mp4', contentType: 'video/mp4', size: 5 });
  assert.notEqual(a.key, b.key);
  assert.ok(!a.key.includes('..') && !a.key.includes(' '));
  assert.ok(a.key.startsWith('shortsfactory/'));
});

test('sign endpoint validates input and returns upload + public URL', async () => {
  const res = await request({ action: 'sign', filename: 'clip.mp4', contentType: 'video/mp4', size: 1234567 });
  assert.equal(res.status, 200);
  assert.match(res.payload.uploadUrl, /^https:\/\/shorts-bucket\.s3\.auto\.amazonaws\.com\/shortsfactory\//);
  assert.match(res.payload.publicUrl, /^https:\/\/shorts-bucket\.s3\.auto\.amazonaws\.com\/shortsfactory\//);
  assert.match(new URL(res.payload.uploadUrl).searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
  for (const bad of [
    { action: 'sign', filename: 'a.mp4', contentType: 'video/mp4', size: 0 },
    { action: 'sign', filename: 'a.mp4', contentType: 'video/mp4', size: 3 * 1024 * 1024 * 1024 },
    { action: 'sign', filename: 'a.mp4', contentType: 'image/png', size: 10 },
    { action: 'sign', filename: 'a.mp4', contentType: 'video/mp4' },
  ]) assert.equal((await request(bad)).status >= 400, true, JSON.stringify(bad));
});

test('cross-site requests and unknown actions are rejected', async () => {
  assert.equal((await request({ action: 'sign' }, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request({ action: 'nope' })).status, 400);
});

/* ---------------- Internet Archive provider (free, no caps) ---------------- */

const IA_ENV = { S3_ENDPOINT: 'https://s3.us.archive.org', S3_BUCKET: 'shortsfactory-videos' };
const IA_KEY = '20260920-20260920T091223Z-deadbeef-My-Video.mp4';

test('IA: provider detection via S3_ENDPOINT and item-name validation', () => {
  setEnv(IA_ENV);
  assert.equal(providerOf(uploadEnv()), 'ia');
  setEnv({ S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' });
  assert.equal(providerOf(uploadEnv()), 's3');
  setEnv({ S3_ENDPOINT: '' });
  assert.equal(providerOf(uploadEnv()), 's3');
  assert.ok(validateIaItem('ab'));
  assert.ok(validateIaItem('has--double'));
  assert.ok(validateIaItem('mit leer'));
  assert.ok(validateIaItem('-startsWithDash'));
  assert.equal(validateIaItem('shortsfactory-videos'), '');
});

test('IA: GET status reports provider and derived download base without secrets', async () => {
  setEnv(IA_ENV);
  const status = await request(undefined, 'GET');
  assert.equal(status.payload.provider, 'ia');
  assert.equal(status.payload.configured, true);
  assert.equal(status.payload.publicBase, 'https://archive.org/download/shortsfactory-videos');
  assert.ok(!JSON.stringify(status.payload).includes('secret-key'));
});

test('IA: sign starts the multipart upload, returns flat key, URLs and part size', async () => {
  setEnv(IA_ENV);
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response('<InitiateMultipartUploadResult><UploadId>ia-upload-id-1</UploadId></InitiateMultipartUploadResult>', { status: 200 });
  };
  const res = await request({ action: 'sign', filename: 'My Video.mp4', contentType: 'video/mp4', size: 50 * 1024 * 1024 });
  assert.equal(res.status, 200);
  assert.equal(res.payload.provider, 'ia');
  assert.equal(res.payload.uploadId, 'ia-upload-id-1');
  assert.equal(res.payload.partSize, 4 * 1024 * 1024);
  assert.ok(!res.payload.key.includes('/'));
  assert.match(res.payload.key, /^\d{8}-\d{8}T\d{6}Z-[0-9a-f]{8}-My-Video\.mp4$/);
  assert.match(res.payload.publicUrl, /^https:\/\/archive\.org\/download\/shortsfactory-videos\/\d{8}-\d{8}T\d{6}Z-[0-9a-f]{8}-My-Video\.mp4$/);
  assert.equal(validateVideoUrl(res.payload.publicUrl), '');
  const call = calls[0];
  assert.ok(call.url.startsWith('https://s3.us.archive.org/shortsfactory-videos/'));
  assert.ok(call.url.endsWith('?uploads'));
  assert.equal(call.opts.headers.Authorization, 'LOW AKIDEXAMPLE:secret-key');
  assert.equal(call.opts.headers['x-archive-auto-make-bucket'], '1');
  assert.equal(call.opts.headers['x-archive-interactive-priority'], '1');
  assert.equal(call.opts.headers['x-archive-meta-mediatype'], 'movies');
  assert.equal(call.opts.headers['x-archive-size-hint'], String(50 * 1024 * 1024));
  assert.ok(!JSON.stringify(res.payload).includes('secret-key'));
});

test('IA: failed init surfaces IA errors instead of pretending success', async () => {
  setEnv(IA_ENV);
  globalThis.fetch = async () => new Response('SlowDown', { status: 503 });
  const res = await request({ action: 'sign', filename: 'v.mp4', contentType: 'video/mp4', size: 10 });
  assert.equal(res.status, 503);
  assert.match(res.payload.error, /überlastet|SlowDown/);
  globalThis.fetch = async () => new Response('<NoUploadId/>', { status: 200 });
  const res2 = await request({ action: 'sign', filename: 'v.mp4', contentType: 'video/mp4', size: 10 });
  assert.equal(res2.status, 502);
});

test('IA: part upload relays the binary chunk with auth and returns the etag', async () => {
  setEnv(IA_ENV);
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), opts });
    return new Response('', { status: 200, headers: { etag: '"etag-1"' } });
  };
  const chunk = Buffer.from('chunk-bytes-here');
  const res = await request(chunk, 'POST', { 'content-type': 'application/octet-stream' },
    `/api/upload?action=ia-part&key=${encodeURIComponent(IA_KEY)}&uploadId=upid-1&partNumber=1`);
  assert.equal(res.status, 200);
  assert.equal(res.payload.etag, '"etag-1"');
  const call = seen[0];
  assert.ok(call.url.startsWith(`https://s3.us.archive.org/shortsfactory-videos/${IA_KEY}?partNumber=1&uploadId=upid-1`));
  assert.equal(call.opts.headers.Authorization, 'LOW AKIDEXAMPLE:secret-key');
  assert.equal(Buffer.from(call.opts.body).toString(), 'chunk-bytes-here');
  // invalid keys / parts are rejected before any network call
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  for (const url of [
    '/api/upload?action=ia-part&key=../evil&uploadId=upid-1&partNumber=1',
    `/api/upload?action=ia-part&key=${encodeURIComponent(IA_KEY)}&uploadId=upid-1&partNumber=0`,
    `/api/upload?action=ia-part&key=${encodeURIComponent(IA_KEY)}&uploadId=upid-1&partNumber=99999`,
  ]) {
    assert.equal((await request(Buffer.from('x'), 'POST', { 'content-type': 'application/octet-stream' }, url)).status >= 400, true, url);
  }
});

test('IA: complete sends the manifest and prefers a live public URL', async () => {
  setEnv(IA_ENV);
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), method: opts.method, body: opts.body, headers: opts.headers });
    if (opts.method === 'HEAD') return new Response(null, { status: 200 });
    return new Response('<CompleteMultipartUploadResult/>', { status: 200 });
  };
  const res = await request({ action: 'ia-complete', key: IA_KEY, uploadId: 'upid-1', parts: [{ partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' }] });
  assert.equal(res.status, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.publicUrl, `https://s3.us.archive.org/shortsfactory-videos/${IA_KEY}`);
  assert.equal(validateVideoUrl(res.payload.publicUrl), '');
  const complete = seen.find(c => c.method === 'POST');
  assert.ok(complete.body.includes('<PartNumber>1</PartNumber>'));
  assert.ok(complete.body.includes('&quot;a&quot;'));
  assert.equal(complete.headers.Authorization, 'LOW AKIDEXAMPLE:secret-key');
});

test('IA: direct fallback signs a browser PUT with header auth', async () => {
  setEnv(IA_ENV);
  const res = await request({ action: 'ia-direct', filename: 'v.mp4', contentType: 'video/mp4', size: 10 });
  assert.equal(res.status, 200);
  assert.equal(res.payload.provider, 'ia-direct');
  assert.equal(res.payload.headers.Authorization, 'LOW AKIDEXAMPLE:secret-key');
  assert.equal(res.payload.headers['Content-Type'], 'video/mp4');
  assert.match(res.payload.uploadUrl, /^https:\/\/s3\.us\.archive\.org\/shortsfactory-videos\//);
  assert.equal(validateVideoUrl(res.payload.publicUrl), '');
});

test('IA actions are refused when an S3 endpoint is configured', async () => {
  setEnv({ S3_ENDPOINT: '' });
  for (const action of ['ia-direct', 'ia-complete']) {
    assert.equal((await request({ action })).status, 400);
  }
  assert.equal((await request(Buffer.from('x'), 'POST', { 'content-type': 'application/octet-stream' }, '/api/upload?action=ia-part&key=x&uploadId=y&partNumber=1')).status, 400);
});

test('s3 sign response declares its provider', async () => {
  setEnv({ S3_ENDPOINT: '' });
  const res = await request({ action: 'sign', filename: 'clip.mp4', contentType: 'video/mp4', size: 1234567 });
  assert.equal(res.status, 200);
  assert.equal(res.payload.provider, 's3');
});
