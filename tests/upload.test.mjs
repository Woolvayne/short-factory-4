import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { buildObjectKey, defaultProvider, prepareUpload, providerStatuses, storageConfig } from '../api/upload.js';
import { validateVideoUrl } from '../shared/buffer.js';

const ENV_KEYS = [
  'SHORTSFACTORY_PASSWORD', 'STORAGE_PROVIDER',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL',
  'B2_S3_ENDPOINT', 'B2_S3_REGION', 'B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_NAME', 'B2_PUBLIC_BASE_URL',
];
const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

function setEnv(values = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

beforeEach(() => setEnv());
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
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

const r2Env = {
  R2_ACCOUNT_ID: 'account123',
  R2_ACCESS_KEY_ID: 'r2-access',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET_NAME: 'shorts',
  R2_PUBLIC_BASE_URL: 'https://media.example.com',
};

const b2Env = {
  B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
  B2_S3_REGION: 'eu-central-003',
  B2_KEY_ID: 'b2-key',
  B2_APPLICATION_KEY: 'b2-secret',
  B2_BUCKET_NAME: 'shorts',
  B2_PUBLIC_BASE_URL: 'https://f000.backblazeb2.com/file/shorts',
};

test('GET exposes all three providers without leaking credentials', async () => {
  const result = await request(undefined, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.payload.configured, true); // Puter is browser-only and needs no env
  assert.equal(result.payload.provider, 'puter');
  assert.equal(result.payload.providers.r2.configured, false);
  assert.equal(result.payload.providers.b2.configured, false);
  assert.equal(result.payload.providers.puter.configured, true);
  assert.ok(!JSON.stringify(result.payload).includes('r2-secret'));
  assert.ok(!JSON.stringify(result.payload).includes('b2-secret'));

  setEnv({ ...r2Env, ...b2Env, STORAGE_PROVIDER: 'b2' });
  const configured = await request(undefined, 'GET');
  assert.equal(configured.payload.providers.r2.configured, true);
  assert.equal(configured.payload.providers.b2.configured, true);
  assert.equal(configured.payload.provider, 'b2');
});

test('server password protects upload status and prepare routes', async () => {
  setEnv({ ...r2Env, SHORTSFACTORY_PASSWORD: 'correct horse' });
  const denied = await request(undefined, 'GET');
  assert.equal(denied.status, 401);
  assert.equal(denied.payload.code, 'auth_required');
  const allowed = await request(undefined, 'GET', { 'x-sf-password': 'correct horse' });
  assert.equal(allowed.status, 200);
  assert.equal((await request({ action: 'prepare', provider: 'puter', filename: 'a.mp4' }, 'POST', { 'x-sf-password': 'correct horse' })).status, 200);
});

test('Puter preparation is credential-free and returns a unique safe path', async () => {
  const result = await prepareUpload({ provider: 'puter', filename: '../my video?.mp4', contentType: 'video/mp4', size: 123 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'puter');
  assert.match(result.key, /^shortsfactory\/[\w.-]+\.mp4$/);
  assert.ok(!result.key.includes('..'));
});

test('R2 preparation creates a signed PUT URL and stable public URL without touching the video bytes', async () => {
  setEnv(r2Env);
  const result = await prepareUpload({ provider: 'r2', filename: 'clip.mp4', contentType: 'video/mp4', size: 1024 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'r2');
  assert.match(result.uploadUrl, /^https:\/\/shorts\.account123\.r2\.cloudflarestorage\.com/);
  assert.match(result.uploadUrl, /X-Amz-Signature=/);
  assert.ok(!result.uploadUrl.includes('x-amz-sdk-checksum-algorithm'));
  assert.match(result.publicUrl, /^https:\/\/media\.example\.com\/shortsfactory\/.*-clip\.mp4$/);
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.expiresIn, 900);
});

test('B2 preparation derives the configured S3 endpoint and public base URL', async () => {
  setEnv(b2Env);
  const result = await prepareUpload({ provider: 'b2', filename: 'clip.webm', contentType: 'video/webm;codecs=vp9', size: 1024 });
  assert.equal(result.provider, 'b2');
  assert.match(result.uploadUrl, /^https:\/\/shorts\.s3\.eu-central-003\.backblazeb2\.com/);
  assert.match(result.publicUrl, /^https:\/\/f000\.backblazeb2\.com\/file\/shorts\/shortsfactory\//);
  assert.equal(result.contentType, 'video/webm');
});

test('incomplete server providers fail closed and unsupported media is rejected', async () => {
  await assert.rejects(() => prepareUpload({ provider: 'r2', filename: 'a.mp4', contentType: 'video/mp4', size: 1 }), /Cloudflare R2.*nicht vollständig/);
  setEnv(r2Env);
  await assert.rejects(() => prepareUpload({ provider: 'r2', filename: 'a.mov', contentType: 'video/quicktime', size: 1 }), /MP4- oder WebM/);
  await assert.rejects(() => prepareUpload({ provider: 'r2', filename: 'a.mp4', contentType: 'video/mp4', size: 6 * 1024 * 1024 * 1024 }), /5 GiB/);
});

test('provider helpers keep secrets server-side and choose a configured default', () => {
  setEnv({ ...r2Env, STORAGE_PROVIDER: 'r2' });
  assert.equal(defaultProvider(), 'r2');
  assert.equal(storageConfig('r2').bucket, 'shorts');
  const key = buildObjectKey('nested\\danger name.mp4');
  assert.match(key, /^shortsfactory\/.*-danger-name\.mp4$/);
  const statuses = providerStatuses();
  assert.equal(statuses.r2.configured, true);
  assert.equal(statuses.puter.configured, true);
  assert.ok(!JSON.stringify(statuses).includes('r2-secret'));
});

test('route hygiene and public URL validation remain strict', async () => {
  setEnv(r2Env);
  assert.equal((await request(undefined, 'PUT')).status, 405);
  assert.equal((await request({ action: 'prepare', provider: 'r2', filename: 'a.mp4', contentType: 'video/mp4' }, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request({ action: 'nope' })).status, 400);
  assert.equal(validateVideoUrl('https://media.example.com/shortsfactory/clip.mp4'), '');
  assert.equal(validateVideoUrl('https://f000.backblazeb2.com/file/shorts/shortsfactory/clip.webm'), '');
});
