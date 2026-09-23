import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Globe,
  RotateCw,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import BufferChannels from "./BufferChannels";
import { cn } from "../utils/cn";
import {
  addCivilDays,
  berlinCalendarDays,
  berlinDateKey,
  civilDateKey,
  deleteScheduledPost,
  fetchScheduledPosts,
  findNextFreeBerlinSlots,
  formatBerlinDateTime,
  getBerlinParts,
  loadBufferConfig,
  postsOnBerlinDay,
  retryScheduledPost,
  shiftBerlinCursor,
  type BerlinCalendarDay,
  type BufferConfigState,
  type CalendarViewMode,
  type PostStatus,
  type ScheduledPost,
  type SocialPlatform,
} from "../lib/scheduler";

const PLATFORM_BADGES: Record<
  SocialPlatform,
  { label: string; short: string; style: string }
> = {
  tiktok: {
    label: "TikTok",
    short: "TIKTOK",
    style: "border-volt-400/50 bg-volt-400/15 text-volt-300",
  },
  instagram: {
    label: "Instagram Reels",
    short: "REELS",
    style: "border-ember-400/50 bg-ember-500/15 text-ember-400",
  },
  youtube: {
    label: "YouTube Shorts",
    short: "SHORTS",
    style: "border-amber-warn/50 bg-amber-warn/15 text-amber-warn",
  },
};

const STATUS_STYLES: Record<PostStatus, { label: string; style: string }> = {
  Unklar: { label: "In Buffer prüfen", style: "border-amber-warn text-amber-warn" },
  Geplant: {
    label: "Geplant",
    style: "border-volt-400/50 bg-volt-400/15 text-volt-300",
  },
  "Wird veröffentlicht": {
    label: "Wird veröffentlicht",
    style: "border-amber-warn/50 bg-amber-warn/15 text-amber-warn animate-pulse",
  },
  Veröffentlicht: {
    label: "Veröffentlicht",
    style: "border-mint-400/50 bg-mint-400/15 text-mint-400",
  },
  Fehler: {
    label: "Fehler",
    style: "border-rose-err/60 bg-rose-err/15 text-rose-err",
  },
};

type ViewMode = CalendarViewMode;

const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

function berlinClock(iso: string): { hour: number; minute: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = getBerlinParts(date);
  return { hour: parts.hour, minute: parts.minute };
}

function occupiesBerlinSlot(post: ScheduledPost, hour: number): boolean {
  const clock = berlinClock(post.scheduledAt);
  return clock?.hour === hour && clock.minute === 0;
}

const PLATFORM_RAIL: Record<SocialPlatform, string> = {
  tiktok: "border-l-volt-400",
  instagram: "border-l-ember-400",
  youtube: "border-l-amber-warn",
};

function ClipThumb({ post, frameClass }: { post: ScheduledPost; frameClass: string }) {
  return (
    <span className={cn("sf-cal-thumb relative block shrink-0 overflow-hidden border border-coal-700 bg-black", frameClass)}>
      {post.thumbnailUrl ? (
        <img src={post.thumbnailUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      ) : post.videoUrl ? (
        <video
          src={post.videoUrl}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full max-h-full max-w-full object-cover"
        />
      ) : (
        <Film className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-coal-500" />
      )}
    </span>
  );
}

function SlotPills({ posts, roomy = false }: { posts: ScheduledPost[]; roomy?: boolean }) {
  const has06 = posts.some((post) => occupiesBerlinSlot(post, 6));
  const has20 = posts.some((post) => occupiesBerlinSlot(post, 20));
  return (
    <div className={cn("mt-auto flex min-w-0 flex-wrap items-center gap-1 border-t border-coal-700/50 pt-2 font-mono", roomy ? "text-[10px]" : "text-[8px]")}>
      <span className={cn("truncate", has06 ? "text-coal-500" : "text-mint-400")}>
        06:00 {has06 ? "●" : "○"}{roomy ? (has06 ? " Belegt" : " Frei") : ""}
      </span>
      <span className={cn("truncate", has20 ? "text-coal-500" : "text-mint-400")}>
        20:00 {has20 ? "●" : "○"}{roomy ? (has20 ? " Belegt" : " Frei") : ""}
      </span>
    </div>
  );
}

function DayCell({
  day,
  posts,
  isToday,
  inMonth,
  onOpen,
  onFocusDay,
}: {
  day: BerlinCalendarDay;
  posts: ScheduledPost[];
  isToday: boolean;
  inMonth: boolean;
  onOpen: (post: ScheduledPost) => void;
  onFocusDay: () => void;
}) {
  const weekdayName = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(day.instant);
  const dateNum = `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.`;

  return (
    <div
      data-berlin-day={day.key}
      className={cn(
        "sf-cal-day flex min-h-[148px] min-w-0 flex-col gap-2 overflow-hidden rounded-xl border p-2 sm:p-2.5",
        isToday
          ? "border-volt-400/70 bg-coal-850/90"
          : inMonth
            ? "border-coal-700/80 bg-coal-850/40"
            : "border-coal-700/40 bg-coal-900/30",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-1 border-b border-coal-700/60 pb-1.5">
        <button
          type="button"
          onClick={onFocusDay}
          className={cn(
            "min-w-0 truncate text-left font-mono text-[11px] font-bold uppercase",
            isToday ? "text-volt-300" : inMonth ? "text-coal-300" : "text-coal-500",
          )}
          aria-label={`${weekdayName} ${dateNum} öffnen, ${posts.length} Videos`}
        >
          {weekdayName} · {dateNum}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          {posts.length > 0 && (
            <span className="border border-coal-600 px-1 py-px font-mono text-[8px] font-bold text-coal-200">
              {posts.length}
            </span>
          )}
          {isToday && (
            <span className="bg-heat px-1.5 py-0.5 font-mono text-[8px] font-bold text-coal-950">
              HEUTE
            </span>
          )}
        </span>
      </div>

      {posts.length === 0 ? (
        <p className="sf-cal-empty font-mono text-[9px] text-coal-500">Keine Videos</p>
      ) : (
        <div className="sf-cal-posts flex min-w-0 flex-col gap-1.5">
          {posts.map((post) => {
            const fmt = formatBerlinDateTime(post.scheduledAt);
            const platform = PLATFORM_BADGES[post.platform] || PLATFORM_BADGES.tiktok;
            const status = STATUS_STYLES[post.status] || STATUS_STYLES.Geplant;
            return (
              <button
                key={post.id}
                type="button"
                data-post-id={post.id}
                data-berlin-day={day.key}
                onClick={() => onOpen(post)}
                className={cn(
                  "sf-cal-chip flex w-full min-w-0 items-center gap-1.5 overflow-hidden border border-coal-700 border-l-2 bg-coal-900 px-1.5 py-1 text-left hover:border-volt-400",
                  PLATFORM_RAIL[post.platform] || PLATFORM_RAIL.tiktok,
                )}
              >
                <ClipThumb post={post} frameClass="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center justify-between gap-1">
                    <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[9px] font-bold text-volt-300">
                      <Clock className="size-3 shrink-0" />
                      <span className="truncate">{fmt.timeStr}</span>
                    </span>
                    <span className={cn("shrink-0 border px-1 py-px font-mono text-[7px] font-bold uppercase", platform.style)}>
                      {platform.short}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate font-display text-[11px] font-bold text-paper-100">
                    {post.title}
                  </span>
                  <span className={cn("sf-cal-chip-status mt-0.5 inline-block max-w-full truncate border px-1 py-px font-mono text-[7px] font-bold uppercase", status.style)}>
                    {status.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <SlotPills posts={posts} />
    </div>
  );
}

function DayAgenda({
  day,
  posts,
  onOpen,
}: {
  day: BerlinCalendarDay;
  posts: ScheduledPost[];
  onOpen: (post: ScheduledPost) => void;
}) {
  return (
    <div data-berlin-day={day.key} className="sf-day-agenda grid min-w-0 gap-3">
      {posts.length === 0 ? (
        <p className="border border-dashed border-coal-700 px-4 py-8 text-center font-mono text-xs text-coal-400">
          Keine Videos an diesem Tag.
        </p>
      ) : (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {posts.map((post) => {
            const fmt = formatBerlinDateTime(post.scheduledAt);
            const platform = PLATFORM_BADGES[post.platform] || PLATFORM_BADGES.tiktok;
            const status = STATUS_STYLES[post.status] || STATUS_STYLES.Geplant;
            return (
              <button
                key={post.id}
                type="button"
                data-post-id={post.id}
                data-berlin-day={day.key}
                onClick={() => onOpen(post)}
                className={cn(
                  "grid w-full min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-stretch gap-3 overflow-hidden border border-coal-700 border-l-2 bg-coal-900 p-2 text-left hover:border-volt-400 sm:grid-cols-[5.5rem_minmax(0,1fr)]",
                  PLATFORM_RAIL[post.platform] || PLATFORM_RAIL.tiktok,
                )}
              >
                <span className="relative block overflow-hidden border border-coal-700 bg-black" style={{ aspectRatio: "9 / 16" }}>
                  {post.thumbnailUrl ? (
                    <img src={post.thumbnailUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
                  ) : post.videoUrl ? (
                    <video
                      src={post.videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="pointer-events-none absolute inset-0 h-full w-full max-h-full max-w-full object-cover"
                    />
                  ) : (
                    <Film className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-coal-500" />
                  )}
                </span>
                <span className="min-w-0 self-center">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-volt-300">{fmt.timeStr}</span>
                    <span className={cn("border px-1.5 py-px font-mono text-[8px] font-bold uppercase", platform.style)}>
                      {platform.label}
                    </span>
                    <span className={cn("max-w-full truncate border px-1.5 py-px font-mono text-[8px] font-bold uppercase", status.style)}>
                      {status.label}
                    </span>
                  </span>
                  <span className="mt-1 block truncate font-display text-sm font-bold text-paper-100">{post.title}</span>
                  {post.description ? (
                    <span className="mt-1 line-clamp-2 block font-mono text-[10px] leading-relaxed text-coal-400">
                      {post.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <SlotPills posts={posts} roomy />
    </div>
  );
}

export default function CalendarView({
  posts,
  hasApiKey,
  onPostsChange,
}: {
  posts: ScheduledPost[];
  hasApiKey: boolean;
  onPostsChange: (updated: ScheduledPost[]) => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [bufferCfg, setBufferCfg] = useState<BufferConfigState>(() => loadBufferConfig());
  const [busyPostId, setBusyPostId] = useState<string | null>(null);

  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState<boolean | null>(null);

  /* Swipe navigation — flick left/right to move the calendar window (iPad).
     A horizontal scroll inside the month board (so columns stay aligned)
     must not also flip the month. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = {
      x: t.clientX,
      y: t.clientY,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
    };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    if (Math.abs((scrollRef.current?.scrollLeft ?? 0) - start.scrollLeft) > 4) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.6) shiftCursor(dx < 0 ? 1 : -1);
  };
  async function refresh() {
    setRefreshing(true); setActionError("");
    try { const data = await fetchScheduledPosts(); onPostsChange(data.posts); setConnection(data.hasApiKey); }
    catch (e) { setConnection(false); setActionError(e instanceof Error ? e.message : String(e)); }
    finally { setRefreshing(false); }
  }

  /* ------------------------------------------------------------ */
  /*  Dashboard Metrics Calculation (Europe/Berlin)                */
  /* ------------------------------------------------------------ */

  const metrics = useMemo(() => {
    const now = new Date();
    const todayParts = getBerlinParts(now);
    const todayStr = berlinDateKey(now);
    const tomorrowStr = civilDateKey(addCivilDays(todayParts.year, todayParts.month, todayParts.day, 1));

    const fiveDaysEnd = new Date(now.getTime() + 5 * 24 * 3600 * 1000);

    let geplante = 0;
    let heute = 0;
    let morgen = 0;
    let naechste5Tage = 0;
    let veroeffentlicht = 0;
    let fehlgeschlagen = 0;

    for (const p of posts) {
      const pDate = new Date(p.scheduledAt);
      const pDateStr = berlinDateKey(pDate);

      if (p.status === "Geplant" || p.status === "Wird veröffentlicht") geplante++;
      if (p.status === "Veröffentlicht") veroeffentlicht++;
      if (p.status === "Fehler") fehlgeschlagen++;

      if (pDateStr === todayStr) heute++;
      if (pDateStr === tomorrowStr) morgen++;
      if (pDate >= now && pDate <= fiveDaysEnd) naechste5Tage++;
    }

    // Check how many free 06:00 / 20:00 slots remain in the next 5 days (10 slots total)
    const freeSlotsNext5Days = findNextFreeBerlinSlots(posts, 10).filter((s) => {
      const d = new Date(s.scheduledAt);
      return d <= fiveDaysEnd;
    }).length;

    return {
      geplante,
      heute,
      morgen,
      naechste5Tage,
      veroeffentlicht,
      fehlgeschlagen,
      freeSlotsNext5Days,
    };
  }, [posts]);

  /* ------------------------------------------------------------ */
  /*  Post Actions: Retry & Delete                                 */
  /* ------------------------------------------------------------ */

  const handleRetry = async (post: ScheduledPost) => {
    setBusyPostId(post.id);
    setActionError("");
    try {
      const updated = await retryScheduledPost(post.id);
      onPostsChange(updated);
      const refreshed = updated.find((x) => x.id === post.id) || null;
      setSelectedPost(refreshed);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPostId(null);
    }
  };

  const handleDelete = async (post: ScheduledPost) => {
    setBusyPostId(post.id);
    setActionError("");
    try {
      const updated = await deleteScheduledPost(post.id);
      onPostsChange(updated);
      setSelectedPost(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPostId(null);
    }
  };

  /* ------------------------------------------------------------ */
  /*  Calendar Navigation Helpers                                  */
  /* ------------------------------------------------------------ */

  const shiftCursor = (direction: -1 | 1) => {
    setCursorDate((current) => shiftBerlinCursor(current, viewMode, direction));
  };

  const jumpToToday = () => setCursorDate(new Date());

  const openDay = (day: BerlinCalendarDay) => {
    setCursorDate(day.instant);
    setViewMode("day");
  };

  // Berlin civil dates only — local setDate/getDay would park a post on the
  // neighbouring column whenever the browser zone is not Europe/Berlin.
  const viewDays = useMemo(
    () => berlinCalendarDays(cursorDate, viewMode),
    [cursorDate, viewMode],
  );

  const postsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const day of viewDays) map.set(day.key, postsOnBerlinDay(posts, day.key));
    return map;
  }, [posts, viewDays]);

  const cursorBerlin = useMemo(() => getBerlinParts(cursorDate), [cursorDate]);
  const todayKey = berlinDateKey(new Date());

  const headerTitle = useMemo(() => {
    if (viewMode === "day" && viewDays[0]) {
      return new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(viewDays[0].instant);
    }
    if (viewMode === "week" && viewDays.length === 7) {
      const fmt = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        day: "numeric",
        month: "short",
      });
      return `${fmt.format(viewDays[0].instant)} – ${fmt.format(viewDays[6].instant)} ${viewDays[6].year}`;
    }
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      month: "long",
      year: "numeric",
    }).format(cursorDate);
  }, [cursorDate, viewMode, viewDays]);

  return (
    <div className="grid min-w-0 gap-6 animate-rise">
      {actionError && <p role="alert" className="border border-rose-err p-3 font-mono text-xs text-rose-err">{actionError}</p>}
      <p className="font-mono text-[10px] text-coal-400">Lokales Versandjournal dieses Browsers. Status wird nur nach Buffer-Bestätigung geändert; externe Buffer-Posts werden nicht importiert.</p>
      {/* ============================================================ */}
      {/*  DASHBOARD METRICS BAR                                       */}
      {/* ============================================================ */}
      <section className="card-bracket min-w-0 border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-coal-700/70 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-heat grid size-10 place-items-center text-coal-950">
              <CalendarIcon className="size-5" strokeWidth={2.4} />
            </div>
            <div>
              <h2 className="font-display text-lg font-black tracking-tight uppercase text-paper-100">
                Social Media Kalender & Buffer Dashboard
              </h2>
              <p className="font-mono text-[10.5px] text-coal-300">
                Automatische Slots: <strong className="text-volt-300">06:00 Uhr</strong> &{" "}
                <strong className="text-volt-300">20:00 Uhr</strong> · Zeitzone:{" "}
                <strong className="text-volt-300">Europe/Berlin</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button disabled={refreshing} onClick={refresh} className="border border-coal-600 px-3 py-2 font-mono text-xs text-volt-300 disabled:opacity-50">{refreshing ? "Lädt …" : "Buffer-Status aktualisieren"}</button>
            <a href="https://publish.buffer.com" target="_blank" rel="noreferrer" className="font-mono text-xs text-volt-300">Buffer öffnen ↗</a>
            <span
              className={cn(
                "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider",
                (connection ?? hasApiKey)
                  ? "border-volt-400/50 bg-volt-400/10 text-volt-300"
                  : "border-amber-warn/50 bg-amber-warn/10 text-amber-warn"
              )}
            >
              <Globe className="size-3.5" />
              {(connection ?? hasApiKey) ? "BUFFER API KONFIGURIERT" : "BUFFER NICHT VERBUNDEN"}
            </span>
            <button
              type="button"
              onClick={() => { setBufferCfg(loadBufferConfig()); setShowConfigModal(true); }}
              className="flex items-center gap-1.5 border border-coal-600 bg-coal-850 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 hover:border-volt-400 hover:text-volt-300"
            >
              <SettingsIcon className="size-3.5" /> BUFFER KANÄLE
            </button>
          </div>
        </div>

        {/* 7 Dashboard KPI Cards */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {[
            {
              label: "GEPLANTE POSTS",
              value: metrics.geplante,
              sub: "In Warteschlange",
              tone: "text-volt-300",
            },
            {
              label: "HEUTE",
              value: metrics.heute,
              sub: "06:00 & 20:00",
              tone: "text-paper-100",
            },
            {
              label: "MORGEN",
              value: metrics.morgen,
              sub: "Eingeplant",
              tone: "text-paper-100",
            },
            {
              label: "NÄCHSTE 5 TAGE",
              value: metrics.naechste5Tage,
              sub: "Aktives Fenster",
              tone: "text-volt-300",
            },
            {
              label: "FREIE SLOTS (5 TAGE)",
              value: metrics.freeSlotsNext5Days,
              sub: "Noch verfügbar",
              tone: "text-mint-400",
            },
            {
              label: "VERÖFFENTLICHT",
              value: metrics.veroeffentlicht,
              sub: "Erfolgreich",
              tone: "text-mint-400",
            },
            {
              label: "FEHLGESCHLAGEN",
              value: metrics.fehlgeschlagen,
              sub: "Erneut versuchen",
              tone: metrics.fehlgeschlagen > 0 ? "text-rose-err" : "text-coal-400",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-coal-700/80 bg-coal-850/80 p-3 text-left transition-colors hover:border-coal-600"
            >
              <span className="mono-label block text-[8.5px] text-coal-400">{card.label}</span>
              <span className={cn("mt-1 block font-display text-2xl font-black", card.tone)}>
                {card.value}
              </span>
              <span className="font-mono text-[9px] text-coal-400">{card.sub}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CALENDAR CONTROLS & GRID                                    */}
      {/* ============================================================ */}
      <section className="card-bracket min-w-0 border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftCursor(-1)}
              className="grid size-11 place-items-center border border-coal-600 text-coal-300 transition-colors hover:border-volt-400 hover:text-volt-300"
              aria-label="Zurück"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={jumpToToday}
              className="border border-coal-600 px-4 py-2.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 transition-colors hover:border-volt-400 hover:text-volt-300"
            >
              HEUTE
            </button>
            <button
              type="button"
              onClick={() => shiftCursor(1)}
              className="grid size-11 place-items-center border border-coal-600 text-coal-300 transition-colors hover:border-volt-400 hover:text-volt-300"
              aria-label="Weiter"
            >
              <ChevronRight className="size-5" />
            </button>
            <h3 className="ml-2 font-display text-base font-black uppercase text-paper-100">
              {headerTitle}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["month", "Monatsansicht"],
                ["week", "Wochenansicht"],
                ["day", "Tagesansicht"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "border px-3.5 py-2.5 font-mono text-[10px] font-bold tracking-widest transition-colors",
                  viewMode === mode
                    ? "bg-heat border-volt-400 text-coal-950"
                    : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 font-mono text-[10px] leading-relaxed text-coal-400">
          Jedes Video liegt nur auf seinem Europe/Berlin-Tag. Nachbarspalten überdecken sich nicht
          {viewMode === "month" ? " — auf schmalen Screens die Woche seitlich wischen." : "."}
        </p>

        <div
          ref={scrollRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={cn("sf-cal-scroll mt-3 min-w-0", viewMode === "month" && "sf-cal-scroll--month")}
        >
          {viewMode === "day" && viewDays[0] ? (
            <DayAgenda
              day={viewDays[0]}
              posts={postsByDay.get(viewDays[0].key) ?? []}
              onOpen={setSelectedPost}
            />
          ) : (
          <div className={cn("sf-cal-board", viewMode === "month" && "sf-cal-board--month")}>
            <div
              className={cn(
                "sf-cal-weekdays mb-2 grid-cols-7 gap-2 border-b border-coal-700/60 pb-2",
                viewMode === "week" ? "hidden lg:grid" : "grid",
              )}
            >
              {WEEKDAYS_DE.map((day) => (
                <span key={day} className="mono-label truncate text-center text-[8.5px] text-coal-400">
                  {day}
                </span>
              ))}
            </div>

            <div
              className={cn(
                "grid gap-2",
                viewMode === "week" ? "grid-cols-1 lg:grid-cols-7" : "grid-cols-7",
              )}
            >
              {viewDays.map((day) => (
                <DayCell
                  key={day.key}
                  day={day}
                  posts={postsByDay.get(day.key) ?? []}
                  isToday={day.key === todayKey}
                  inMonth={viewMode !== "month" || day.month === cursorBerlin.month}
                  onOpen={setSelectedPost}
                  onFocusDay={() => openDay(day)}
                />
              ))}
            </div>
          </div>
          )}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  POST DETAIL MODAL (DETAILFENSTER)                           */}
      {/* ============================================================ */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-coal-950/90 p-4 overflow-y-auto"
          onClick={() => setSelectedPost(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card-bracket relative w-full max-w-2xl border border-coal-600 bg-coal-900 p-5 sm:p-6 my-8 animate-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-coal-700/70 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "border px-2 py-0.5 font-mono text-[9px] font-bold uppercase",
                      PLATFORM_BADGES[selectedPost.platform]?.style
                    )}
                  >
                    {PLATFORM_BADGES[selectedPost.platform]?.label}
                  </span>
                  <span
                    className={cn(
                      "border px-2 py-0.5 font-mono text-[9px] font-bold uppercase",
                      STATUS_STYLES[selectedPost.status]?.style
                    )}
                  >
                    {selectedPost.status}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-lg font-black uppercase text-paper-100">
                  {selectedPost.title}
                </h3>
                <p className="font-mono text-[11px] text-volt-300">
                  Geplant für: {formatBerlinDateTime(selectedPost.scheduledAt).fullStr} (Europe/Berlin)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                className="border border-coal-600 p-2 text-coal-300 hover:border-volt-400 hover:text-volt-300"
              >
                <X className="size-4" />
              </button>
            </div>

            {actionError && <p role="alert" className="mt-3 text-xs text-rose-err">{actionError}</p>}
            <div className="mt-5 grid min-w-0 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
              {/* Video stays inside its 9:16 frame — intrinsic size must not cover the metadata. */}
              <div className="sf-cal-agenda relative min-w-0 overflow-hidden border border-coal-700 bg-black" style={{ aspectRatio: "9 / 16" }}>
                {selectedPost.videoUrl ? (
                  <video
                    src={selectedPost.videoUrl}
                    controls
                    playsInline
                    className="absolute inset-0 h-full w-full bg-black object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-coal-850 text-coal-500">
                    <div className="p-4 text-center">
                      <Film className="mx-auto mb-2 size-8" />
                      <span className="font-mono text-[10px]">Video-Vorschau</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Post Metadata */}
              <div className="flex flex-col justify-between gap-4">
                <div className="grid gap-3">
                  <div>
                    <span className="mono-label block text-[9px] text-coal-400">BESCHREIBUNG</span>
                    <p className="mt-1 whitespace-pre-wrap border border-coal-700/80 bg-coal-850 p-3 font-mono text-[11px] leading-relaxed text-coal-200">
                      {selectedPost.description || "Keine Beschreibung angegeben."}
                    </p>
                  </div>

                  <div>
                    <span className="mono-label block text-[9px] text-coal-400">HASHTAGS</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(selectedPost.hashtags || []).map((tag, i) => (
                        <span
                          key={i}
                          className="border border-coal-700 bg-coal-850 px-2 py-0.5 font-mono text-[10px] text-volt-300"
                        >
                          {tag.startsWith("#") ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border border-coal-700/60 bg-coal-850/50 p-3 font-mono text-[10px]">
                    <div>
                      <span className="text-coal-400 block">BUFFER POST ID:</span>
                      <span className="text-paper-100 font-bold">
                        {selectedPost.bufferPostId || "Ausstehend"}
                      </span>
                    </div>
                    <div>
                      <span className="text-coal-400 block">ZEITZONE:</span>
                      <span className="text-paper-100 font-bold">Europe/Berlin</span>
                    </div>
                  </div>

                  {selectedPost.errorMessage && (
                    <div className="border border-rose-err/50 bg-rose-err/10 p-3">
                      <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-bold text-rose-err">
                        <AlertTriangle className="size-4 shrink-0" />
                        Veröffentlichungs-Fehler
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-coal-200">
                        {selectedPost.errorMessage}
                      </p>
                    </div>
                  )}
                </div>

                {/* Modal Footer Actions: Retry & Delete */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-coal-700/70 pt-4">
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedPost)}
                    disabled={busyPostId === selectedPost.id}
                    className="flex items-center gap-1.5 border border-rose-err/60 bg-rose-err/10 px-4 py-2.5 font-mono text-[10.5px] font-bold text-rose-err hover:bg-rose-err hover:text-coal-950 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" /> Geplanten Post löschen
                  </button>

                  <div className="flex items-center gap-2">
                    {selectedPost.status === "Fehler" && !selectedPost.bufferPostId && (
                      <button
                        type="button"
                        onClick={() => handleRetry(selectedPost)}
                        disabled={busyPostId === selectedPost.id}
                        className="bg-heat flex items-center gap-1.5 border border-volt-400 px-4 py-2.5 font-display text-xs font-black uppercase text-coal-950"
                      >
                        <RotateCw className="size-3.5" /> Erneut versuchen (Buffer Retry)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedPost(null)}
                      className="border border-coal-600 px-4 py-2.5 font-mono text-[10.5px] font-bold text-coal-200 hover:border-volt-400"
                    >
                      Fertig
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  BUFFER CHANNELS & CONFIGURATION MODAL                       */}
      {/* ============================================================ */}
      {showConfigModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-coal-950/90 p-4 overflow-y-auto"
          onClick={() => setShowConfigModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card-bracket relative w-full max-w-3xl border border-coal-600 bg-coal-900 p-5 sm:p-6 my-8 animate-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-coal-700/70 pb-4">
              <div>
                <h3 className="font-display text-base font-black uppercase text-paper-100">
                  Buffer Social-Media-Kanäle
                </h3>
                <p className="font-mono text-[10.5px] text-coal-300">
                  Verwalte deine Kanal-IDs für TikTok, Instagram und YouTube Shorts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="border border-coal-600 p-1.5 text-coal-300"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4"><BufferChannels config={bufferCfg} onChange={setBufferCfg} /></div>
            <button onClick={() => setShowConfigModal(false)} className="bg-heat mt-5 flex min-h-[44px] items-center justify-center px-5 py-3 font-bold text-coal-950">Fertig</button>
          </div>
        </div>
      )}
    </div>
  );
}
