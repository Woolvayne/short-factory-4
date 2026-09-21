import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, HardDriveUpload, Loader2, Send, X } from 'lucide-react';
import type { LocalRenderItem } from '../lib/types';
import { DEFAULT_DESCRIPTION, formatBerlinDateTime, loadBufferConfig, planSlots, saveBufferConfig, scheduleBatchPosts, validateVideoUrl, type DispatchProgress, type ScheduledPost, type ScheduleMode } from '../lib/scheduler';
import { fetchUploadStatus, loadUploadProvider, providerLabel, saveUploadProvider, uploadRenderFile, type UploadHostStatus, type UploadProvider } from '../lib/uploader';
import { videoFileName } from './MissionControl';
import BufferChannels from './BufferChannels';

const inputClass = 'w-full border border-coal-600 bg-coal-850 px-3 py-2 font-mono text-xs text-paper-100 focus:border-volt-400 focus:outline-none disabled:opacity-50';
/** Upload-consent is remembered: the second batch onward is a single button press. */
const UPLOAD_CONSENT_KEY = 'shortsfactory.buffer_upload_consent.v1';
const readUploadConsent = () => { try { return localStorage.getItem(UPLOAD_CONSENT_KEY) === '1'; } catch { return false; } };

type UploadState = { status: 'pending' | 'uploading' | 'done' | 'error'; loaded: number; total: number; error?: string };

export default function PostScheduleModal({ targetItems, existingPosts, autoStart = false, onClose, onScheduled, onOpenCalendar, onUploadedImage }: {
  targetItems: LocalRenderItem[]; existingPosts: ScheduledPost[]; autoStart?: boolean; onClose: () => void;
  onScheduled: (posts: ScheduledPost[]) => void; onOpenCalendar: () => void;
  onUploadedImage?: (index: number, publicUrl: string) => void;
}) {
  const [config, setConfig] = useState(loadBufferConfig);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [mode, setMode] = useState<ScheduleMode>('queue');
  const [times, setTimes] = useState('06:00, 20:00');
  const [startDate, setStartDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [dayStep, setDayStep] = useState(1);
  const [rows, setRows] = useState(() => targetItems.filter(i => i.status === 'done').map(item => ({ item, selected: true, url: item.publicUrl ?? '', title: item.idea })));
  const [host, setHost] = useState<UploadHostStatus | null>(null);
  const [provider, setProvider] = useState<UploadProvider>(loadUploadProvider);
  const [providerMsg, setProviderMsg] = useState('');
  const [uploads, setUploads] = useState<Record<number, UploadState>>({});
  const [uploadDone, setUploadDone] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [repeatAck, setRepeatAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [result, setResult] = useState<ScheduledPost[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const active = rows.filter(r => r.selected);
  const plan = { mode, count: active.length, times: times.split(/[,\s]+/).filter(Boolean), startDate, dayStep };
  const slots = planSlots(existingPosts, plan);
  const total = active.length * config.defaultPlatforms.length;
  const selectedProvider = host?.providers?.[provider];
  const connected = Boolean(selectedProvider?.configured);
  const repeatWarnings = useMemo(() => connected
    ? active.filter(r => existingPosts.some(p => p.title === r.title && p.status !== 'Fehler')).map(r => `Video ${String(r.item.index + 1).padStart(2, '0')}`)
    : [], [connected, active, existingPosts]);
  const consentGiven = connected ? acknowledged || readUploadConsent() : acknowledged;
  const valid = connected && active.length > 0 && total > 0
    && config.defaultPlatforms.every(p => config[`${p}ChannelId`].trim())
    && consentGiven && (repeatWarnings.length === 0 || repeatAck);

  useEffect(() => {
    const controller = new AbortController();
    fetchUploadStatus(controller.signal).then(status => {
      setHost(status);
      const saved = loadUploadProvider();
      if (status.providers[saved]?.configured) setProvider(saved);
      else if (status.providers[status.provider]?.configured) setProvider(status.provider);
      else setProvider('puter');
    }).catch(() => setHost(null));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    function unload(e: BeforeUnloadEvent) { e.preventDefault(); }
    window.addEventListener('keydown', key);
    if (submitting) window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [submitting, onClose]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function ack(checked: boolean) {
    setAcknowledged(checked);
    if (connected) {
      // remember or revoke the upload consent (second batch onward = one press)
      try { checked ? localStorage.setItem(UPLOAD_CONSENT_KEY, '1') : localStorage.removeItem(UPLOAD_CONSENT_KEY); } catch { /* private mode */ }
    }
  }

  function uploadStateOf(index: number): UploadState {
    return uploads[index] ?? { status: 'pending', loaded: 0, total: 0 };
  }

  function selectProvider(next: UploadProvider) {
    setProvider(next);
    saveUploadProvider(next);
    setProviderMsg('');
  }

  async function send() {
    if (submitting || !valid) return;
    setError('');
    if (mode === 'custom' && (!plan.times.length || plan.times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || !startDate)) {
      setError('Bitte gültige Uhrzeiten (HH:mm) und ein Startdatum eingeben.'); return;
    }
    setSubmitting(true); abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const uploadedUrls: Record<number, string> = {};
    try {
      saveBufferConfig(config);
      // Phase 1 — upload every selected video directly to the selected host.
      const queue = active.filter(r => !r.url.trim());
      setUploadTotal(queue.length); setUploadDone(0);
      for (let i = 0; i < queue.length; i++) {
        if (signal.aborted) throw new Error('Abgebrochen. Es wurde noch nichts an Buffer gesendet.');
        const row = queue[i];
        const size = row.item.blob?.size ?? 0;
        setUploads(s => ({ ...s, [row.item.index]: { status: 'uploading', loaded: 0, total: size } }));
        try {
          const publicUrl = await uploadRenderFile(row.item.blob!, {
            provider,
            filename: videoFileName(row.item),
            contentType: row.item.mime || 'video/mp4',
            signal,
            onProgress: p => setUploads(s => ({ ...s, [row.item.index]: { status: 'uploading', loaded: p.loaded, total: p.total || size } })),
          });
          uploadedUrls[row.item.index] = publicUrl;
          setRows(prev => prev.map(r => r.item.index === row.item.index ? { ...r, url: publicUrl } : r));
          setUploads(s => ({ ...s, [row.item.index]: { status: 'done', loaded: size, total: size } }));
          onUploadedImage?.(row.item.index, publicUrl);
          setUploadDone(i + 1);
        } catch (e) {
          const aborted = signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
          setUploads(s => ({ ...s, [row.item.index]: { status: aborted ? 'pending' : 'error', loaded: 0, total: size, error: e instanceof Error ? e.message : String(e) } }));
          throw new Error(aborted
            ? 'Upload abgebrochen. Es wurde noch nichts an Buffer gesendet.'
            : `Upload von Video ${String(row.item.index + 1).padStart(2, '0')} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)} Es wurde noch nichts an Buffer gesendet.`);
        }
      }
      if (signal.aborted) throw new Error('Abgebrochen. Es wurde noch nichts an Buffer gesendet.');
      // Phase 2 — hand every video to Buffer, sequentially with the short send interval.
      const response = await scheduleBatchPosts({
        items: active.map(r => ({ videoUrl: (uploadedUrls[r.item.index] ?? r.url).trim(), title: r.title, description })), config, plan,
        onProgress: setProgress, onPostsChange: onScheduled, signal,
      });
      setResult(response.createdPosts); onScheduled(response.allPosts);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); setProgress(null); }
  }

  const uploadingNow = Object.values(uploads).some(u => u.status === 'uploading');
  const currentUpload = active.find(r => uploadStateOf(r.item.index).status === 'uploading');
  const uploadPercent = uploadTotal > 0
    ? Math.min(100, ((uploadDone + (currentUpload ? uploadStateOf(currentUpload.item.index).loaded / Math.max(1, uploadStateOf(currentUpload.item.index).total) : 0)) / uploadTotal) * 100)
    : 0;

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-coal-950/95 p-4" role="dialog" aria-modal="true" aria-labelledby="buffer-title">
    <div className="card-bracket mx-auto my-6 max-w-4xl border border-coal-600 bg-coal-900 p-5 sm:p-7">
      <div className="flex items-start justify-between gap-3 border-b border-coal-700 pb-4">
        <div><span className="bg-heat px-2 py-1 font-mono text-[10px] font-bold text-coal-950">BUFFER DISPATCH</span>
          <h2 id="buffer-title" className="mt-3 font-display text-2xl font-black uppercase text-paper-100">Fertig gerendert. Bereit für Buffer.</h2>
          <p className="mt-1 font-mono text-xs text-coal-300">Alle Videos am Ende senden — nacheinander hochgeladen, mit kurzer Pause zwischen den Posts.</p></div>
        <button aria-label="Schließen" disabled={submitting} onClick={onClose} className="border border-coal-600 p-2 text-coal-300 disabled:opacity-40"><X className="size-4" /></button>
      </div>
      {result ? <div className="grid gap-4 py-6">
        <Check className="size-8 text-volt-300" />
        <h3 className="font-display text-xl font-bold text-paper-100">{result.filter(p => p.bufferPostId).length} von {total} Posts von Buffer angenommen</h3>
        <p className="font-mono text-xs text-coal-300">Angenommen heißt nicht veröffentlicht. Den aktuellen Status kannst du im Kalender aktualisieren oder direkt in Buffer prüfen.</p>
        {result.some(p => p.status === 'Fehler' || p.status === 'Unklar') && <p className="font-mono text-xs text-amber-warn">Es gab Fehler oder unklare Antworten. Bestätigte Posts nicht erneut senden; Details und sichere Wiederholung stehen im Kalender.</p>}
        {result.length < total && <p className="font-mono text-xs text-amber-warn">Der Versand wurde vorzeitig gestoppt. Nicht gesendete Video/Kanal-Kombinationen kannst du in einem neuen Versand auswählen.</p>}
        {result.map(p => <div key={p.id} className="border border-coal-700 p-3 font-mono text-xs text-coal-200">{p.title} · {p.platform} · {p.status}{p.errorMessage && <p className="mt-1 text-amber-warn">{p.errorMessage}</p>}{p.videoUrl && <p className="mt-1 truncate text-coal-500">{p.videoUrl}</p>}</div>)}
        <button onClick={() => { onClose(); onOpenCalendar(); }} className="bg-heat px-5 py-3 font-bold text-coal-950">Zum Kalender</button>
      </div> : <div className="mt-5 grid gap-6">
        <div className="grid gap-4 border border-volt-400/40 bg-volt-400/5 p-4">
          <div className="flex items-start gap-2 font-mono text-xs leading-relaxed text-coal-200">
            <HardDriveUpload className="mt-0.5 size-4 shrink-0 text-volt-300" />
            <span>Buffer nimmt keine Datei-Bytes an: Der ausgewählte Provider erzeugt eine dauerhafte öffentliche HTTPS-Adresse. Das Video wird direkt dorthin übertragen, erst danach bekommt Buffer den Link. <strong>Kein Vercel Blob.</strong></span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['r2', 'b2', 'puter'] as UploadProvider[]).map(option => {
              const info = host?.providers?.[option];
              const available = Boolean(info?.configured);
              return <button key={option} type="button" disabled={submitting || !available} onClick={() => selectProvider(option)} className={`grid gap-1 border p-3 text-left ${provider === option ? 'border-volt-400 bg-volt-400/10' : 'border-coal-700'} ${!available ? 'cursor-not-allowed opacity-45' : ''}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-bold text-paper-100"><span>{info?.label || providerLabel(option)}</span><span className="font-mono text-[9px] uppercase text-coal-400">{available ? 'bereit' : 'nicht konfiguriert'}</span></span>
                <span className="font-mono text-[10px] leading-relaxed text-coal-400">{info?.description || 'Status wird geladen …'}</span>
              </button>;
            })}
          </div>
          {selectedProvider && <p className="font-mono text-[10px] leading-relaxed text-coal-300"><strong>{selectedProvider.label}:</strong> {selectedProvider.mode === 'browser' ? 'Beim ersten Upload öffnet Puter die Anmeldung. Die Datei bleibt in deinem Puter-Konto.' : 'Server-Umgebungsvariablen signieren nur die kurzlebige PUT-Adresse; Geheimnisse verlassen den Server nicht.'} <a href={selectedProvider.setupUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-volt-300 underline"><ExternalLink className="size-3" />Einrichtung</a></p>}
          {!host && <p className="font-mono text-[10px] text-coal-400">Lade Providerstatus …</p>}
          {host && !connected && <p className="font-mono text-xs text-amber-warn">{selectedProvider?.label || providerLabel(provider)} ist noch nicht eingerichtet. Folge der Anleitung im README oder wähle einen bereiten Provider.</p>}
          {providerMsg && <p role="status" className="font-mono text-[10px] text-amber-warn">{providerMsg}</p>}
        </div>
        <BufferChannels config={config} onChange={setConfig} disabled={submitting} />
        {autoStart && valid && !submitting && <div className="grid gap-2 border border-volt-400/60 bg-volt-400/10 p-4">
          <p className="font-display text-sm font-black uppercase text-paper-100">Alles bereit: {active.length} Videos · {total} Posts · Modus „{mode === 'queue' ? 'Buffer-Queue' : mode === 'now' ? 'Jetzt posten' : mode === 'auto' ? 'Auto-Plan' : 'Frei planen'}“</p>
          <p className="font-mono text-[10px] text-coal-300">Ein Klick: erst werden alle Videos hochgeladen, dann geht jeder Post mit kurzer Pause an Buffer. Tab dabei offen lassen.</p>
          <button onClick={send} className="glow-volt bg-heat mt-1 flex items-center justify-center gap-2 px-5 py-4 font-display text-base font-black uppercase text-coal-950 transition-opacity hover:opacity-90">
            <Send className="size-5" /> Alle {active.length} hochladen & {total} Posts senden
          </button>
        </div>}
        <fieldset disabled={submitting} className="grid min-w-0 gap-3">
          <legend className="mono-label mb-2 text-coal-300">{`01 · VIDEOS — WERDEN AUTOMATISCH HOCHGELADEN (${active.length}/${rows.length})`}</legend>
          {rows.map((r, i) => {
            const up = uploadStateOf(r.item.index);
            return <div key={r.item.index} className="grid gap-3 border border-coal-700 p-3 sm:grid-cols-[72px_1fr]">
              <div>{r.item.blobUrl && <video src={r.item.blobUrl} muted playsInline controls preload="metadata" className="w-full max-w-20 bg-black" style={{ aspectRatio: '9 / 16' }} />}</div>
              <div className="grid gap-2">
                <label className="flex items-center gap-2 font-mono text-xs text-paper-100"><input type="checkbox" style={{ display: 'inline-block' }} checked={r.selected} onChange={e => setRows(rows.map((row, j) => j === i ? { ...row, selected: e.target.checked } : row))} />Video {String(r.item.index + 1).padStart(2, '0')}</label>
                <input aria-label={`Titel Video ${i + 1}`} value={r.title} onChange={e => setRows(rows.map((row, j) => j === i ? { ...row, title: e.target.value } : row))} className={inputClass} />
                <div className="grid gap-1">
                  {up.status === 'done' && r.url ? <>
                    <p className="flex items-center gap-1 font-mono text-[10px] text-volt-300"><Check className="size-3 shrink-0" /> Hochgeladen</p>
                    <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate font-mono text-[10px] text-coal-400"><ExternalLink className="size-3 shrink-0" /> {r.url}</a>
                    {!submitting && <button type="button" onClick={() => { setRows(rows.map((row, j) => j === i ? { ...row, url: '' } : row)); setUploads(s => ({ ...s, [r.item.index]: { status: 'pending', loaded: 0, total: 0 } })); onUploadedImage?.(r.item.index, ''); }} className="justify-self-start font-mono text-[10px] text-volt-300 underline">Erneut hochladen (neuer Link)</button>}
                  </> : up.status === 'uploading' ? <div className="grid gap-1">
                    <p className="font-mono text-[10px] text-ember-400">Wird hochgeladen … {up.total ? `${Math.min(100, Math.round((up.loaded / up.total) * 100))} %` : ''}</p>
                    <progress max={up.total || 1} value={up.loaded} className="w-full accent-lime-400" />
                  </div> : up.status === 'error' ? <p className="font-mono text-[10px] text-rose-err">{up.error}</p> : r.url ? <>
                    <p className="flex items-center gap-1 font-mono text-[10px] text-volt-300"><Check className="size-3 shrink-0" /> Bereits hochgeladen — wird wiederverwendet</p>
                    <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate font-mono text-[10px] text-coal-400"><ExternalLink className="size-3 shrink-0" /> {r.url}</a>
                  </> : !connected ? <p className="font-mono text-[10px] text-amber-warn">Erst einen Upload-Provider oben einrichten oder auswählen — danach wird dieses Video automatisch hochgeladen.</p> : <p className="font-mono text-[10px] text-coal-400">Wird beim Start zu {selectedProvider?.label || providerLabel(provider)} hochgeladen ({r.item.size ? `${Math.round(r.item.size / 1048576)} MB` : 'Video'}).</p>}
                  {r.url && !submitting && validateVideoUrl(r.url.trim()) && <p className="font-mono text-[10px] text-amber-warn">{validateVideoUrl(r.url.trim())}</p>}
                </div>
              </div>
            </div>;
          })}
          {!rows.length && <p className="text-amber-warn">Zuerst mindestens ein Video fertig rendern.</p>}
          <label className="flex items-start gap-2 font-mono text-xs text-coal-300"><input type="checkbox" style={{ display: 'inline-block' }} checked={consentGiven} onChange={e => ack(e.target.checked)} />Ich habe verstanden: Die Videos werden zu meinem ausgewählten Upload-Provider hochgeladen und als echte Posts an Buffer übergeben — je nach Modus sofort veröffentlicht.</label>
          {repeatWarnings.length > 0 && <div className="grid gap-2 border border-amber-warn/40 bg-amber-warn/5 p-3">
            <p className="font-mono text-xs text-amber-warn"><AlertTriangle className="mr-1 inline size-3.5" />Laut Journal wurden bereits Posts mit diesen Titeln versendet: {repeatWarnings.join(', ')}. Ein erneuter Versand erzeugt echte Doppelposts.</p>
            <label className="flex items-start gap-2 font-mono text-xs text-coal-300"><input type="checkbox" style={{ display: 'inline-block' }} checked={repeatAck} onChange={e => setRepeatAck(e.target.checked)} />Ich möchte diese Videos bewusst ein zweites Mal senden.</label>
          </div>}
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
          <label className="max-w-xs font-mono text-xs text-coal-300">Pause zwischen den Videos (Sekunden)<input type="number" min={2} max={60} value={config.sendInterval} onChange={e => setConfig({ ...config, sendInterval: Math.max(2, Math.min(60, Number(e.target.value) || 3)) })} className={inputClass} /></label>
          <p className="font-mono text-[10px] text-coal-400">Standard: 3 Sekunden nach jeder Buffer-Antwort — so werden sicher alle Videos nacheinander geschickt. Kein paralleler Versand. Die Pause steuert das Senden an Buffer, nicht die Veröffentlichung aus der Queue. Tab während des Versands offen lassen.</p>
          {!!slots.length && <div className="grid gap-2 sm:grid-cols-2">{slots.map((slot, i) => <p key={slot.berlinKey} className="border border-coal-700 p-2 font-mono text-[10px] text-volt-300">Video {i + 1} · {formatBerlinDateTime(slot.scheduledAt).fullStr}</p>)}</div>}
          {['auto', 'custom'].includes(mode) && <p className="font-mono text-[10px] text-coal-400">Überspringt lokal bekannte belegte Slots. Für einen mit anderen Buffer-Posts abgestimmten Zeitplan bitte Buffer-Queue nutzen.</p>}
        </fieldset>
        {error && <p role="alert" className="flex items-start gap-2 border border-rose-err/40 p-3 font-mono text-xs text-rose-err"><AlertTriangle className="size-4 shrink-0" />{error}</p>}
        {(uploadingNow || progress) && <div aria-live="polite" className="grid gap-2 font-mono text-xs text-volt-300">
          {uploadingNow && <>
            <p>HOCHLADEN {Math.min(uploadDone + (currentUpload ? 1 : 0), uploadTotal)}/{uploadTotal} — {currentUpload ? `Video ${String(currentUpload.item.index + 1).padStart(2, '0')}` : ''}</p>
            <progress max={100} value={uploadPercent} className="w-full accent-lime-400" />
            <p className="text-coal-400">Videos werden direkt zum ausgewählten Provider übertragen. Danach startet der Buffer-Versand automatisch.</p>
          </>}
          {progress && <>
            <p>{progress.message}</p>
            <progress max={progress.total} value={progress.completed} className="w-full accent-lime-400" />
          </>}
        </div>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-coal-700 pt-4">
          {submitting ? <button onClick={() => abortRef.current?.abort()} className="border border-amber-warn px-4 py-3 font-mono text-xs text-amber-warn">Nach aktuellem Video stoppen</button> : <button onClick={onClose} className="border border-coal-600 px-4 py-3 font-mono text-xs text-coal-300">Schließen</button>}
          <button disabled={submitting || !valid} onClick={send} className="bg-heat flex items-center gap-2 px-5 py-3 font-display text-sm font-black text-coal-950 disabled:opacity-40">{submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{submitting ? (uploadingNow ? 'Videos werden hochgeladen …' : 'Versand läuft …') : `${active.length} Videos · ${total} Posts ${mode === 'now' ? 'jetzt veröffentlichen' : 'an Buffer senden'}`}</button>
        </div>
      </div>}
    </div>
  </div>;
}
