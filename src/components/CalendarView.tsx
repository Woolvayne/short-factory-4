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
  deleteScheduledPost,
  fetchScheduledPosts,
  findNextFreeBerlinSlots,
  formatBerlinDateTime,
  getBerlinParts,
  loadBufferConfig,
  retryScheduledPost,
  type PostStatus,
  type ScheduledPost,
  type SocialPlatform,
  type BufferConfigState,
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

type ViewMode = "month" | "week" | "day";

const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

function getBerlinDateStr(date: Date): string {
  const p = getBerlinParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
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

  /* Swipe navigation — flick left/right to move the calendar window (iPad). */
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
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
    const todayStr = getBerlinDateStr(now);

    const tomorrowDate = new Date(now.getTime() + 24 * 3600 * 1000);
    const tomorrowStr = getBerlinDateStr(tomorrowDate);

    const fiveDaysEnd = new Date(now.getTime() + 5 * 24 * 3600 * 1000);

    let geplante = 0;
    let heute = 0;
    let morgen = 0;
    let naechste5Tage = 0;
    let veroeffentlicht = 0;
    let fehlgeschlagen = 0;

    for (const p of posts) {
      const pDate = new Date(p.scheduledAt);
      const pDateStr = getBerlinDateStr(pDate);

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
    const next = new Date(cursorDate);
    if (viewMode === "month") {
      next.setMonth(next.getMonth() + direction);
    } else if (viewMode === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setDate(next.getDate() + direction);
    }
    setCursorDate(next);
  };

  const jumpToToday = () => setCursorDate(new Date());

  // Build days array for current view
  const viewDays = useMemo(() => {
    const days: Date[] = [];
    if (viewMode === "day") {
      days.push(new Date(cursorDate));
    } else if (viewMode === "week") {
      // Start week on Monday
      const d = new Date(cursorDate);
      const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const monday = new Date(d);
      monday.setDate(d.getDate() - dayOfWeek);
      for (let i = 0; i < 7; i++) {
        const current = new Date(monday);
        current.setDate(monday.getDate() + i);
        days.push(current);
      }
    } else {
      // Month view
      const year = cursorDate.getFullYear();
      const month = cursorDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
      const startDate = new Date(year, month, 1 - startOffset);
      for (let i = 0; i < 35; i++) {
        const current = new Date(startDate);
        current.setDate(startDate.getDate() + i);
        days.push(current);
      }
    }
    return days;
  }, [cursorDate, viewMode]);

  const headerTitle = useMemo(() => {
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      month: "long",
      year: "numeric",
    }).format(cursorDate);
  }, [cursorDate]);

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

        {/* Weekday header (month grid) */}
        {viewMode === "month" && (
          <div className="mt-4 hidden gap-3 border-b border-coal-700/60 pb-2 sm:grid sm:grid-cols-7">
            {WEEKDAYS_DE.map((day) => (
              <span key={day} className="mono-label text-center text-[8.5px] text-coal-400">
                {day}
              </span>
            ))}
          </div>
        )}

        {/* Calendar Grid */}
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={cn(
            "grid gap-3",
            viewMode === "month" ? "mt-4 sm:mt-3" : "mt-4",
            viewMode === "month"
              ? "grid-cols-1 sm:grid-cols-7"
              : viewMode === "week"
                ? "grid-cols-1 md:grid-cols-7"
                : "grid-cols-1"
          )}
        >
          {viewDays.map((dayDate) => {
            const dayStr = getBerlinDateStr(dayDate);
            const todayStr = getBerlinDateStr(new Date());
            const isToday = dayStr === todayStr;

            const dayPosts = posts
              .filter((p) => getBerlinDateStr(new Date(p.scheduledAt)) === dayStr)
              .sort(
                (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
              );

            // Check if 06:00 and 20:00 slots are occupied
            const has06 = dayPosts.some((p) => {
              const parts = getBerlinParts(new Date(p.scheduledAt));
              return parts.hour === 6;
            });
            const has20 = dayPosts.some((p) => {
              const parts = getBerlinParts(new Date(p.scheduledAt));
              return parts.hour === 20;
            });

            const weekdayName = new Intl.DateTimeFormat("de-DE", {
              timeZone: "Europe/Berlin",
              weekday: "short",
            }).format(dayDate);

            const dateNum = new Intl.DateTimeFormat("de-DE", {
              timeZone: "Europe/Berlin",
              day: "2-digit",
              month: "2-digit",
            }).format(dayDate);

            return (
              <div
                key={dayStr}
                className={cn(
                  "flex min-h-[170px] flex-col justify-between rounded-xl border p-3 transition-colors",
                  isToday
                    ? "border-volt-400/70 bg-coal-850/90"
                    : "border-coal-700/80 bg-coal-850/40 hover:border-coal-600"
                )}
              >
                <div>
                  {/* Day Header */}
                  <div className="flex items-center justify-between border-b border-coal-700/60 pb-2">
                    <span
                      className={cn(
                        "font-mono text-[11px] font-bold uppercase",
                        isToday ? "text-volt-300" : "text-coal-300"
                      )}
                    >
                      {weekdayName} · {dateNum}
                    </span>
                    {isToday && (
                      <span className="bg-heat px-1.5 py-0.5 font-mono text-[8px] font-bold text-coal-950">
                        HEUTE
                      </span>
                    )}
                  </div>

                  {/* Scheduled Post Cards for this Day */}
                  <div className="mt-2.5 grid gap-2">
                    {dayPosts.map((post) => {
                      const fmt = formatBerlinDateTime(post.scheduledAt);
                      const pMeta = PLATFORM_BADGES[post.platform] || PLATFORM_BADGES.tiktok;
                      const sMeta = STATUS_STYLES[post.status] || STATUS_STYLES.Geplant;

                      return (
                        <button
                          key={post.id}
                          type="button"
                          onClick={() => setSelectedPost(post)}
                          className="group flex w-full flex-col gap-1.5 border border-coal-700 bg-coal-900 p-2.5 text-left transition-all hover:border-volt-400"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-volt-300">
                              <Clock className="size-3" /> {fmt.timeStr}
                            </span>
                            <span
                              className={cn(
                                "border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase",
                                pMeta.style
                              )}
                            >
                              {pMeta.short}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {post.videoUrl ? (
                              <div className="relative size-9 shrink-0 overflow-hidden border border-coal-700 bg-black">
                                <video
                                  src={post.videoUrl}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="grid size-9 shrink-0 place-items-center border border-coal-700 bg-coal-850 text-coal-400">
                                <Film className="size-4" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-display text-xs font-bold text-paper-100">
                                {post.title}
                              </p>
                              <span
                                className={cn(
                                  "mt-0.5 inline-block border px-1.5 py-px font-mono text-[8px] font-bold uppercase",
                                  sMeta.style
                                )}
                              >
                                {sMeta.label}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Slot Availability Footer for 06:00 & 20:00 */}
                <div className="mt-3 flex items-center justify-between border-t border-coal-700/50 pt-2 font-mono text-[9.5px]">
                  <span className={has06 ? "text-coal-500" : "text-mint-400"}>
                    06:00 {has06 ? "● Belegt" : "○ Frei"}
                  </span>
                  <span className={has20 ? "text-coal-500" : "text-mint-400"}>
                    20:00 {has20 ? "● Belegt" : "○ Frei"}
                  </span>
                </div>
              </div>
            );
          })}
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
            <div className="mt-5 grid gap-5 sm:grid-cols-[200px_1fr]">
              {/* Video Preview */}
              <div className="overflow-hidden border border-coal-700 bg-black">
                {selectedPost.videoUrl ? (
                  <video
                    src={selectedPost.videoUrl}
                    controls
                    playsInline
                    className="h-auto w-full object-cover"
                    style={{ aspectRatio: "9 / 16" }}
                  />
                ) : (
                  <div
                    className="grid place-items-center bg-coal-850 text-coal-500"
                    style={{ aspectRatio: "9 / 16" }}
                  >
                    <div className="text-center p-4">
                      <Film className="mx-auto size-8 mb-2" />
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
            <button onClick={() => setShowConfigModal(false)} className="bg-heat mt-5 px-5 py-3 font-bold text-coal-950">Fertig</button>
          </div>
        </div>
      )}
    </div>
  );
}
