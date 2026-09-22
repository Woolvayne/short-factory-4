# ShortsFactory — Clip Mill Edition

**One clip in. Ten shorts out.** A video assembly line that **renders entirely in your
browser**: no cloud render farm, no ffmpeg. Narration and optional Buffer
dispatch use small same-origin server routes. Feed it one long
background video, get ten different moments — each with its own AI story,
neural voice and word-synced captions — then press **Render**.

Optimised for desktop **and** iPhone / iPad (iOS 17+ recommended).

## The three-button flow

1. **① Prepare 10 scripts + voices** — fast step, writes every story and
   synthesises every voice track. No video is rendered yet.
2. **② Render** — the explicit render button. Renders every staged unit, or use
   the **RENDER** button on each individual card in the Output Bay.
   Done units get **RE-RENDER**, failed ones get **RETRY**. A **STOP** button
   in the status bar aborts a running batch.
3. **Bundle → ZIP** — packs all finished blobs locally and fires a real
   `<a href="blob:" download>` link (Safari-safe).
4. **Alle posten — ein Klick** — the big **ALLE N VIDEOS AUF EINMAL POSTEN**
   button in the Output Bay opens the dispatch window with everything
   preselected. One confirmation press: every finished video is uploaded to
   your selected R2, B2 or Puter host and then handed to Buffer
   **one after another with a short pause**, so all ten reliably go through.

## Clip Mill — one source → ten clips

Step 02 has two modes:

| Mode | What it does |
| --- | --- |
| **1 SOURCE → 10** | Pick *one* long video (or paste a direct link). It's sliced into 10 different clip windows — one per story. Every window shows its timecode and can be re-rolled individually; **RE-SLICE** redeals all ten. |
| **10 FILES** | The classic path: pick ten separate 9:16 clips, one per story. |

Slicing is controlled under **Settings → CLIPS**: distribution
(*evenly spread / random / sequential*), clip length (*match voice / fixed*),
plus **skip intro** and **skip outro** so title cards and end screens never
make it into a short. When clip length is set to *match voice*, the ten
windows are re-cut after preparation using the real voice durations.

### About YouTube links

Paste a YouTube (or TikTok / Instagram / X / Vimeo) link and the app tells you
honestly what's going on instead of pretending: **browsers cannot download
those streams** — they're signed and send no CORS headers, and working around
that would breach the platform's terms and, for material you don't own,
copyright. The panel shows the legal one-step alternative:

* Your own video → download the original in **YouTube Studio → Content → ⋮ → Download**, then pick that file.
* Licensed / Creative-Commons footage → get the file from the rights holder or stock site.
* Or paste a **direct video URL** (`…/clip.mp4`) that allows cross-origin requests — your own hosting, Pexels, Coverr, Mixkit. Those are streamed into a local blob with a progress bar and sliced exactly the same way.

## Settings (6 tabs)

| Tab | Controls |
| --- | --- |
| **AI** | Qwen + Mistral keys (localStorage only), story genre (AITA · petty revenge · confession · unsettling · wholesome · workplace · custom instruction), story length ~110–280 words, creativity/temperature |
| **VOICE** | 12 Edge neural voices, speaking rate ±40 %, pitch ±20 Hz, voice volume, music-bed volume, music fade-out, tail padding |
| **CAPTIONS** | On/off, 4 style presets, 1–5 words per cue, colour swatches + custom picker, text size, vertical position, outline weight, uppercase, drop shadow — with a **live preview** |
| **VIDEO** | Resolution (auto / 540 / 720 / 1080), frame rate 24·30·60, bitrate, vignette, slow Ken-Burns zoom |
| **INTRO** | Animated Reddit-inspired title card, on/off, duration 1–12 seconds (default 3.5), live canvas preview |
| **CLIPS** | Distribution mode, clip length mode + fixed length, skip intro, skip outro |

No API keys? The built-in **offline story writer** takes over — full-length
first-person stories with zero network.

## Social Dispatch — Buffer statt Zernio

Produktion oben, Versand und lokaler Kalender darunter. Die alte Zernio-Route
wurde entfernt. Bestehende Zernio-Posts werden **weder übernommen noch gelöscht**;
insbesondere werden alte simulierte IDs nicht als echte Buffer-Posts behandelt.

### Einmal einrichten

1. In [Buffer → Settings → API](https://publish.buffer.com/settings/api) einen
   persönlichen API-Key erstellen und die gewünschten Social-Kanäle verbinden.
2. `BUFFER_API_KEY` ausschließlich als **Server-Umgebungsvariable** setzen:
   lokal in `.env.local`, auf Vercel in den Projekteinstellungen. Danach Server
   neu starten bzw. neu deployen. **Kein `VITE_`-Präfix!**
3. Im Versandfenster oder unter **BUFFER KANÄLE** auf **Kanäle laden /
   Verbindung prüfen** klicken und TikTok, Instagram und/oder YouTube auswählen.
   Alternativ echte **Buffer-Kanal-IDs** eintragen, nicht native Plattform-IDs.
4. `SHORTSFACTORY_PASSWORD` als **Server-Umgebungsvariable** setzen (siehe
   Passwortschutz unten). Das eingebaute Gate schützt die Oberfläche und die
   API-Routen; für eine zusätzliche Unternehmensschicht kann optional Vercel
   Deployment Protection oder ein authentifizierter Reverse Proxy davorliegen.

Ohne Key wird der Versand ausdrücklich abgelehnt. Kein Simulationsmodus,
keine erfundenen Post-IDs und keine falschen Erfolgsmeldungen.

### Upload-Host — drei Wege ohne Vercel Blob

Buffer akzeptiert **keine direkten Datei-Uploads per API**. Es gibt keinen
`Buffer`-Endpoint, an den die App einen Node- oder Browser-`Buffer` senden kann.
Stattdessen muss Buffer eine **direkte, öffentliche, dauerhafte HTTPS-Datei-URL**
bekommen. Die App lädt deshalb jedes fertige Video vor dem Versand direkt zu
einem von drei auswählbaren Hosts hoch und übergibt erst danach die URL an
Buffer. Das vermeidet den Vercel-Blob-Engpass; Vercel bekommt dabei keine
Videobytes.

Die drei Adapter sind im Versandfenster auswählbar:

| Provider | Einschätzung für mindestens 100 GB/Monat | Einrichtung |
| --- | --- | --- |
| **Cloudflare R2** (Empfehlung) | Bucket-Speicher ist laut Limits unbegrenzt, Egress ins Internet kostenlos. Es gibt keinen 100-GB-Transferdeckel; Storage und Requests werden verbrauchsabhängig berechnet. | Server-Env + öffentlicher Custom-Domain-Bucket |
| **Backblaze B2** | S3-kompatibel, `3×` des durchschnittlich gespeicherten Volumens Egress pro Monat kostenlos, darüber `0,01 USD/GB` (oder CDN-Partner nutzen). Bei z. B. 100 GB gespeichert sind 300 GB/Monat abgedeckt. | Server-Env + öffentlicher Bucket/CDN |
| **Puter.js** (dein „Putter“) | Browser-Upload ohne Server-Key; Puter bewirbt kostenlosen/unbegrenzten Object Storage und ein User-Pays-Modell. Die Nutzungsseite nennt aber monatliche Freikontingente/Upgrades und keine harte 100-GB-SLA. Daher bequem, aber nicht meine belastbare Produktionsgarantie für 100 GB. | Kein Env-Key; beim ersten Upload Puter anmelden |

**Meine Empfehlung:** R2 als Standard für regelmäßige Produktion, B2 als
preiswerte Ausweich- oder Archivoption, Puter für einen einzelnen Operator,
der keine S3-Credentials verwalten möchte. R2 ist die einzige der drei
Varianten mit klar unbegrenztem Bucket-Limit und ohne Egress-Preis. Kein
Provider kann Buffer-Posts retten, wenn die Datei später gelöscht wird: Die
öffentliche URL muss bis zur Veröffentlichung bestehen bleiben.

Weitere Details, Variablen und CORS-Beispiele stehen in
[`docs/storage-providers.md`](docs/storage-providers.md). Kurz gesagt:

1. R2 oder B2 als **public-read Bucket bzw. öffentliche Custom Domain**
   einrichten; für Browser-PUT zusätzlich CORS für die App-Origin erlauben.
2. Die Provider-Variablen aus `.env.example` in `.env.local` bzw. in Vercel
   eintragen. Geheimnisse nie mit `VITE_` prefixen.
3. Neu starten bzw. redeployen, Versandfenster öffnen und den Provider-Card
   auswählen. Puter lädt bei der ersten Verwendung `https://js.puter.com/v2/`
   und startet den Login.
4. Die erzeugte URL in einem privaten Browserfenster öffnen. Sie muss das
   MP4/WebM direkt ohne Login, Preview-Seite oder ablaufende Signatur liefern.

R2/B2 nutzen eine **15 Minuten gültige Presigned-PUT-URL nur für den Upload**;
diese URL wird niemals an Buffer gesendet. Buffer erhält anschließend die
stabile `R2_PUBLIC_BASE_URL` bzw. `B2_PUBLIC_BASE_URL`. Puter liefert seine
öffentliche `getReadURL`-Adresse direkt aus dem Browser.

### Passwortschutz

Setze serverseitig `SHORTSFACTORY_PASSWORD` in `.env.local` oder in den Vercel
Project Settings und redeploye. **Kein `VITE_`-Präfix.** Dann zeigt die App vor
jeder Produktion eine Passwortseite; nach einem vollständigen Reload ist die
Eingabe erneut erforderlich. Das Passwort landet weder in `localStorage`,
`sessionStorage`, Cookies, URLs noch im Bundle. Die API-Routen für TTS, Upload
und Buffer prüfen zusätzlich den same-origin Header serverseitig.

Wenn `SHORTSFACTORY_PASSWORD` leer ist, bleibt die lokale Entwicklung offen.
Für eine öffentliche Bereitstellung sollte es gesetzt sein; `BUFFER_API_KEY`
und die S3-Schlüssel bleiben trotzdem ausschließlich Server-Variablen.

### Der Ein-Klick-Versand (alle 10 auf einmal)

**ALLE N VIDEOS AUF EINMAL POSTEN** in der Output Bay öffnet das Versandfenster
vorausgewählt: alle fertigen Videos markiert, Kanäle, Beschreibung und Modus
aus der letzten Einrichtung übernommen. Ein Startdruck führt dann aus:

1. **Upload-Phase** — jedes ausgewählte Video wird nacheinander zum ausgewählten
   R2-, B2- oder Puter-Host übertragen (Fortschrittsbalken je Video). Schlägt ein Upload
   fehl oder wird abgebrochen, wurde **noch nichts an Buffer gesendet**.
2. **Versand-Phase** — die Posts gehen wie gewohnt **sequenziell mit kurzer
   Pause** (Standard 3 Sekunden nach jeder Buffer-Antwort, einstellbar
   2–60 Sekunden) an Buffer, damit zuverlässig alle Videos durchgehen. Kein
   paralleler Versand; Tab offen lassen; Stop beendet nach dem aktuellen Post.

Bereits hochgeladene Videos werden wiederverwendet (kein Doppel-Upload);
pro Video gibt es „Erneut hochladen“, um bewusst einen neuen Link zu erzeugen.
Sendet das Journal bereits nicht fehlgeschlagene Posts mit denselben Titeln,
verlangt das Fenster eine zusätzliche Bestätigung gegen versehentliche
Doppelposts. Ohne eingerichteten Provider zeigt das Fenster die fehlende Einrichtung an —
ein manuelles Eintragen von Links ist nicht nötig.

Jedes ausgewählte Video wird **genau einmal pro ausgewähltem Kanal** gesendet,
keine Rotation und kein Auffüllen eines einzelnen Videos auf zehn Posts.
Buffer bzw. die jeweilige Plattform prüft Medienformat/-größe/-dauer; MP4 mit
H.264/AAC ist zu bevorzugen. Der lokale Renderer verwendet MP4, wenn der Browser
es unterstützt, andernfalls WebM — beides lädt die App direkt zum gewählten
Provider hoch. Die App prüft die gelieferten Upload-Adressen, garantiert aber keine
externe Erreichbarkeit oder plattformübergreifende Medienkompatibilität.

| Modus | Verhalten |
| --- | --- |
| **Buffer-Queue** (Standard) | `addToQueue`: Buffer wählt Slots aus deinem dortigen Zeitplan |
| **Jetzt posten** | `shareNow`: nach ausdrücklichem Klick direkt zur Veröffentlichung übergeben |
| **Auto-Plan** | `customScheduled`: nächste lokal freie Slots um 06:00 & 20:00 Uhr |
| **Frei planen** | Eigene Uhrzeiten, Startdatum und Tagesabstand in Europe/Berlin |

Der Browser wartet standardmäßig **3 Sekunden nach jeder Buffer-Antwort** vor
der nächsten Anfrage (einstellbar 2–60 Sekunden, auch zwischen Kanälen). Das ist
ein **Sendeintervall**, kein Veröffentlichungsintervall der Queue. Es findet
kein paralleler Versand statt. Tab offen lassen; Stop beendet den Stapel **nach
dem aktuellen Post**, dessen Ergebnis noch gespeichert wird. Bereits bei Buffer
angenommene Posts bleiben dort bestehen und können unabhängig vom Tab erscheinen.

Das Versandjournal liegt unter einem neuen Buffer-spezifischen localStorage-Key.
Bestätigte Posts werden sofort gespeichert; eindeutige Fehler lassen sich im
Kalender wiederholen. Bei Verbindungsabbruch ist das Ergebnis **Unklar** — der
Stapel stoppt, kein automatischer Retry erzeugt versehentlich ein Duplikat. Vor
weiteren Aktionen direkt in Buffer prüfen. Rate-Limits stoppen ebenfalls den
Stapel. Bestätigte Löschungen erfolgen zuerst bei Buffer, dann im lokalen Journal.

**Grenzen:** Das Journal gehört zu diesem Browser; lokale Daten nicht während des
Versands löschen und nur einen Versand-Tab verwenden. Keine globale, dauerhafte
Idempotenz-Datenbank. Der Kalender importiert keine extern erstellten Buffer-Posts.
Auto-/Frei-Plan überspringt nur lokal bekannte belegte Slots; für Abgleich mit
anderen Buffer-Posts **Buffer-Queue** verwenden. Statusänderungen kommen über
**Buffer-Status aktualisieren**, nicht durch einen lokalen Uhrzeit-Timer.

### Standardbeschreibung

Wird für **alle** ausgewählten Videos exakt mit diesen Absätzen übernommen,
ohne automatisch vorangestellten Titel oder zusätzliche Hashtags:

```text
You won't believe how this story ends...

Stay until the end because the plot twist is INSANE.

Would you have done the same?

#reddit #redditstories #storytime

#stories #fyp
```

Die Beschreibung ist im Versandfenster editierbar. YouTube bekommt zusätzlich
einen separaten Titel und die Kategorie Entertainment; Instagram wird als Reel
gesendet. Sonstige Konto-/Plattformvorgaben bleiben in Buffer maßgeblich.

### Intro-Karte

**Machine Settings → INTRO**: an/aus, Dauer von 1–12 Sekunden (inklusive Ein- und
Ausflug), Standard 3,5 Sekunden. Die helle Reddit-inspirierte Karte übernimmt den
jeweiligen Titel aus der vorbereiteten Idee. Lange Titel werden umgebrochen und
verkleinert, extrem lange Texte begrenzt. Voice startet sofort; während der Karte
wandern Captions in die untere Safe-Zone. Vorschau und Renderer verwenden denselben
Canvas-Zeichner. Änderungen erfordern **RE-RENDER** und die neu gerenderte Datei auf
deinem Hosting; ein später geänderter YouTube-Posttitel verändert das Video nicht.
Die Vorschau respektiert reduzierte Bewegung; im exportierten Video bleibt die
gewählte Animation enthalten. Kein Referenz-Anhang lag bei der Umsetzung vor.

### Verwendete Dokumentation

- [Hosting Media](https://developers.buffer.com/guides/hosting-media.html)
- [Create Video Post](https://developers.buffer.com/examples/create-video-post.html)
- [Posts & Scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html)
- [CreatePostInput](https://developers.buffer.com/types/CreatePostInput.html)
- [ShareMode](https://developers.buffer.com/types/ShareMode.html)
- [YouTube-Metadaten](https://developers.buffer.com/types/YoutubePostMetadataInput.html)
- [Instagram-Metadaten](https://developers.buffer.com/types/InstagramPostMetadataInput.html)
- [Cloudflare R2 Limits](https://developers.cloudflare.com/r2/platform/limits/) · [Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Backblaze B2 Pricing](https://www.backblaze.com/cloud-storage/pricing) · [S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Puter Cloud Storage](https://docs.puter.com/FS/) · [User-Pays Model](https://docs.puter.com/user-pays-model/)
- [Storage setup guide](docs/storage-providers.md)

## Lokaler Asset-Speicher

Hintergrund-Clips und Musik landen in **IndexedDB** (`src/lib/storage.ts`) und
überleben Reload, Tab-Neustart und Offline-Nutzung — nichts wird hochgeladen.
Löschen, Leeren und die Soundtrack-Auswahl werden mitgespeichert; der Hero
zeigt unter `ASSET VAULT` an, was gerade lokal liegt.

## Quick start

```bash
npm install
npm run dev        # open the printed URL (narration relay included, same origin)
npm run build      # static bundle in dist/ (deploy api/ alongside it)
npm run typecheck  # TypeScript checks
npm test           # unit/integration tests with mocked Buffer; Node 22.7+
```

Deploying to Vercel works with zero configuration: `api/tts.js` is picked up
as a Serverless Function automatically, and the `ws` dependency is installed
during build. No environment variables are needed for narration.

### Why the TTS relay exists

Microsoft's Edge Read-Aloud endpoint is WebSocket-only, and every **browser**
WebSocket handshake automatically carries an `Origin` header — which that
endpoint rejects. Supabase's Edge Function runtime proved unreliable for
outbound third-party WebSockets (invocations terminate after ~10ms CPU with
"EarlyDrop" before any audio arrives). The proven `edge-tts` protocol
implementation (TrustedClientToken + `Sec-MS-GEC` BigInt token,
`speech.config`, SSML, WordBoundary parsing) therefore lives in
`api/tts.js` — a Vercel Serverless Function pinned to the **Node.js runtime**
(`export const config = { runtime: 'nodejs' }`), where raw `ws` connections
work without restriction. The frontend POSTs to this same-origin endpoint:

```
POST /api/tts
{ "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }

200 { "ok": true, "format": "audio/mpeg", "audioBase64": "…", "words": [ … ] }
```

Same origin → no CORS, no apikey, no Supabase anon key, no configuration.
`src/lib/tts.ts` keeps the same `TtsResult` / `WordTs` / `Cue` / `buildCues` /
`cueAt` exports — the renderer is untouched.

## How it works

| Piece | Where |
| --- | --- |
| Stories | Browser → Qwen/Mistral directly (optional), else offline writer |
| Voice | Browser → same-origin Vercel Serverless Function `/api/tts` (Node runtime + `ws`) ⇄ Microsoft Edge Read-Aloud WebSocket — free, no API key, the public `edge-tts` protocol with the `Sec-MS-GEC` token computed in BigInt |
| Captions | WordBoundary timestamps grouped into N-word cues, drawn on canvas |
| Rendering | Canvas 2D + WebAudio graph + MediaRecorder, real-time capture, MP4/H.264 on Safari with automatic WebM fallback |
| ZIP | JSZip (STORE) → blob anchor, fully local |
| Your files | Sources and renders stay local; finished renders go straight from the browser into the selected R2, B2 or Puter host |
| Upload host | Browser → `/api/upload` (server-signed S3 PUT for R2/B2, or Puter.js) → provider; permanent public URL comes back for Buffer |
| Buffer | Browser → `/api/buffer` → `https://api.buffer.com` GraphQL; key stays server-side |

Rendering is real-time: a 40-second voice takes ~40 seconds per unit, and the
tab must stay in the foreground (that's how MediaRecorder captures frames).

## Project layout

```
src/
├─ App.tsx                     orchestrator: prepare → render → zip
├─ components/
│  ├─ Header.tsx               LEDs, clock, marquee
│  ├─ SettingsPanel.tsx        6-tab settings console + animated intro preview
│  ├─ Controls.tsx             sliders, toggles, segmented, colour swatches
│  ├─ IdeasPanel.tsx           the 10 numbered inputs
│  ├─ ClipMill.tsx             1-source slicing + link intake + 10-file mode
│  ├─ Uploaders.tsx            soundtrack deck
│  ├─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay
│  └─ PasswordGate.tsx          page-scoped password gate
└─ lib/
   ├─ settings.ts   llm.ts   tts.ts   renderer.ts   clips.ts   media.ts   types.ts

api/        ← auth, TTS, Buffer relay + provider presign (Vercel Node.js Functions)
shared/     ← public URL validation + Buffer payload building
server/     ← same-origin API middleware for local Vite development
tests/      ← Buffer relay, dispatch, scheduling, provider presign and intro regression tests
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
```

— Local rendering. Your hosting. Buffer dispatch.
