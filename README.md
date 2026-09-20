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
   your configured upload host (if set up) and then handed to Buffer
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
* Or paste a **direct video URL** (`…/clip.mp4`) that allows cross-origin requests — your own hosting, S3/R2, Pexels, Coverr, Mixkit. Those are streamed into a local blob with a progress bar and sliced exactly the same way.

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
öffentlich abrufbare Medien-URLs. Der Mittelweg dafür ist ein **Upload-Host**,
der **genau einmal** mit dieser App verbunden wird. Danach lädt die App jedes
fertig gerenderte Video selbst hoch und übergibt Buffer den dauerhaften
öffentlichen Link — **kein manuelles Eintippen von Links mehr**. Zwei Arten von
Hosts werden unterstützt:

| | **Option A: Internet Archive** | **Option B: S3-Bucket (R2 / B2 / AWS)** |
| --- | --- | --- |
| Kosten | **komplett kostenlos** | Free Tier mit Kontingenten (R2: 10 GB) |
| Limits | **keine** (kein Speicher-/Traffic-Limit, keine Karte nötig) | Kontingente; R2 verlangt einmalig eine Zahlungsmethode |
| Permanenz | dauerhaft, öffentlich | dauerhaft, öffentlich |
| Setup | nur 4 Env-Variablen, **kein CORS/kein Bucket-Setup** | Bucket + Public-Access + CORS-Regel |
| Tempo | Upload in 4-MB-Häppchen über das Relay; Datei kurz nach dem Upload abrufbar | direkter Browser-Upload, sofort abrufbar |

Bei beiden gilt: Die Videos werden von der App hochgeladen, Buffer bekommt die
permalink-fähige öffentliche Adresse automatisch — und der Versand-Lauf ist ab
jetzt: einen Knopf drücken → alle Videos werden nacheinander hochgeladen →
jeder Post geht mit kurzer Pause an Buffer.

#### Option A: Internet Archive — komplett kostenlos, ohne Limits

Das [Internet Archive](https://archive.org) hostet Medien dauerhaft und
öffentlich, ohne Speicher- oder Bandbreitenlimits und ohne Zahlungsmethode.
Die App nutzt die offizielle
[S3-artige API](https://archive.org/developers/ias3.html) des Archivs
(`Authorization: LOW …`, Multipart-Upload, automatische Item-Anlage). Ein
CORS- oder Bucket-Setup ist **nicht nötig**: Die Videodatei wird in
4-MB-Häppchen über das hiesige Relay (`/api/upload`, same-origin) direkt ins
Archiv gestreamt — der geheime Schlüssel verlässt den Server auf diesem Weg
nicht. Sollte dieser Weg einmal scheitern, versucht die App automatisch einen
einzigen direkten Browser-Upload als Fallback.

Einmalige Einrichtung (≈ 5 Minuten):

1. Kostenloses Konto auf [archive.org](https://archive.org) anlegen (nur
   E-Mail — **keine Kreditkarte, kein Abo**).
2. S3-Schlüssel abrufen: [archive.org/account/s3.php](https://archive.org/account/s3.php)
   → **access key** und **secret key** notieren.
3. Zugangsdaten **ausschließlich als Server-Umgebungsvariablen** setzen
   (lokal `.env.local`, auf Vercel Projekteinstellungen), dann neu
   starten/deployen. Kein `VITE_`-Präfix!

   ```bash
   S3_ACCESS_KEY_ID=<dein-access-key>
   S3_SECRET_ACCESS_KEY=<dein-secret-key>
   S3_BUCKET=shortsfactory-videos     # Item-Name: 3–80 Zeichen, keine "--"
   S3_ENDPOINT=https://s3.us.archive.org
   ```

4. App neu laden — das Versandfenster zeigt **„Internet Archive verbunden“**.

Eigenschaften, die man kennen sollte:

* **Der Item-Name (S3_BUCKET) wird beim ersten Upload automatisch angelegt**
  und ist dann öffentlich unter `archive.org/details/<item>` sichtbar; jede
  Videodatei erhält eine dauerhafte Adresse
  `https://archive.org/download/<item>/<datei>` (bzw. die äquivalente
  `s3.us.archive.org`-Adresse, je nachdem, welche beim Abschluss des Uploads
  schon erreichbar ist). Die App prüft das nach dem Upload selbst und wählt
  die Live-Adresse.
* **Alles ist öffentlich und dauerhaft** — genau wie die TikTok/IG/YT-Posts
  selbst. Dateien zu Posts, die schon veröffentlicht wurden, kann man drin
  lassen; alte Entwürfe im Archiv-Webinterface löschen (Item-Seite →
  Bearbeiten → Delete). Es gibt kein automatisches Aufräumen — und auch kein
  Limit, das eines erzwingen würde.
* **Kurz nach dem Upload ist die Datei verfügbar** (die Ingestion des Archivs
  dauert typischerweise Sekunden bis wenige Minuten). Für den
  **Buffer-Queue**-Modus ist das irrelevant; bei **„Jetzt posten“** die erste
  Datei einmal im privaten Browserfenster gegenprüfen.
* **Wenn das Archiv überlastet ist** (503 SlowDown), stoppt der Lauf mit einer
  klaren Meldung, ohne etwas an Buffer zu senden — wenige Minuten später
  erneut drücken.
* **Sicherheit:** Auf dem Relay-Weg bleibt der Schlüssel serverseitig. Nur im
  Fallback-Fall wird er an den eigenen Browser übergeben — Deployment daher
  zwingend hinter Zugriffsschutz (siehe oben), genau wie bei `BUFFER_API_KEY`.

#### Option B: S3-kompatibler Bucket (Cloudflare R2 / Backblaze B2 / AWS S3)

Wer eigene Domain, maximale Geschwindigkeit oder volle Kontrolle will,
verbindet stattdessen einen S3-kompatiblen Bucket. Einmalige Einrichtung:

1. Bucket anlegen und **öffentlichen Lesezugriff** aktivieren:
   * **Cloudflare R2** → Settings → Public access: *r2.dev-Subdomain* erlauben
     (oder eigene Domain anbinden — für Produktion empfohlen, r2.dev ist
     ratenlimitiert). R2 ist Buffer-seitig ausdrücklich als Hosting empfohlen
     und im Free Tier enthalten (10 GB).
   * **Backblaze B2** → Bucket-Settings → *Files in bucket are: Public*.
   * **AWS S3** → Bucket-Policy mit `s3:GetObject` für `*`.
2. **CORS-Regel** im Bucket hinterlegen, damit der Browser hochladen darf
   (PUT/GET/HEAD, Allowed Header `content-type`). `"*"` als Origin ist hier
   okay: Schreiben funktioniert nur mit deiner gültigen Signatur, Lesen ist
   ohnehin öffentlich:

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. Zugangsdaten **ausschließlich als Server-Umgebungsvariablen** setzen
   (lokal `.env.local`, auf Vercel Projekteinstellungen), dann neu
   starten/deployen. Kein `VITE_`-Präfix!

   ```bash
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_BUCKET=…
   S3_REGION=auto              # R2: auto · AWS: z. B. eu-central-1 · B2: z. B. us-west-004
   S3_ENDPOINT=…               # R2: https://<accountid>.r2.cloudflarestorage.com · B2: https://s3.<region>.backblazeb2.com · AWS: leer lassen
   S3_PUBLIC_BASE_URL=…        # R2: https://pub-<hash>.r2.dev oder eigene Domain · AWS/B2: wird automatisch abgeleitet
   ```

4. App neu laden: Das Versandfenster zeigt **„Upload-Host verbunden“** und der
   Ablauf ist ab jetzt: einen Knopf drücken → alle Videos werden nacheinander
   hochgeladen → jeder Post geht mit kurzer Pause an Buffer.

#### Konkret: Cloudflare R2 (Option B im Detail) — einmal durchklicken, fertig

Warum R2, wenn es auch das Archiv tut: **eigene Domain anbindbar, sehr schnelle
Auslieferung, EU-Standort wählbar**, 10 GB Speicher + 1 Mio. Schreib-/10 Mio.
Lese-Operationen pro Monat kostenlos, kein Traffic-Entgelt (Egress frei), von
Buffers eigener Hilfe als Hosting für API-Posts empfohlen. Es fällt **kein Abo
an** — Cloudflare verlangt nur eine Zahlungsmethode (Karte/PayPal) zur
Freischaltung von R2. Bei ~10 Shorts à 10–30 MB pro Woche bleibt man weit
innerhalb des kostenlosen Kontingents.

1. **Konto:** Auf [dash.cloudflare.com](https://dash.cloudflare.com) ein
   kostenloses Konto anlegen (E-Mail + Passwort, Free-Plan genügt).
2. **R2 freischalten:** Links im Menü **R2 Object Storage** wählen und die
   Einmal-Aktivierung durchführen (kostenloses Kontingent, Zahlungsmethode
   hinterlegen — erst danach wird R2 freigeschaltet).
3. **Bucket anlegen:** **R2 → Overview → Create bucket**. Name z. B.
   `shortsfactory`, Location-Hint **European Union**. Anschließend im Bucket
   unter **Settings → Public Development URL → Enable** aktivieren (in dem
   Dialog `allow` eintippen). Notiere die Adresse — das ist später
   `S3_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev`.
4. **CORS-Regel:** Gleiche Seite (**Settings**) → **CORS Policy → Add CORS
   policy** (JSON-Tab) → das JSON von oben einfügen → Save.
5. **API-Token:** **R2 → Overview → (rechts) Manage R2 API Tokens → Create API
   Token** → Name egal, **Permissions: Object Read & Write**, **Specify
   bucket(s)** → nur den neuen Bucket → Create. Die Seite zeigt **Access Key
   ID**, **Secret Access Key** und den **S3-Endpoint**
   `https://<accountid>.r2.cloudflarestorage.com`. Die Keys sind **nur einmal
   sichtbar** — direkt notieren.
6. **App verbinden:**
   * **Lokal:** im Projektordner `.env.local` anlegen:

     ```bash
     S3_ACCESS_KEY_ID=…            # aus Schritt 5
     S3_SECRET_ACCESS_KEY=…        # aus Schritt 5
     S3_BUCKET=shortsfactory
     S3_REGION=auto
     S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
     S3_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev
     ```

     dann `npm run dev` neu starten.
   * **Vercel:** [vercel.com](https://vercel.com) → Projekt → **Settings →
     Environment Variables** → dieselben sechs Variablen (plus vorhandenes
     `BUFFER_API_KEY`) für Production **und** Preview eintragen →
     **Deployments → Redeploy** (Umgebungsvariablen gelten erst im neuen
     Deployment). Deployment unbedingt mit **Deployment Protection**
     absichern — die App ist ein privates Operator-Werkzeug.
7. **Testen:** App öffnen → Video rendern → **Alle N Videos auf einmal
   posten** → oben muss **„Upload-Host shortsfactory verbunden — du musst
   keine Links mehr eintragen“** stehen. Gegenprobe: die `pub-…r2.dev`-Adresse
   eines hochgeladenen Videos in einem privaten Browserfenster öffnen — das
   Video muss direkt spielen/laden.

**Aufräumen (optional):** Bucket → **Settings → Lifecycle Rules** → Regel für
Präfix `shortsfactory/` mit „Delete objects after N days“ (z. B. 30) — alte
Renders verschwinden automatisch und der Speicher bleibt im Free Tier.

**Eigene Domain (optional, später):** r2.dev ist in der Bandbreite gedrosselt,
für diesen Zweck aber völlig ausreichend, weil Buffer die Datei serverseitig
und nur einmal pro Post abruft. Wer will: Domain bei Cloudflare registrieren
(≈ 10 $/Jahr, zum Einstandspreis) → Bucket → **Settings → Custom Domains →
Connect Domain** → statt der r2.dev-Adresse die eigene Domain als
`S3_PUBLIC_BASE_URL` eintragen.

**Alternativen:** **Backblaze B2** ([backblaze.com](https://www.backblaze.com),
10 GB frei): Bucket anlegen → Bucket Settings → *Files in bucket are Public* →
dieselbe CORS-Regel eintragen (Feld „CORS Rules“) → Endpoint
`https://s3.<region>.backblazeb2.com` (Region z. B. `us-west-004` oder
`eu-central-003`); `S3_PUBLIC_BASE_URL` wird automatisch abgeleitet.
**AWS S3** ([aws.amazon.com](https://aws.amazon.com)): nach den allgemeinen
Schritten oben, Endpoint leer lassen; kostet jenseits des Free Tier auch
Egress — daher R2 vorziehen.

**Kurz-Troubleshooting:**

| Symptom | Ursache / Fix |
| --- | --- |
| Versandfenster zeigt weiter „Kein Upload-Host eingerichtet“ | Env-Vars fehlen im Prozess — nach `.env.local`-Änderung dev-Server neu starten; auf Vercel neu deployen |
| Internet Archive: „… überlastet (503 SlowDown)“ | Archiv-Warteschlange voll — wenige Minuten warten, erneut senden; es wurde nichts an Buffer übergeben |
| Internet Archive: Link direkt nach Upload nicht abrufbar | Ingestion läuft noch (Sekunden bis Minuten) — die App wählt automatisch die gerade erreichbare Adresse; im Zweifel privat gegenprüfen |
| Internet Archive: „… Item-Name …“ | `S3_BUCKET` muss 3–80 Zeichen haben (Buchstaben/Zahlen/`._-`), kein `--` |
| Internet Archive: Relay **und** Direkt-Upload schlugen fehl | Schlüssel prüfen (frisch aus s3.php kopiert?), dann erneut versuchen — sendeseitig ist nichts passiert |
| „Upload fehlgeschlagen — prüfe die CORS-Freigabe“ (Option B) | CORS-Regel fehlt/falsch — exakt das JSON oben eintragen |
| „S3_PUBLIC_BASE_URL fehlt“ (Option B) | r2.dev-Public-URL nicht als `S3_PUBLIC_BASE_URL` gesetzt |
| Upload ok, aber Buffer meldet Medienfehler | Public-URL in privatem Fenster testen — sie muss das Video direkt ausliefern; prüfen, ob r2.dev noch aktiviert ist |
| r2.dev wirkt langsam / gedrosselt | Eigene Domain anbinden (oben) |

Hinweise: Pro Upload erzeugt die App einen eindeutigen Schlüssel (Option B:
`shortsfactory/<datum>/…`, Option A: flacher `<datum>-<zeit>-<zufall>-<datei>`
Name im Item) — es wird nie etwas überschrieben. Die erzeugten Links sind
dauerhaft (keine ablaufenden Signaturen), damit Buffer sie bis zur
Veröffentlichung abrufen kann. Aufräumen: alte Dateien im Bucket entweder
manuell löschen oder per Lifecycle-Regel (z. B. nach 30 Tagen); im Internet
Archive über die Item-Seite löschen. R2/MinIO ohne ableitbare öffentliche
Adresse verlangen zwingend `S3_PUBLIC_BASE_URL`; die Route lehnt den Versand
in dem Fall mit einer klaren Fehlermeldung ab, statt Links zu erzeugen, die
Buffer nie abrufen könnte.

### Der Ein-Klick-Versand (alle 10 auf einmal)

**ALLE N VIDEOS AUF EINMAL POSTEN** in der Output Bay öffnet das Versandfenster
vorausgewählt: alle fertigen Videos markiert, Kanäle, Beschreibung und Modus
aus der letzten Einrichtung übernommen. Ein Startdruck führt dann aus:

1. **Upload-Phase** — jedes ausgewählte Video wird nacheinander in den
   Upload-Host übertragen (Fortschrittsbalken je Video). Schlägt ein Upload
   fehl oder wird abgebrochen, wurde **noch nichts an Buffer gesendet**.
2. **Versand-Phase** — die Posts gehen wie gewohnt **sequenziell mit kurzer
   Pause** (Standard 3 Sekunden nach jeder Buffer-Antwort, einstellbar
   2–60 Sekunden) an Buffer, damit zuverlässig alle Videos durchgehen. Kein
   paralleler Versand; Tab offen lassen; Stop beendet nach dem aktuellen Post.

Bereits hochgeladene Videos werden wiederverwendet (kein Doppel-Upload);
pro Video gibt es „Erneut hochladen“, um bewusst einen neuen Link zu erzeugen.
Sendet das Journal bereits nicht fehlgeschlagene Posts mit denselben Titeln,
verlangt das Fenster eine zusätzliche Bestätigung gegen versehentliche
Doppelposts. Wer partout keinen Upload-Host einrichten will, schaltet im
Fenster auf „stattdessen eigene Links eintragen“ um (siehe Fallback unten).

### Ohne Upload-Host (Fallback): Links manuell eintragen

Auch ohne eingerichteten Upload-Host funktioniert der Versand — mit **deinem
eigenen Hosting** und ohne zusätzlichen Storage-Dienst:

1. Videos fertig rendern und einzeln oder als ZIP herunterladen.
2. Die **fertigen Ausgabedateien** auf dein vorhandenes Hosting laden.
3. **ALLE N VIDEOS AUF EINMAL POSTEN** in der Output Bay anklicken (oder den
   BUFFER-Knopf auf einer einzelnen Karte für ein einzelnes Video).
4. Im Fenster auf „stattdessen eigene Links eintragen“ schalten, dann pro Video
   den direkten HTTPS-Link eintragen — alternativ alle Links
   zeilenweise in derselben Reihenfolge einfügen. Einzelne Videos lassen sich
   abwählen. Die lokale Vorschau hilft beim Zuordnen.
5. Links ohne Login in einem privaten Browserfenster prüfen und bestätigen.
   Die URL muss die Videodatei liefern, keine HTML-Vorschau. Sie muss bis zur
   tatsächlichen Veröffentlichung erreichbar bleiben. Keine ablaufenden
   Signaturen, lokalen `blob:`-Links oder Drive-/Social-Freigabeseiten.
6. Beschreibung, Kanäle und Modus prüfen, dann den gesamten Stapel senden.

Jedes ausgewählte Video wird **genau einmal pro ausgewähltem Kanal** gesendet,
keine Rotation und kein Auffüllen eines einzelnen Videos auf zehn Posts.
Buffer bzw. die jeweilige Plattform prüft Medienformat/-größe/-dauer; MP4 mit
H.264/AAC ist zu bevorzugen. Der lokale Renderer verwendet MP4, wenn der Browser
es unterstützt, andernfalls WebM. WebM gegebenenfalls vor dem Hosting konvertieren.
Die App prüft URL-Formate, garantiert aber keine externe Erreichbarkeit oder
plattformübergreifende Medienkompatibilität.

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
- [Internet Archive: S3-artige API](https://archive.org/developers/ias3.html) (Upload-Host Option A)

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
| Your files | Sources and renders stay local; with an upload host, finished renders go straight from the browser into your own bucket |
| Upload host | Browser → `/api/upload` (presigned PUT, SigV4) → your S3-compatible bucket; permanent public URL comes back for Buffer |
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
tests/      ← Buffer relay, dispatch, scheduling, upload signing and intro regression tests
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
```

— Local rendering. Your hosting. Buffer dispatch.
