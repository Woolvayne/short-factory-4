import { DEFAULT_DESCRIPTION, validateVideoUrl } from '../../shared/buffer.js';
import { authHeaders } from './auth.ts';
export { DEFAULT_DESCRIPTION, validateVideoUrl };
export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube';
export type PostStatus = 'Geplant' | 'Wird veröffentlicht' | 'Veröffentlicht' | 'Fehler' | 'Unklar';
export type ScheduleMode = 'queue' | 'now' | 'auto' | 'custom';
export interface ScheduledPost {
  id: string;
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
  description: string;
  hashtags: string[];
  platform: SocialPlatform;
  channelId: string;
  mode: ScheduleMode;
  scheduledAt: string;
  berlinSlotKey?: string;
  status: PostStatus;
  bufferPostId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BufferConfigState {
  defaultPlatforms: SocialPlatform[];
  tiktokChannelId: string;
  instagramChannelId: string;
  youtubeChannelId: string;
  sendInterval: number;
}
const POSTS_KEY = 'shortsfactory.buffer_posts.v1'; // Never treat legacy simulated posts as real Buffer posts.
const CONFIG_KEY = 'shortsfactory.buffer_config.v1';
const DEFAULT_CONFIG: BufferConfigState = {
  defaultPlatforms: ['tiktok'], tiktokChannelId: '', instagramChannelId: '', youtubeChannelId: '', sendInterval: 3,
};
export function loadBufferConfig(): BufferConfigState {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
export function saveBufferConfig(config: BufferConfigState) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* private mode */ }
}
export function loadLocalPosts(): ScheduledPost[] {
  try { const value = JSON.parse(localStorage.getItem(POSTS_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
export function saveLocalPosts(posts: ScheduledPost[]) {
  // Fail closed before publishing if the journal cannot be saved (duplicate protection).
  localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
}
export interface SchedulePlanOptions {
  mode: ScheduleMode;
  count?: number;
  times?: string[];
  startDate?: string;
  dayStep?: number;
}
export function getBerlinParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
  };
}

export function berlinWallTimeToISO(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): string {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let i = 0; i < 4; i++) {
    const p = getBerlinParts(new Date(utc));
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (actual === desired) return new Date(utc).toISOString();
    utc += desired - actual;
  }
  // Nonexistent wall time during the spring DST jump: skip it, never silently shift it.
  return "";
}

export function getBerlinSlotKey(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const p = getBerlinParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatBerlinDateTime(isoString: string): {
  dateStr: string;
  timeStr: string;
  fullStr: string;
  weekdayStr: string;
} {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    return { dateStr: "—", timeStr: "—", fullStr: "—", weekdayStr: "—" };
  }
  const dateStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

  const weekdayStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(d);

  return {
    dateStr,
    timeStr: `${timeStr} Uhr`,
    fullStr: `${weekdayStr}, ${dateStr} · ${timeStr} Uhr`,
    weekdayStr,
  };
}

/**
 * Finds the next `count` (default 10) free slots at 06:00 and 20:00 in Europe/Berlin.
 * Never overwrites or double-books any existing scheduled post.
 */
export function findNextFreeBerlinSlots(
  existingPosts: ScheduledPost[],
  count = 10
): { scheduledAt: string; berlinKey: string }[] {
  const occupiedKeys = new Set(
    existingPosts
      .filter((p) => p && p.scheduledAt)
      .map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  const nowBerlin = getBerlinParts(now);
  const slots: { scheduledAt: string; berlinKey: string }[] = [];

  let dayOffset = 0;
  while (slots.length < count && dayOffset < 365) {
    const baseDate = new Date(
      Date.UTC(nowBerlin.year, nowBerlin.month - 1, nowBerlin.day + dayOffset, 12, 0, 0)
    );
    const bDay = getBerlinParts(baseDate);

    for (const hour of [6, 20]) {
      if (slots.length >= count) break;

      const slotISO = berlinWallTimeToISO(bDay.year, bDay.month, bDay.day, hour, 0);
      const slotDate = new Date(slotISO);

      if (!slotISO || slotDate.getTime() <= now.getTime() + 2 * 60 * 1000) {
        continue;
      }

      const key = getBerlinSlotKey(slotISO);
      if (!occupiedKeys.has(key)) {
        occupiedKeys.add(key);
        slots.push({
          scheduledAt: slotISO,
          berlinKey: key,
        });
      }
    }

    dayOffset += 1;
  }

  return slots;
}

/** Parse "HH:mm" → [hour, minute]; invalid input falls back to 06:00. */
function parseTime(t: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return [6, 0];
  return [
    Math.min(23, Math.max(0, Number(m[1]))),
    Math.min(59, Math.max(0, Number(m[2]))),
  ];
}

/**
 * Flexible slot planner. Honours arbitrary daily times, a start date and a day
 * step, and still guarantees no slot is ever double-booked.
 */
export function findFlexibleBerlinSlots(
  existingPosts: ScheduledPost[],
  opts: SchedulePlanOptions
): { scheduledAt: string; berlinKey: string }[] {
  const count = opts.count ?? 10;
  const times = (opts.times?.length ? opts.times : ["06:00", "20:00"]).map(parseTime).sort((a, b) => a[0] * 60 + a[1] - b[0] * 60 - b[1]);
  const dayStep = Math.max(1, opts.dayStep ?? 1);

  const occupied = new Set(
    existingPosts.filter((p) => p?.scheduledAt).map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  let anchor = getBerlinParts(now);
  if (opts.startDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.startDate);
    if (m) {
      anchor = {
        ...anchor,
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      };
    }
  }

  const slots: { scheduledAt: string; berlinKey: string }[] = [];
  let dayIndex = 0;

  while (slots.length < count && dayIndex < 400) {
    const base = new Date(
      Date.UTC(anchor.year, anchor.month - 1, anchor.day + dayIndex * dayStep, 12, 0, 0)
    );
    const bDay = getBerlinParts(base);

    for (const [hour, minute] of times) {
      if (slots.length >= count) break;
      const iso = berlinWallTimeToISO(bDay.year, bDay.month, bDay.day, hour, minute);
      if (!iso || new Date(iso).getTime() <= now.getTime() + 2 * 60 * 1000) continue;
      const key = getBerlinSlotKey(iso);
      if (occupied.has(key)) continue;
      occupied.add(key);
      slots.push({ scheduledAt: iso, berlinKey: key });
    }
    dayIndex += 1;
  }

  return slots;
}

export function planSlots(existingPosts: ScheduledPost[], opts: SchedulePlanOptions) {
  if (opts.mode === "now" || opts.mode === "queue") return [];
  if (opts.mode === "custom") return findFlexibleBerlinSlots(existingPosts, opts);
  return findNextFreeBerlinSlots(existingPosts, opts.count ?? 10);
}

export class BufferRequestError extends Error {
  constructor(message: string, public uncertain = false, public status = 0) { super(message); }
}
export async function bufferRequest<T>(body: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/buffer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
  } catch { throw new BufferRequestError('Verbindung unterbrochen. Ergebnis in Buffer prüfen; nicht blind erneut senden.', true); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new BufferRequestError(data?.error || `Buffer HTTP ${res.status}`, data?.uncertain ?? true, res.status);
  return data as T;
}
export interface BufferChannel { id: string; name: string; displayName: string; service: string; isQueuePaused: boolean; organizationName: string }
export const fetchBufferChannels = () => bufferRequest<{ channels: BufferChannel[] }>({ action: 'channels' });
interface RemotePost { id: string; dueAt: string | null; status: string }
function remotePatch(post: RemotePost, fallback: string): Pick<ScheduledPost, 'status' | 'bufferPostId' | 'scheduledAt' | 'updatedAt'> {
  const status: PostStatus = post.status === 'sent' ? 'Veröffentlicht'
    : post.status === 'sending' ? 'Wird veröffentlicht'
    : post.status === 'error' ? 'Fehler'
    : post.status === 'scheduled' ? 'Geplant' : 'Unklar';
  return { status, bufferPostId: post.id, scheduledAt: post.dueAt || fallback, updatedAt: new Date().toISOString() };
}
export async function fetchScheduledPosts(): Promise<{ posts: ScheduledPost[]; hasApiKey: boolean }> {
  const posts = loadLocalPosts();
  const res = await fetch('/api/buffer', { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error('Buffer-Backend nicht erreichbar.');
  const { hasApiKey } = await res.json();
  if (!hasApiKey) return { posts, hasApiKey: false };
  const ids = posts.flatMap(p => p.bufferPostId ? [p.bufferPostId] : []);
  const remote: RemotePost[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const data = await bufferRequest<{ posts: RemotePost[] }>({ action: 'status', ids: ids.slice(i, i + 40) });
    remote.push(...data.posts.filter(Boolean));
  }
  const updated = posts.map(p => {
    const match = remote.find(r => r.id === p.bufferPostId);
    return match ? { ...p, ...remotePatch(match, p.scheduledAt) } : p;
  });
  saveLocalPosts(updated);
  return { posts: updated, hasApiKey: true };
}
export interface ScheduleBatchInputItem { videoUrl: string; title: string; description: string }
export interface DispatchProgress { completed: number; total: number; message: string }
let dispatching = false;

export async function scheduleBatchPosts(opts: {
  items: ScheduleBatchInputItem[];
  config: BufferConfigState;
  plan: SchedulePlanOptions;
  onProgress?: (progress: DispatchProgress) => void;
  onPostsChange?: (posts: ScheduledPost[]) => void;
  signal?: AbortSignal;
}) {
  if (dispatching) throw new Error('Ein Versand läuft bereits.');
  const platforms = [...new Set(opts.config.defaultPlatforms)];
  if (!opts.items.length || !platforms.length) throw new Error('Videos und mindestens einen Kanal auswählen.');
  for (const item of opts.items) {
    const error = validateVideoUrl(item.videoUrl);
    if (error) throw new Error(error);
  }
  for (const platform of platforms) {
    if (!opts.config[`${platform}ChannelId`]?.trim()) throw new Error(`Bitte den Buffer-Kanal für ${platform} auswählen.`);
  }
  const current = loadLocalPosts();
  const slots = planSlots(current, { ...opts.plan, count: opts.items.length });
  if (['auto', 'custom'].includes(opts.plan.mode) && slots.length !== opts.items.length) throw new Error('Nicht genügend gültige Zeitfenster.');
  const jobs = opts.items.flatMap((item, i) => platforms.map(platform => ({
    ...item, platform, channelId: opts.config[`${platform}ChannelId`].trim(), scheduledAt: slots[i]?.scheduledAt,
  })));
  const seen = new Set(current.filter(p => p.status !== 'Fehler' || p.bufferPostId).map(p => `${p.videoUrl}\n${p.channelId}`));
  for (const job of jobs) {
    const key = `${job.videoUrl}\n${job.channelId}`;
    if (seen.has(key)) throw new Error('Dieser Video-Link wurde für einen ausgewählten Kanal bereits verwendet. Bitte Kalender / Buffer prüfen.');
    seen.add(key);
  }
  const interval = Math.max(2, Math.min(60, Number(opts.config.sendInterval) || 3)) * 1000;
  const createdPosts: ScheduledPost[] = [];
  dispatching = true;
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (opts.signal?.aborted) break;
      if (i > 0) {
        opts.onProgress?.({ completed: i, total: jobs.length, message: `${interval / 1000}s Pause vor dem nächsten Video …` });
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, interval);
          opts.signal?.addEventListener('abort', finish, { once: true });
        });
      }
      if (opts.signal?.aborted) break;
      const now = new Date().toISOString();
      const job = jobs[i];
      const post: ScheduledPost = {
        ...job, id: crypto.randomUUID(), mode: opts.plan.mode, hashtags: [],
        scheduledAt: job.scheduledAt || now, status: 'Unklar', createdAt: now, updatedAt: now,
        errorMessage: 'Versand gestartet. Bei Unterbrechung zuerst in Buffer prüfen.',
      };
      current.push(post);
      saveLocalPosts(current); // write-ahead journal survives tab close / reload
      opts.onProgress?.({ completed: i, total: jobs.length, message: `${i + 1}/${jobs.length} → ${job.platform}: ${job.title}` });
      let stop = false;
      try {
        const data = await bufferRequest<{ post: RemotePost }>({ action: 'create', post });
        if (!data.post?.id) throw new BufferRequestError('Keine bestätigte Post-ID.', true);
        Object.assign(post, remotePatch(data.post, post.scheduledAt), { errorMessage: null });
      } catch (error) {
        const e = error as BufferRequestError;
        post.status = e.uncertain ? 'Unklar' : 'Fehler';
        post.errorMessage = e.message;
        stop = e.uncertain || [429, 503].includes(e.status);
      }
      createdPosts.push(post);
      saveLocalPosts(current);
      opts.onPostsChange?.([...current]);
      opts.onProgress?.({ completed: i + 1, total: jobs.length, message: post.errorMessage || 'Von Buffer bestätigt' });
      if (stop) break;
    }
    return { createdPosts, allPosts: current };
  } finally { dispatching = false; }
}

export async function retryScheduledPost(postId: string) {
  const current = loadLocalPosts();
  const post = current.find(p => p.id === postId);
  if (!post || post.status !== 'Fehler' || post.bufferPostId) throw new Error('Bitte diesen Post direkt in Buffer prüfen / erneut planen. Kein automatisches Duplikat wird erstellt.');
  if (dispatching) throw new Error('Ein Versand läuft bereits.');
  dispatching = true;
  try {
    if (['auto', 'custom'].includes(post.mode) && Date.parse(post.scheduledAt) <= Date.now()) {
      post.scheduledAt = findNextFreeBerlinSlots(current, 1)[0].scheduledAt;
    }
    post.status = 'Unklar';
    saveLocalPosts(current);
    try {
      const data = await bufferRequest<{ post: RemotePost }>({ action: 'create', post });
      if (!data.post?.id) throw new BufferRequestError('Keine bestätigte Post-ID.', true);
      Object.assign(post, remotePatch(data.post, post.scheduledAt), { errorMessage: null });
    } catch (error) {
      const e = error as BufferRequestError;
      post.status = e.uncertain ? 'Unklar' : 'Fehler'; post.errorMessage = e.message;
    }
    saveLocalPosts(current);
    return current;
  } finally { dispatching = false; }
}
export async function deleteScheduledPost(postId: string) {
  const current = loadLocalPosts();
  const post = current.find(p => p.id === postId);
  if (!post) return current;
  if (post.status === 'Unklar' && !post.bufferPostId) throw new Error('Versandergebnis unklar. Bitte zuerst in Buffer prüfen. Der lokale Schutz vor Duplikaten bleibt erhalten.');
  if (post.bufferPostId) await bufferRequest({ action: 'delete', id: post.bufferPostId });
  const updated = current.filter(p => p.id !== postId);
  saveLocalPosts(updated);
  return updated;
}
