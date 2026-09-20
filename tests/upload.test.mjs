import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler, { resolveHost, generateClientToken, isBlobClientRequest } from '../api/upload.js';
import { validateVideoUrl } from '../shared/buffer.js';

const ENV_KEYS = ['BLOB_READ_WRITE_TOKEN'];
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
const savedFetch = globalThis.fetch;

/** Realistic but fake tokens — format vercel_blob_rw_<storeId>_<secret>. */
const ENV_TOKEN = 'vercel_blob_rw_ENVSTORE_secret-env';
const APP_TOKEN = 'vercel_blob_rw_APPSTORE_secret-app';

function setEnv(over = {}) {
  const base = { BLOB_READ_WRITE_TOKEN: ENV_TOKEN, ...over };
  for (const k of ENV_KEYS) process.env[k] = base[k] ?? saved[k] ?? '';
}
beforeEach(() => setEnv());
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = savedFetch;
});

async function request(body, method = 'POST', headers = {}, url = '/api/upload') {
  let status = 200, payload;
  const response = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(data) { payload = data; },
  };
  await handler({ method, headers, body, url }, response);
  return { status, payload };
}

function clientTokenRequest(pathname) {
  return { type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: false } };
}

/** Decode and verify a vercel_blob_client_<storeId>_<base64(sig.payload)> token. */
function decodeClientToken(clientToken, signingToken) {
  const parts = clientToken.split('_');
  assert.equal(parts[0], 'vercel');
  assert.equal(parts[1], 'blob');
  assert.equal(parts[2], 'client');
  const storeId = parts[3];
  const inner = Buffer.from(parts.slice(4).join('_'), 'base64').toString('utf8');
  const dot = inner.indexOf('.');
  const signature = inner.slice(0, dot);
  const payloadB64 = inner.slice(dot + 1);
  const expected = createHmac('sha256', signingToken).update(payloadB64, 'utf8').digest('hex');
  assert.equal(signature, expected, 'client token must be signed with the resolving read/write token');
  return { storeId, payload: JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) };
}

/* ------------------------------ GET status ------------------------------ */

test('GET reports Vercel Blob as the only provider and never leaks the token', async () => {
  const ok = await request(undefined, 'GET');
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.configured, true);
  assert.equal(ok.payload.provider, 'vblob');
  assert.ok(!JSON.stringify(ok.payload).includes('secret-env'));

  setEnv({ BLOB_READ_WRITE_TOKEN: '' });
  const off = await request(undefined, 'GET');
  assert.equal(off.status, 200);
  assert.deepEqual(off.payload, { configured: false, provider: null });
});

/* --------------------- offline client-token generation --------------------- */

test('client token is generated offline, constrained and correctly signed', async () => {
  // any network call during token issuance must fail the test
  globalThis.fetch = async () => { throw new Error('network must not be touched'); };
  const before = Date.now();
  const res = await request(clientTokenRequest('shortsfactory/20260920T123456Z-abcd1234-mein-video.mp4'));
  assert.equal(res.status, 200);
  assert.equal(res.payload.type, 'blob.generate-client-token');
  const { storeId, payload } = decodeClientToken(res.payload.clientToken, ENV_TOKEN);
  assert.equal(storeId, 'ENVSTORE');
  assert.equal(payload.pathname, 'shortsfactory/20260920T123456Z-abcd1234-mein-video.mp4');
  assert.deepEqual(payload.allowedContentTypes, ['video/mp4', 'video/webm']);
  assert.equal(payload.maximumSizeInBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(payload.addRandomSuffix, true);
  assert.ok(payload.validUntil > before && payload.validUntil <= Date.now() + 60 * 60 * 1000 + 1000);
  assert.ok(!JSON.stringify(res.payload).includes('secret-env'));
});

test('path guard: only shortsfactory/* without traversal or junk is accepted', async () => {
  globalThis.fetch = async () => { throw new Error('network must not be touched'); };
  for (const bad of [
    'evil/2026-video.mp4',
    'shortsfactory/../evil.mp4',
    'shortsfactory//doppelt.mp4',
    'shortsfactory/a b.mp4',
    'shortsfactory/query?.mp4',
    'shortsfactory/',
    'shortsfactory/x',
    '',
  ]) {
    const res = await request(clientTokenRequest(bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(res.payload.error, /shortsfactory|Pfad/);
  }
  const good = await request(clientTokenRequest('shortsfactory/20260920T123456Z-deadbeef-clip-01.webm'));
  assert.equal(good.status, 200);
});

test('client token is refused with 503 when nothing is configured', async () => {
  setEnv({ BLOB_READ_WRITE_TOKEN: '' });
  globalThis.fetch = async () => { throw new Error('network must not be touched'); };
  const res = await request(clientTokenRequest('shortsfactory/a-video.mp4'));
  assert.equal(res.status, 503);
  assert.match(res.payload.error, /BLOB_READ_WRITE_TOKEN|Versandfenster/);
  assert.equal(res.payload.uncertain, false);
});

/* ---------------------------- provider priority ---------------------------- */

test('env token beats the in-app token; in-app token works without env', async () => {
  globalThis.fetch = async () => { throw new Error('network must not be touched'); };

  // env + in-app → env wins (store id AND signature belong to the env token)
  const both = await request(clientTokenRequest('shortsfactory/v.mp4'), 'POST', { 'x-sf-blob-token': APP_TOKEN });
  assert.equal(both.status, 200);
  assert.equal(decodeClientToken(both.payload.clientToken, ENV_TOKEN).storeId, 'ENVSTORE');
  assert.throws(() => decodeClientToken(both.payload.clientToken, APP_TOKEN));

  // in-app only (header and body variants) → app token is used
  setEnv({ BLOB_READ_WRITE_TOKEN: '' });
  const viaHeader = await request(clientTokenRequest('shortsfactory/v.mp4'), 'POST', { 'x-sf-blob-token': APP_TOKEN });
  assert.equal(decodeClientToken(viaHeader.payload.clientToken, APP_TOKEN).storeId, 'APPSTORE');
  const viaBody = await request({ ...clientTokenRequest('shortsfactory/v.mp4'), blobToken: APP_TOKEN });
  assert.equal(decodeClientToken(viaBody.payload.clientToken, APP_TOKEN).storeId, 'APPSTORE');

  // resolveHost reflects the same priority
  assert.equal(resolveHost({ headers: { 'x-sf-blob-token': APP_TOKEN } }).source, 'app');
  setEnv();
  assert.equal(resolveHost({ headers: { 'x-sf-blob-token': APP_TOKEN } }).source, 'env');
});

test('isBlobClientRequest only matches the blob client protocol', () => {
  assert.equal(isBlobClientRequest(clientTokenRequest('shortsfactory/v.mp4')), true);
  assert.equal(isBlobClientRequest({ action: 'vblob-check' }), false);
  assert.equal(isBlobClientRequest(null), false);
  assert.equal(generateClientToken(ENV_TOKEN, { pathname: 'shortsfactory/v.mp4' }).split('_')[3], 'ENVSTORE');
});

/* ------------------------------- vblob-check ------------------------------- */

test('vblob-check verifies the token against Vercel and maps failures clearly', async () => {
  setEnv({ BLOB_READ_WRITE_TOKEN: '' });
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers });
    return new Response('{"blobs":[]}', { status: 200 });
  };
  const ok = await request({ action: 'vblob-check', blobToken: APP_TOKEN });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.payload, { ok: true });
  assert.match(calls[0].url, /^https:\/\/vercel\.com\/api\/blob\/\?limit=1$/);
  assert.equal(calls[0].headers.authorization, `Bearer ${APP_TOKEN}`);
  assert.equal(calls[0].headers['x-api-version'], '11');

  globalThis.fetch = async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401 });
  const rejected = await request({ action: 'vblob-check', blobToken: APP_TOKEN });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.ok, false);
  assert.match(rejected.payload.error, /abgelehnt/);

  globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
  assert.equal((await request({ action: 'vblob-check', blobToken: APP_TOKEN })).payload.ok, false);

  globalThis.fetch = async () => new Response('{"error":{"code":"store_not_found"}}', { status: 404 });
  const missing = await request({ action: 'vblob-check', blobToken: APP_TOKEN });
  assert.equal(missing.payload.ok, false);
  assert.match(missing.payload.error, /Store/);

  globalThis.fetch = async () => { throw new Error('down'); };
  const down = await request({ action: 'vblob-check', blobToken: APP_TOKEN });
  assert.equal(down.status, 502);
  assert.match(down.payload.error, /nicht erreichbar/);
});

test('vblob-check needs a token and validates its format before any network call', async () => {
  setEnv({ BLOB_READ_WRITE_TOKEN: '' });
  assert.equal((await request({ action: 'vblob-check' })).status, 400);

  globalThis.fetch = async () => { throw new Error('network must not be touched'); };
  const bad = await request({ action: 'vblob-check', blobToken: 'not-a-token' });
  assert.equal(bad.status, 200);
  assert.equal(bad.payload.ok, false);
  assert.match(bad.payload.error, /Read\/Write-Token|Format/);

  // with only the env token configured, vblob-check verifies that one
  setEnv();
  globalThis.fetch = async (url, opts = {}) => {
    assert.equal(opts.headers.authorization, `Bearer ${ENV_TOKEN}`);
    return new Response('{}', { status: 200 });
  };
  assert.equal((await request({ action: 'vblob-check' })).payload.ok, true);
});

/* ------------------------------ route hygiene ------------------------------ */

test('cross-site requests, unknown actions and bad methods are rejected', async () => {
  assert.equal((await request(clientTokenRequest('shortsfactory/v.mp4'), 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request({ action: 'nope' })).status, 400);
  assert.equal((await request(undefined, 'PUT')).status, 405);
});

test('public blob URLs pass the shared Buffer URL validation', () => {
  assert.equal(validateVideoUrl('https://envstore123.public.blob.vercel-storage.com/shortsfactory/20260920T123456Z-abcd1234-video-XY7.mp4'), '');
});
