import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import handler, { uploadEnv, uploadHostConfigured, presignPut, buildUploadTarget, sanitizeFileName } from '../api/upload.js';
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

async function request(body, method = 'POST', headers = {}) {
  let status = 200, payload;
  const response = { setHeader() {}, status(code) { status = code; return this; }, json(data) { payload = data; } };
  await handler({ method, headers, body }, response);
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
