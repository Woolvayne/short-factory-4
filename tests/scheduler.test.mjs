import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleBatchPosts, loadLocalPosts, retryScheduledPost, deleteScheduledPost, berlinWallTimeToISO, findFlexibleBerlinSlots, getBerlinSlotKey } from '../src/lib/scheduler.ts';
import { introPose } from '../src/lib/intro.ts';
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
beforeEach(() => {
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
});
afterEach(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
const config = { defaultPlatforms: ['tiktok'], tiktokChannelId: 'tt-1', instagramChannelId: 'ig-1', youtubeChannelId: '', sendInterval: 2 };
const items = [1, 2].map(i => ({ title: `Video ${i}`, videoUrl: `https://example.com/video${i}.mp4`, description: 'Exact caption' }));
const opts = { items, config, plan: { mode: 'queue' } };
const success = id => Response.json({ post: { id, status: 'scheduled', dueAt: '2030-01-01T06:00:00Z' } });
test('one video creates one post, not ten recycled copies', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return success(`id-${calls}`); };
  const result = await scheduleBatchPosts({ ...opts, items: items.slice(0, 1) });
  assert.equal(calls, 1); assert.equal(result.createdPosts.length, 1);
  assert.equal(loadLocalPosts()[0].bufferPostId, 'id-1');
  await assert.rejects(scheduleBatchPosts({ ...opts, items: items.slice(0, 1) }), /bereits verwendet/);
});
test('all selected channels receive each video, sequentially with real interval', async () => {
  const calls = [];
  globalThis.fetch = async (_, options) => {
    calls.push({ time: Date.now(), post: JSON.parse(options.body).post });
    return success(`id-${calls.length}`);
  };
  await scheduleBatchPosts({ ...opts, items: items.slice(0, 1), config: { ...config, defaultPlatforms: ['tiktok', 'instagram'] } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].post.videoUrl, calls[1].post.videoUrl);
  assert.deepEqual(calls.map(c => c.post.channelId), ['tt-1', 'ig-1']);
  assert.ok(calls[1].time - calls[0].time >= 1950);
});
test('partial failure preserves successes and definite rejection can be retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? success('real-1') : Response.json({ error: 'Invalid media', uncertain: false }, { status: 422 });
  const result = await scheduleBatchPosts(opts);
  assert.deepEqual(result.createdPosts.map(p => p.status), ['Geplant', 'Fehler']);
  globalThis.fetch = async () => success('real-2');
  const retried = await retryScheduledPost(result.createdPosts[1].id);
  assert.equal(retried[1].status, 'Geplant'); assert.equal(retried[0].bufferPostId, 'real-1');
});
test('uncertain result stops batch; retry and journal deletion are blocked', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network lost'); };
  const result = await scheduleBatchPosts(opts);
  assert.equal(calls, 1); assert.equal(result.createdPosts[0].status, 'Unklar');
  await assert.rejects(retryScheduledPost(result.createdPosts[0].id));
  await assert.rejects(deleteScheduledPost(result.createdPosts[0].id));
  assert.equal(loadLocalPosts().length, 1);
});
test('stop after current post does not interrupt its confirmation', async () => {
  const controller = new AbortController(); let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); return success('id1'); };
  const result = await scheduleBatchPosts({ ...opts, signal: controller.signal });
  assert.equal(calls, 1); assert.equal(result.createdPosts[0].bufferPostId, 'id1');
});
test('no key or rate limit stops batch without pretending success', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Missing key', uncertain: false }, { status: 503 });
  const result = await scheduleBatchPosts(opts);
  assert.equal(result.createdPosts.length, 1); assert.equal(result.createdPosts[0].status, 'Fehler');
});
test('storage failure prevents external side effects', async () => {
  localStorage.setItem = () => { throw new Error('quota'); };
  globalThis.fetch = () => { assert.fail('must not send without journal'); };
  await assert.rejects(scheduleBatchPosts(opts), /quota/);
});
test('Berlin summer/winter times and nonexistent DST time', () => {
  assert.equal(berlinWallTimeToISO(2030, 7, 1, 6), '2030-07-01T04:00:00.000Z');
  assert.equal(berlinWallTimeToISO(2030, 1, 1, 6), '2030-01-01T05:00:00.000Z');
  assert.equal(berlinWallTimeToISO(2030, 3, 31, 2, 30), '');
  const slots = findFlexibleBerlinSlots([], { mode: 'custom', count: 3, startDate: '2030-07-01', times: ['20:00', '06:00'], dayStep: 2 });
  assert.deepEqual(slots.map(s => getBerlinSlotKey(s.scheduledAt)), ['2030-07-01 06:00', '2030-07-01 20:00', '2030-07-03 06:00']);
  const next = findFlexibleBerlinSlots([{ scheduledAt: slots[0].scheduledAt }], { mode: 'custom', count: 1, startDate: '2030-07-01', times: ['06:00', '20:00'] });
  assert.equal(next[0].scheduledAt, slots[1].scheduledAt);
});
test('intro animation respects duration, readable hold and exit', () => {
  assert.equal(introPose(-1, 3.5), null); assert.equal(introPose(3.5, 3.5), null);
  assert.equal(introPose(1, 3.5).alpha, 1); assert.equal(introPose(1, 3.5).x, 0);
  assert.ok(introPose(0.1, 3.5).x < 0); assert.ok(introPose(3.4, 3.5).x > 0);
  assert.equal(introPose(5, 8).alpha, 1); assert.equal(introPose(1, 0), null);
});
