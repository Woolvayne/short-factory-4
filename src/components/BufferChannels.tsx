import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchBufferChannels, saveBufferConfig, type BufferChannel, type BufferConfigState, type SocialPlatform } from '../lib/scheduler';

export default function BufferChannels({ config, onChange, disabled = false }: {
  config: BufferConfigState; onChange: (value: BufferConfigState) => void; disabled?: boolean;
}) {
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function update(next: BufferConfigState) { onChange(next); saveBufferConfig(next); }
  async function load() {
    setBusy(true); setMessage('');
    try {
      const data = await fetchBufferChannels(); setChannels(data.channels);
      setMessage(data.channels.length ? 'Verbindung bestätigt. Wähle die gewünschten Kanäle.' : 'Keine verbundenen Kanäle gefunden. Bitte zuerst in Buffer verbinden.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="mono-label text-coal-300">BUFFER-KANÄLE</span>
      <button type="button" onClick={load} disabled={disabled || busy} className="flex min-h-[40px] items-center gap-2 border border-coal-600 px-3 py-2 font-mono text-xs text-volt-300 disabled:opacity-50">
        <RefreshCw className={`size-3 ${busy ? 'animate-spin' : ''}`} /> Kanäle laden / Verbindung prüfen
      </button>
    </div>
    {message && <p role="status" className="font-mono text-xs text-amber-warn">{message}</p>}
    <div className="grid gap-2 sm:grid-cols-3">
      {(['tiktok', 'instagram', 'youtube'] as SocialPlatform[]).map(platform => {
        const selected = config.defaultPlatforms.includes(platform);
        const key = `${platform}ChannelId` as const;
        const options = channels.filter(c => c.service === platform);
        return <div key={platform} className={`border p-3 ${selected ? 'border-volt-400/60 bg-volt-400/5' : 'border-coal-700'}`}>
          <label className="flex items-center gap-2 font-mono text-xs uppercase text-paper-100">
            <input type="checkbox" className="size-4 shrink-0 accent-orange-500" style={{ display: 'inline-block' }} disabled={disabled} checked={selected} onChange={() => update({ ...config, defaultPlatforms: selected ? config.defaultPlatforms.filter(p => p !== platform) : [...config.defaultPlatforms, platform] })} />{platform}
          </label>
          {options.length ? <select aria-label={`${platform} Buffer-Kanal`} disabled={disabled} value={config[key]} onChange={e => update({ ...config, [key]: e.target.value })} className="mt-2 w-full border border-coal-600 bg-coal-850 p-2 text-xs text-paper-100">
            <option value="">Kanal auswählen …</option>
            {options.map(c => <option key={c.id} value={c.id}>{c.displayName || c.name} · {c.organizationName}{c.isQueuePaused ? ' (Queue pausiert!)' : ''}</option>)}
          </select> : <input aria-label={`${platform} Buffer-Kanal-ID`} disabled={disabled} placeholder="Buffer-Kanal-ID" value={config[key]} onChange={e => update({ ...config, [key]: e.target.value })} className="mt-2 w-full border border-coal-600 bg-coal-850 p-2 font-mono text-xs text-paper-100" />}
        </div>;
      })}
    </div>
    <p className="font-mono text-[10px] text-coal-400">Jedes ausgewählte Video geht an jeden aktivierten Kanal — keine Rotation. API-Key nur als BUFFER_API_KEY auf dem Server.</p>
  </div>;
}
