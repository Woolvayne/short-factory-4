import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/auth.js';

const saved = process.env.SHORTSFACTORY_PASSWORD;

function setPassword(value) {
  if (value === undefined) delete process.env.SHORTSFACTORY_PASSWORD;
  else process.env.SHORTSFACTORY_PASSWORD = value;
}

async function request(body, method = 'GET') {
  let status = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(data) { payload = data; return this; },
  };
  await handler({ method, body }, response);
  return { status, payload };
}

beforeEach(() => setPassword(undefined));
afterEach(() => setPassword(saved));

test('auth status is open when no password variable is set', async () => {
  assert.deepEqual((await request(undefined, 'GET')).payload, { configured: false });
  assert.deepEqual((await request({ password: 'anything' }, 'POST')).payload, { ok: true, configured: false });
});

test('password verification never returns the configured secret and rejects wrong input', async () => {
  setPassword('a-long-test-password');
  assert.deepEqual((await request(undefined, 'GET')).payload, { configured: true });
  const wrong = await request({ password: 'wrong' }, 'POST');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.payload.ok, false);
  assert.ok(!JSON.stringify(wrong.payload).includes('a-long-test-password'));
  assert.deepEqual((await request({ password: 'a-long-test-password' }, 'POST')).payload, { ok: true, configured: true });
});
