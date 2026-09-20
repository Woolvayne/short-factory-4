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
   your connected Vercel Blob store and then handed to Buffer
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
4. **Deployment vor öffentlichem Zugriff schützen** (z. B. Vercel Deployment
   Protection oder ein authentifizierter Reverse Proxy). Diese persönliche
   Operator-App hat keine eigene Benutzerverwaltung; der geheime serverseitige
   Key allein ist keine Zugriffskontrolle für die API-Routen.

Ohne Key wird der Versand ausdrücklich abgelehnt. Kein Simulationsmodus,
keine erfundenen Post-IDs und keine falschen Erfolgsmeldungen.

Ohne Key wird der Versand ausdrücklich abgelehnt. Kein Simulationsmodus,
keine erfundenen Post-IDs und keine falschen Erfolgsmeldungen.

### Upload-Host — einmal einrichten, nie wieder Links eintippen

Buffer akzeptiert **keine direkten Datei-Uploads per API**, sondern benötigt
öffentlich abrufbare Medien-URLs. Der Mittelweg dafür ist **Vercel Blob** als
Upload-Host — der **einzige** von dieser App unterstützte Weg. Er wird **genau
einmal** verbunden; danach lädt die App jedes fertig gerenderte Video selbst
hoch und übergibt Buffer den dauerhaften öffentlichen Link — **kein manuelles
Eintippen von Links mehr**.

#### Vercel Blob — der eine Upload-Host

[Vercel Blob](https://vercel.com/docs/storage/vercel-blob) ist Vercels
Dateispeicher mit CDN: Die Videos liegen dauerhaft unter einer öffentlichen
Adresse `https://<store>.public.blob.vercel-storage.com/…` — genau der
permanente Link, den Buffer braucht. Der Ablauf pro Video: Der Browser holt
sich von `/api/upload` ein **kurzlebiges, eingeschränktes Upload-Token**
(Pfad-Guard `shortsfactory/*`, nur MP4/WebM, max. 2 GB, zufälliger Suffix) und
lädt die Datei damit **direkt** zu Vercel Blob hoch. Das geheime
Read/Write-Token berührt den Upload nicht; die Videos laufen nie durch den
App-Server. Kein CORS-Setup, kein Bucket-Setup, keine Signaturen, die ablaufen.

Einmalige Einrichtung — **zwei Wege, einer genügt:**

1. **Serverseitig (empfohlen auf Vercel):**
   [vercel.com](https://vercel.com) → Projekt → **Storage → Blob → Create
   Database/Store** → Store ans Projekt **„Connect“** hängen. Vercel injiziert
   `BLOB_READ_WRITE_TOKEN` dann **automatisch** als Umgebungsvariable
   (danach einmal **Redeploy**). Alternativ die Variable von Hand setzen:
   **Storage → Blob → .env.local**-Tab zeigt das Token; lokal in `.env.local`
   eintragen und `npm run dev` neu starten. Kein `VITE_`-Präfix!
2. **In der App (ohne Env, ohne Redeploy):** Versandfenster öffnen (**ALLE N
   VIDEOS AUF EINMAL POSTEN**) → **Read/Write-Token einfügen** → **Vercel Blob
   verbinden**. Die App prüft das Token direkt bei Vercel und speichert es
   **nur in diesem Browser** (localStorage, genau wie die AI-Keys).

Ist beides gesetzt, gewinnt das serverseitige Token. Getrennt wird die
In-App-Verbindung jederzeit über **„Verbindung trennen“** im Versandfenster.

**Kostenrahmen und Grenzen (Hobby / Free Tier):**

* **1 GB Speicher** und **10 GB Datentransfer pro Monat** kostenlos —
  bei ~10 Shorts à 10–30 MB pro Woche ausreichend, **wenn regelmäßig
  aufgeräumt wird** (siehe unten).
* Der **Hobby-Plan ist nur für nicht-kommerzielle Projekte** gedacht. Wer
  kommerziell arbeitet oder mehr Speicher braucht, braucht einen bezahlten
  Vercel-Plan (Blob wird dann verbrauchsbasiert abgerechnet).
* Pro Video max. **2 GB** (App-Limit); jeder Upload bekommt einen
  Zufalls-Suffix — es wird nie etwas überschrieben und keine alte Datei
  ersetzt.

**Aufräumen (wichtig bei 1 GB):** Alte Renders regelmäßig im Dashboard löschen
(Storage → Blob → Store → Dateien auswählen → Delete), sonst ist das
Gigabyte irgendwann voll. Dateien zu bereits veröffentlichten Posts können
drin bleiben — sie stören nicht, verbrauchen aber Speicher. Ein automatisches
Aufräumen gibt es nicht.

**Kurz-Troubleshooting:**

| Symptom | Ursache / Fix |
| --- | --- |
| Versandfenster zeigt weiter „Vercel Blob ist noch nicht verbunden“ | Env-Var fehlt im Prozess — nach `.env.local`-Änderung dev-Server neu starten; auf Vercel nach „Connect“ neu deployen. Oder In-App-Token einfügen |
| „Token abgelehnt“ beim Verbinden | Token ist kein gültiges/aktuelles Read/Write-Token — frisch aus Storage → Blob → .env.local kopieren (Format `vercel_blob_rw_…`) |
| „Store nicht gefunden oder pausiert“ | Store wurde gelöscht/umbenannt oder das Projekt ist entkoppelt — Storage im Dashboard prüfen, Store neu verbinden |
| Upload bricht mit Serverfehler/Timeout ab | Vercel Blob kurzzeitig gestört — Status unter vercel-status.com prüfen, später erneut senden; es wurde nichts an Buffer übergeben |
| „1 GB voll“ / Uploads schlagen mit Kontingentfehler fehl | Alte Videos im Store löschen (siehe Aufräumen) oder Plan erweitern |
| Upload ok, aber Buffer meldet Medienfehler | Öffentliche Adresse in einem privaten Browserfenster testen — sie muss das Video direkt ausliefern |

**Zur Sicherheit:** Bei der Env-Variante bleibt das Token komplett
serverseitig; bei der In-App-Variante liegt es im localStorage dieses Browsers
und wird je Anfrage an die eigene Same-Origin-Route geschickt (niemals in
Antworten zurückgegeben, niemals an Dritte). Das ist dasselbe Modell wie die
AI-Keys dieser App — vorausgesetzt, das Deployment steht hinter
Zugriffsschutz (siehe oben). Das im Browser genutzte Client-Token ist
kurzlebig (1 Stunde) und auf `shortsfactory/*`, MP4/WebM und 2 GB
eingeschränkt.

### Der Ein-Klick-Versand (alle 10 auf einmal)

**ALLE N VIDEOS AUF EINMAL POSTEN** in der Output Bay öffnet das Versandfenster
vorausgewählt: alle fertigen Videos markiert, Kanäle, Beschreibung und Modus
aus der letzten Einrichtung übernommen. Ein Startdruck führt dann aus:

1. **Upload-Phase** — jedes ausgewählte Video wird nacheinander zu Vercel Blob
   übertragen (Fortschrittsbalken je Video). Schlägt ein Upload
   fehl oder wird abgebrochen, wurde **noch nichts an Buffer gesendet**.
2. **Versand-Phase** — die Posts gehen wie gewohnt **sequenziell mit kurzer
   Pause** (Standard 3 Sekunden nach jeder Buffer-Antwort, einstellbar
   2–60 Sekunden) an Buffer, damit zuverlässig alle Videos durchgehen. Kein
   paralleler Versand; Tab offen lassen; Stop beendet nach dem aktuellen Post.

Bereits hochgeladene Videos werden wiederverwendet (kein Doppel-Upload);
pro Video gibt es „Erneut hochladen“, um bewusst einen neuen Link zu erzeugen.
Sendet das Journal bereits nicht fehlgeschlagene Posts mit denselben Titeln,
verlangt das Fenster eine zusätzliche Bestätigung gegen versehentliche
Doppelposts. Ohne verbundenen Vercel-Blob-Store zeigt das Fenster den
Verbinden-Dialog — ein manuelles Eintragen von Links gibt es nicht mehr.

Jedes ausgewählte Video wird **genau einmal pro ausgewähltem Kanal** gesendet,
keine Rotation und kein Auffüllen eines einzelnen Videos auf zehn Posts.
Buffer bzw. die jeweilige Plattform prüft Medienformat/-größe/-dauer; MP4 mit
H.264/AAC ist zu bevorzugen. Der lokale Renderer verwendet MP4, wenn der Browser
es unterstützt, andernfalls WebM — beides lädt die App direkt zu Vercel Blob
hoch. Die App prüft die gelieferten Upload-Adressen, garantiert aber keine
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
- [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) · [Client uploads](https://vercel.com/docs/storage/vercel-blob/client-upload) (Upload-Host)

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
| Your files | Sources and renders stay local; finished renders go straight from the browser into your Vercel Blob store |
| Upload host | Browser → `/api/upload` (Vercel-Blob client token, constrained to `shortsfactory/*`) → direct browser PUT to Vercel Blob; permanent public URL comes back for Buffer |
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
│  └─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay
└─ lib/
   ├─ settings.ts   llm.ts   tts.ts   renderer.ts   clips.ts   media.ts   types.ts

api/        ← TTS + Buffer relays (Vercel Serverless Functions, Node.js)
shared/     ← public URL validation + Buffer payload building
server/     ← same-origin API middleware for local Vite development
tests/      ← Buffer relay, dispatch, scheduling, upload client-token and intro regression tests
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
```

— Local rendering. Your hosting. Buffer dispatch.
