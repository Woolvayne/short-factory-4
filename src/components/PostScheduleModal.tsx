import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, Send, X } from 'lucide-react';
import type { LocalRenderItem } from '../lib/types';
import { DEFAULT_DESCRIPTION, formatBerlinDateTime, loadBufferConfig, planSlots, saveBufferConfig, scheduleBatchPosts, validateVideoUrl, type DispatchProgress, type ScheduledPost, type ScheduleMode } from '../lib/scheduler';
import BufferChannels from './BufferChannels';

const inputClass = 'w-full border border-coal-600 bg-coal-850 px-3 py-2 font-mono text-xs text-paper-100 focus:border-volt-400 focus:outline-none disabled:opacity-50';
export default function PostScheduleModal({ targetItems, existingPosts, onClose, onScheduled, onOpenCalendar }: {
  targetItems: LocalRenderItem[]; existingPosts: ScheduledPost[]; onClose: () => void;
  onScheduled: (posts: ScheduledPost[]) => void; onOpenCalendar: () => void;
}) {
  const [config, setConfig] = useState(loadBufferConfig);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [mode, setMode] = useState<ScheduleMode>('queue');
  const [times, setTimes] = useState('06:00, 20:00');
  const [startDate, setStartDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [dayStep, setDayStep] = useState(1);
  const [rows, setRows] = useState(() => targetItems.filter(i => i.status === 'done').map(item => ({ item, selected: true, url: '', title: item.idea })));
  const [bulkUrls, setBulkUrls] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [result, setResult] = useState<ScheduledPost[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const active = rows.filter(r => r.selected);
  const plan = { mode, count: active.length, times: times.split(/[,\s]+/).filter(Boolean), startDate, dayStep };
  const slots = planSlots(existingPosts, plan);
  const total = active.length * config.defaultPlatforms.length;
  const valid = active.length > 0 && total > 0 && active.every(r => !validateVideoUrl(r.url.trim())) && config.defaultPlatforms.every(p => config[`${p}ChannelId`].trim()) && acknowledged;

  useEffect(() => {
    function key(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    function unload(e: BeforeUnloadEvent) { e.preventDefault(); }
    window.addEventListener('keydown', key);
    if (submitting) window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [submitting, onClose]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    if (submitting || !valid) return;
    setError('');
    if (mode === 'custom' && (!plan.times.length || plan.times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || !startDate)) {
      setError('Bitte gültige Uhrzeiten (HH:mm) und ein Startdatum eingeben.'); return;
    }
    setSubmitting(true); abortRef.current = new AbortController();
    try {
      saveBufferConfig(config);
      const response = await scheduleBatchPosts({
        items: active.map(r => ({ videoUrl: r.url.trim(), title: r.title, description })), config, plan,
        onProgress: setProgress, onPostsChange: onScheduled, signal: abortRef.current.signal,
      });
      setResult(response.createdPosts); onScheduled(response.allPosts);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-coal-950/95 p-4" role="dialog" aria-modal="true" aria-labelledby="buffer-title">
    <div className="card-bracket mx-auto my-6 max-w-4xl border border-coal-600 bg-coal-900 p-5 sm:p-7">
      <div className="flex items-start justify-between gap-3 border-b border-coal-700 pb-4">
        <div><span className="bg-heat px-2 py-1 font-mono text-[10px] font-bold text-coal-950">BUFFER DISPATCH</span>
          <h2 id="buffer-title" className="mt-3 font-display text-2xl font-black uppercase text-paper-100">Fertig gerendert. Bereit für Buffer.</h2>
          <p className="mt-1 font-mono text-xs text-coal-300">Alle Videos am Ende senden — nacheinander, mit kurzer Pause.</p></div>
        <button aria-label="Schließen" disabled={submitting} onClick={onClose} className="border border-coal-600 p-2 text-coal-300 disabled:opacity-40"><X className="size-4" /></button>
      </div>
      {result ? <div className="grid gap-4 py-6">
        <Check className="size-8 text-volt-300" />
        <h3 className="font-display text-xl font-bold text-paper-100">{result.filter(p => p.bufferPostId).length} von {total} Posts von Buffer angenommen</h3>
        <p className="font-mono text-xs text-coal-300">Angenommen heißt nicht veröffentlicht. Den aktuellen Status kannst du im Kalender aktualisieren oder direkt in Buffer prüfen.</p>
        {result.some(p => p.status === 'Fehler' || p.status === 'Unklar') && <p className="font-mono text-xs text-amber-warn">Es gab Fehler oder unklare Antworten. Bestätigte Posts nicht erneut senden; Details und sichere Wiederholung stehen im Kalender.</p>}
        {result.length < total && <p className="font-mono text-xs text-amber-warn">Der Versand wurde vorzeitig gestoppt. Nicht gesendete Video/Kanal-Kombinationen kannst du in einem neuen Versand auswählen.</p>}
        {result.map(p => <div key={p.id} className="border border-coal-700 p-3 font-mono text-xs text-coal-200">{p.title} · {p.platform} · {p.status}{p.errorMessage && <p className="mt-1 text-amber-warn">{p.errorMessage}</p>}</div>)}
        <button onClick={() => { onClose(); onOpenCalendar(); }} className="bg-heat px-5 py-3 font-bold text-coal-950">Zum Kalender</button>
      </div> : <div className="mt-5 grid gap-6">
        <div className="border border-amber-warn/40 bg-amber-warn/5 p-3 font-mono text-xs leading-relaxed text-coal-200">
          Kein Blob-Speicherdienst nötig. Lade deine <strong>fertig gerenderten Videos</strong> auf dein eigenes Hosting und füge hier die direkten HTTPS-Links ein. Buffer lädt sie dort ab; lokale Vorschau-Links funktionieren nicht. Links müssen bis zur Veröffentlichung öffentlich bleiben.
        </div>
        <BufferChannels config={config} onChange={setConfig} disabled={submitting} />
        <fieldset disabled={submitting} className="grid min-w-0 gap-3">
          <legend className="mono-label mb-2 text-coal-300">01 · VIDEOS & ÖFFENTLICHE LINKS ({active.length}/{rows.length})</legend>
          <details className="border border-coal-700 p-3"><summary className="cursor-pointer font-mono text-xs text-volt-300">Mehrere Links auf einmal einfügen</summary>
            <textarea aria-label="Video-Links, einer pro Zeile" rows={3} value={bulkUrls} onChange={e => setBulkUrls(e.target.value)} placeholder="Ein direkter Video-Link pro Zeile, in der Reihenfolge unten" className={`${inputClass} mt-3`} />
            <button type="button" onClick={() => {
              const urls = bulkUrls.split(/\r?\n/).map(u => u.trim()).filter(Boolean);
              if (urls.length !== rows.length) { setError(`Bitte genau ${rows.length} Links einfügen (einen je Video).`); return; }
              setRows(rows.map((r, i) => ({ ...r, url: urls[i] }))); setError('');
            }} className="mt-2 border border-volt-400 px-3 py-2 font-mono text-xs text-volt-300">Links zuordnen</button>
          </details>
          {rows.map((r, i) => <div key={r.item.index} className="grid gap-3 border border-coal-700 p-3 sm:grid-cols-[72px_1fr]">
            <div>{r.item.blobUrl && <video src={r.item.blobUrl} muted playsInline controls preload="metadata" className="w-full max-w-20 bg-black" style={{ aspectRatio: '9 / 16' }} />}</div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 font-mono text-xs text-paper-100"><input type="checkbox" style={{ display: 'inline-block' }} checked={r.selected} onChange={e => setRows(rows.map((row, j) => j === i ? { ...row, selected: e.target.checked } : row))} />Video {String(r.item.index + 1).padStart(2, '0')}</label>
              <input aria-label={`Titel Video ${i + 1}`} value={r.title} onChange={e => setRows(rows.map((row, j) => j === i ? { ...row, title: e.target.value } : row))} className={inputClass} />
              <input type="url" aria-label={`Öffentliche Video-Adresse ${i + 1}`} value={r.url} onChange={e => setRows(rows.map((row, j) => j === i ? { ...row, url: e.target.value } : row))} placeholder="https://dein-host.de/fertiges-video.mp4" className={inputClass} />
              {r.url && validateVideoUrl(r.url.trim()) && <p className="font-mono text-[10px] text-amber-warn">{validateVideoUrl(r.url.trim())}</p>}
              {r.url && !validateVideoUrl(r.url.trim()) && <a href={r.url.trim()} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[10px] text-volt-300"><ExternalLink className="size-3" /> Link zur Kontrolle öffnen</a>}
            </div>
          </div>)}
          {!rows.length && <p className="text-amber-warn">Zuerst mindestens ein Video fertig rendern.</p>}
          <label className="flex items-start gap-2 font-mono text-xs text-coal-300"><input type="checkbox" style={{ display: 'inline-block' }} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Ich habe geprüft: Diese Links liefern die fertigen Videos direkt, ohne Login, und bleiben bis zur Veröffentlichung erreichbar (am besten im privaten Browserfenster testen).</label>
        </fieldset>
        <fieldset disabled={submitting} className="grid min-w-0 gap-3">
          <legend className="mono-label mb-2 text-coal-300">02 · BESCHREIBUNG FÜR ALLE VIDEOS</legend>
          <textarea aria-label="Video-Beschreibung" rows={10} value={description} onChange={e => setDescription(e.target.value)} className={inputClass} />
          <button type="button" onClick={() => setDescription(DEFAULT_DESCRIPTION)} className="justify-self-start font-mono text-[10px] text-volt-300">Standardbeschreibung wiederherstellen</button>
          <p className="font-mono text-[10px] text-coal-400">Wird exakt so übernommen, inklusive Absätzen und Hashtags. Kein automatischer Story-Text davor. Der Titel wird separat für YouTube genutzt.</p>
        </fieldset>
        <fieldset disabled={submitting} className="grid min-w-0 gap-3">
          <legend className="mono-label mb-2 text-coal-300">03 · VERSAND & ZEITPLAN</legend>
          <div className="grid gap-2 sm:grid-cols-4">{([
            ['queue', 'Buffer-Queue', 'Dein Zeitplan in Buffer'], ['now', 'Jetzt posten', 'Direkt zur Veröffentlichung'], ['auto', 'Auto-Plan', '06:00 & 20:00 · Berlin'], ['custom', 'Frei planen', 'Eigene Zeiten · Berlin'],
          ] as const).map(([id, title, sub]) => <button key={id} type="button" onClick={() => setMode(id)} className={`border p-3 text-left ${mode === id ? 'border-volt-400 bg-volt-400/10' : 'border-coal-700'}`}><span className="block text-sm font-bold text-paper-100">{title}</span><span className="font-mono text-[10px] text-coal-400">{sub}</span></button>)}</div>
          {mode === 'custom' && <div className="grid gap-3 sm:grid-cols-3">
            <label className="font-mono text-xs text-coal-300">Uhrzeiten<input value={times} onChange={e => setTimes(e.target.value)} className={inputClass} /></label>
            <label className="font-mono text-xs text-coal-300">Startdatum<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClass} /></label>
            <label className="font-mono text-xs text-coal-300">Alle N Tage<input type="number" min={1} max={30} value={dayStep} onChange={e => setDayStep(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className={inputClass} /></label>
          </div>}
          <label className="max-w-xs font-mono text-xs text-coal-300">Pause zwischen Buffer-Anfragen (Sekunden)<input type="number" min={2} max={60} value={config.sendInterval} onChange={e => setConfig({ ...config, sendInterval: Math.max(2, Math.min(60, Number(e.target.value) || 3)) })} className={inputClass} /></label>
          <p className="font-mono text-[10px] text-coal-400">Standard: 3 Sekunden nach jeder Antwort. Kein paralleler Versand. Die Pause steuert das Senden an Buffer, nicht die Veröffentlichung aus der Queue. Tab während des Versands offen lassen.</p>
          {!!slots.length && <div className="grid gap-2 sm:grid-cols-2">{slots.map((slot, i) => <p key={slot.berlinKey} className="border border-coal-700 p-2 font-mono text-[10px] text-volt-300">Video {i + 1} · {formatBerlinDateTime(slot.scheduledAt).fullStr}</p>)}</div>}
          {['auto', 'custom'].includes(mode) && <p className="font-mono text-[10px] text-coal-400">Überspringt lokal bekannte belegte Slots. Für einen mit anderen Buffer-Posts abgestimmten Zeitplan bitte Buffer-Queue nutzen.</p>}
        </fieldset>
        {error && <p role="alert" className="flex items-start gap-2 border border-rose-err/40 p-3 font-mono text-xs text-rose-err"><AlertTriangle className="size-4 shrink-0" />{error}</p>}
        {progress && <div aria-live="polite" className="font-mono text-xs text-volt-300"><p>{progress.message}</p><progress max={progress.total} value={progress.completed} className="mt-2 w-full accent-lime-400" /></div>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-coal-700 pt-4">
          {submitting ? <button onClick={() => abortRef.current?.abort()} className="border border-amber-warn px-4 py-3 font-mono text-xs text-amber-warn">Nach aktuellem Post stoppen</button> : <button onClick={onClose} className="border border-coal-600 px-4 py-3 font-mono text-xs text-coal-300">Schließen</button>}
          <button disabled={submitting || !valid} onClick={send} className="bg-heat flex items-center gap-2 px-5 py-3 font-display text-sm font-black text-coal-950 disabled:opacity-40">{submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{submitting ? 'Versand läuft …' : `${active.length} Videos · ${total} Posts ${mode === 'now' ? 'jetzt veröffentlichen' : 'an Buffer senden'}`}</button>
        </div>
      </div>}
    </div>
  </div>;
}
