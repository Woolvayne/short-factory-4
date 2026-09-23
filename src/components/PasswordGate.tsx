import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { fetchAuthStatus, verifyPassword } from '../lib/auth';

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'open' | 'locked' | 'error'>('checking');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuthStatus(controller.signal)
      .then(({ configured }) => setState(configured ? 'locked' : 'open'))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setMessage(error instanceof Error ? error.message : 'Server nicht erreichbar.');
        setState('error');
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !password.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await verifyPassword(password);
      setPassword('');
      setState('open');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Passwort ist falsch.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'open') return <>{children}</>;

  return <main className="grain relative grid min-h-dvh place-items-center overflow-hidden bg-coal-950 px-4 py-8 text-paper-100">
    <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-70" />
    <section className="card-bracket relative z-10 grid w-full max-w-md gap-6 border border-coal-700 p-6 sm:p-8" aria-labelledby="password-title">
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-heat text-coal-950"><LockKeyhole className="size-5" /></span>
          <div>
            <p className="mono-label text-[10px] text-volt-400">SHORTSFACTORY · PRIVATE LINE</p>
            <h1 id="password-title" className="mt-1 font-display text-2xl font-black uppercase">Zugang erforderlich</h1>
          </div>
        </div>
        <p className="font-mono text-xs leading-relaxed text-coal-300">Diese Produktions- und Buffer-Oberfläche ist geschützt. Das Passwort wird nach dem Laden nicht gespeichert — bei jedem Reload erneut eingeben.</p>
      </div>

      {state === 'checking' && <div className="flex items-center gap-2 font-mono text-xs text-volt-300"><Loader2 className="size-4 animate-spin" /> Prüfe Passwortschutz …</div>}
      {state === 'error' && <div className="grid gap-3" role="alert">
        <p className="font-mono text-xs text-rose-err">{message}</p>
        <button type="button" onClick={() => window.location.reload()} className="bg-heat px-4 py-3 font-mono text-xs font-bold uppercase text-coal-950">Erneut versuchen</button>
      </div>}
      {state === 'locked' && <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-2 font-mono text-xs text-coal-300" htmlFor="sf-password">
          Passwort
          <input id="sf-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} className="w-full border border-coal-600 bg-coal-850 px-3 py-3 font-mono text-sm text-paper-100 focus:border-volt-400 focus:outline-none" />
        </label>
        {message && <p role="alert" className="font-mono text-xs text-rose-err">{message}</p>}
        <button type="submit" disabled={busy || !password.trim()} className="bg-heat flex items-center justify-center gap-2 px-4 py-3 font-display text-sm font-black uppercase text-coal-950 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Log In
        </button>
        <p className="font-mono text-[10px] text-coal-500">SHORTSFACTORY_PASSWORD ist serverseitig gesetzt. Passwortschutz nie mit <code>VITE_</code> veröffentlichen.</p>
      </form>}
    </section>
  </main>;
}
