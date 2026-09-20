import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/buffer.js';
import { DEFAULT_DESCRIPTION, validateVideoUrl, buildPostInput } from '../shared/buffer.js';
const originalFetch = globalThis.fetch;
const originalKey = process.env.BUFFER_API_KEY;
beforeEach(() => { process.env.BUFFER_API_KEY = 'test-only-key'; });
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.BUFFER_API_KEY; else process.env.BUFFER_API_KEY = originalKey; });
const post = { videoUrl: 'https://media.example.com/final.mp4', description: DEFAULT_DESCRIPTION, title: 'My story', platform: 'youtube', channelId: 'channel-1', mode: 'queue' };
async function request(body, method = 'POST', headers = {}) {
  let status = 200, payload;
  const response = { setHeader() {}, status(code) { status = code; return this; }, json(data) { payload = data; } };
  await handler({ method, headers, body }, response);
  return { status, payload };
}
test('public URL validation rejects local, signed and share links', () => {
  for (const url of ['blob:https://example.com/123', 'data:video/mp4,aaa', 'http://example.com/a.mp4', 'https://localhost/a', 'https://127.0.0.1/a', 'https://192.168.1.4/a', 'https://[::1]/a', 'https://drive.google.com/file/d/id/view', 'https://example.com/a?X-Amz-Signature=123', 'https://user:pass@example.com/a']) assert.ok(validateVideoUrl(url), url);
  assert.equal(validateVideoUrl(post.videoUrl), '');
});
test('description is exact; no title or duplicate hashtags are prepended', () => {
  assert.equal(DEFAULT_DESCRIPTION, "You won't believe how this story ends...\n\nStay until the end because the plot twist is INSANE.\n\nWould you have done the same?\n\n#reddit #redditstories #storytime\n\n#stories #fyp");
  const input = buildPostInput(post);
  assert.equal(input.text, DEFAULT_DESCRIPTION);
  assert.deepEqual(input.assets, [{ video: { url: post.videoUrl } }]);
  assert.equal(input.metadata.youtube.categoryId, '24');
  assert.equal(input.mode, 'addToQueue');
  assert.equal(buildPostInput({ ...post, mode: 'now' }).mode, 'shareNow');
  assert.deepEqual(buildPostInput({ ...post, platform: 'instagram' }).metadata, { instagram: { type: 'reel', shouldShareToFeed: true } });
});
test('scheduled posts require a future timestamp and channel', () => {
  assert.throws(() => buildPostInput({ ...post, channelId: '' }));
  assert.throws(() => buildPostInput({ ...post, mode: 'custom', scheduledAt: '2020-01-01T00:00:00Z' }));
  const future = new Date(Date.now() + 3600000).toISOString();
  assert.equal(buildPostInput({ ...post, mode: 'custom', scheduledAt: future }).dueAt, future);
});
test('missing key never simulates a successful post', async () => {
  delete process.env.BUFFER_API_KEY;
  globalThis.fetch = () => { throw new Error('must not call upstream'); };
  const result = await request({ action: 'create', post });
  assert.equal(result.status, 503); assert.equal(result.payload.uncertain, false);
});
test('successful create uses documented GraphQL shape and only server-side key', async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.buffer.com');
    assert.equal(opts.headers.Authorization, 'Bearer test-only-key');
    const body = JSON.parse(opts.body); assert.equal(body.variables.input.assets[0].video.url, post.videoUrl);
    return Response.json({ data: { createPost: { post: { id: 'real-id', status: 'scheduled', dueAt: null } } } });
  };
  const result = await request({ action: 'create', post });
  assert.equal(result.status, 200); assert.equal(result.payload.post.id, 'real-id');
  assert.ok(!JSON.stringify(result).includes('test-only-key'));
});
test('typed mutation rejection is definite; transport failure is uncertain', async () => {
  globalThis.fetch = async () => Response.json({ data: { createPost: { message: 'Invalid video format' } } });
  let result = await request({ action: 'create', post });
  assert.equal(result.status, 422); assert.equal(result.payload.uncertain, false);
  globalThis.fetch = async () => { throw new Error('connection reset'); };
  result = await request({ action: 'create', post });
  assert.equal(result.status, 502); assert.equal(result.payload.uncertain, true);
});
test('GraphQL errors and malformed success never become fake IDs', async () => {
  for (const payload of [{ errors: [{ message: 'Unauthorized' }] }, { data: { createPost: {} } }]) {
    globalThis.fetch = async () => Response.json(payload);
    assert.equal((await request({ action: 'create', post })).status, 502);
  }
});
test('rate limits are surfaced, not retried automatically', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}, { status: 429 }); };
  assert.equal((await request({ action: 'create', post })).status, 429); assert.equal(calls, 1);
});
test('delete must receive confirmed success from Buffer', async () => {
  globalThis.fetch = async () => Response.json({ data: { deletePost: { __typename: 'VoidMutationError', message: 'Cannot delete sent post' } } });
  assert.equal((await request({ action: 'delete', id: 'id1' })).status, 422);
  globalThis.fetch = async () => Response.json({ data: { deletePost: { __typename: 'DeletePostSuccess' } } });
  assert.equal((await request({ action: 'delete', id: 'id1' })).payload.ok, true);
});
test('cross-site requests rejected', async () => {
  assert.equal((await request({ action: 'create', post }, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
});
