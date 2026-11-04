# Pocket Ai Research

<p align="center"><img src="design/logo-3d.png" alt="Pocket Ai Research logo: a hand putting a phone with a glowing AI spark into a jeans pocket" width="520"></p>

**Offline AI that runs on your device.**

An AI chat assistant that runs **entirely on your phone or computer**. Download a model once, then chat any time, even with no internet connection. Your conversations never leave your device.

- **Android app:** download the latest APK from [Releases](https://github.com/pocketai-research/pocket-ai-research/releases/latest)
- **Web version:** https://pocketai-research.github.io/pocket-ai-research/ (installable, works offline)

## Install on Android

1. Open the [latest release](https://github.com/pocketai-research/pocket-ai-research/releases/latest) on your phone and download `PocketAiResearch-<version>.apk`.
2. Open the file. If Android asks, allow your browser or file manager to **install unknown apps**.
3. Tap **Install**, open **Pocket Ai Research**, choose a model and download it once (Wi-Fi recommended).
4. From then on the chat works offline, even in airplane mode.

To update, install the newer APK over the old one. Downloaded models are kept. The app checks GitHub for a new release twice a day when online and shows a **Download** link when there is one ([src/updates.ts](src/updates.ts)); the web version updates itself.

Requirements: Android 7.0 or newer, at least 4 GB RAM, and 0.5 to 1.1 GB of free storage per model.

## Why on-device?

| | Cloud AI (ChatGPT and similar) | Pocket Ai Research |
|---|---|---|
| Where the AI runs | The provider's servers | Your own device |
| Internet needed | Always | Only for the first model download |
| Privacy | Messages are sent to a server | Messages stay on your device |
| Cost | Subscription or API fees | Free |
| Capability | Very high | Moderate (small models) |

## Models

| Tier | Model | Download | Best for |
|---|---|---|---|
| Light | Qwen3 0.6B (Q4_K_M) | 397 MB | Any phone, quick questions |
| Balanced | Gemma 3 1B (Q4_K_M) | 806 MB | Best Indonesian and natural writing |
| Smart | Qwen3 1.7B (Q4_K_M) | 1.1 GB | Reasoning and sums; can think before answering; slower |
| Vision | InternVL3 1B (Q8_0) + image projector | 1.0 GB | Questions about photos, including text in them |

Under **AI replies** you can choose the reply language (English, Indonesian, or the language of your message), the length and the style. Small models follow the language setting unreliably: Indonesian replies work best with the Balanced model.

Each model card estimates how fast the model runs on your device and one is marked **Recommended for this device**: Balanced when the device has at least 4 GB of memory and runs it at about 4 tokens a second or more, otherwise Light. The estimate comes from a short CPU test (multiplying small matrices for under a second, once a month) scaled against the speeds measured for each model on a reference laptop and by the number of threads the engine uses; on that laptop the estimates were within 5% of the measured speeds ([src/deviceCheck.ts](src/deviceCheck.ts)).

The Light and Balanced models were chosen by comparing answers to Indonesian tasks (translating, a fact, a sum, explaining photosynthesis, writing a sick-day message): Qwen3 0.6B answered better than the earlier Qwen2.5 0.5B and about 1.7x faster, and Gemma 3 1B gave the best answers of all, ahead of the earlier Qwen2.5 1.5B, at about 80% of its speed. The earlier models stay listed while they are downloaded, so they can still be opened or deleted. Gemma is provided under and subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms). Each reply can be copied, shared, or regenerated.

**Templates** above the message box put a ready prompt in front of your text: summarise, translate to English or to Indonesian, fix grammar, write an email, explain simply. The translation templates set the reply language to the translation's target, whatever the reply settings say.

**Notes:** write notes under **Notes** on the start page (bills, plans, recipes, contacts) and ask about them in any chat, for example "Kapan saya harus bayar listrik?". Unlike attached documents, a note is only used when it matches the question (a shared word, or a close meaning with search by meaning on), at most two passages, and the sources under the reply name it.

**Memory:** say "Remember that…" or "Ingat bahwa…" in a chat (or add a fact under **Memory** on the start page) and the AI knows it in every chat from then on, such as your name, your job or how you like answers. Facts are only saved when you ask, never guessed from conversations; they stay on the device (up to 30), are added to the system prompt, and can be forgotten one by one or switched off ([src/memory.ts](src/memory.ts)).

**Instructions** above the message box tell the AI how to answer in the current chat ("You are a patient maths teacher", "Answer briefly"); they are added to the system prompt and saved with the chat. With the Smart model, **Think first** lets Qwen3 reason before it answers: better at maths and logic, but much slower on a phone, and the thinking uses the same token budget as the answer. Its thoughts are shown apart from the answer under **Show thinking**.

Models must stay well under 2 GB: in WebAssembly the weights need one allocation, and a 3B model (about 2 GB, e.g. Llama 3.2 3B) downloads but cannot load. The Smart model therefore is Qwen3 1.7B, with its thinking mode off unless you turn on Think first. It uses a 3,072-token context to save memory; older messages are dropped from what a model sees when a chat gets longer than its context.

Models are downloaded from Hugging Face on first use and kept in the app's private storage (the browser's Origin Private File System).

## Web app (PWA)

The web version is an installable Progressive Web App. A service worker precaches the whole app, including the AI engine's WebAssembly (about 13 MB), so after the first visit the site opens with no internet. Use **Install app** on the start page, or the browser's install option, to add it to the home screen or desktop. Downloaded models, chats, documents and offline map areas are stored in the browser either way. The Android app does not register the service worker: its files ship inside the APK.

## Read photos

Tap the camera button in the chat box to take or choose a photo, then ask about it (or just send it: the default question is "Describe this photo."). Photos need the **Vision** model, InternVL3 1B, which wllama loads together with its image projector (mmproj); with another model open, the app offers to switch. Photos are scaled down to 448 px before they are sent ([src/photo.ts](src/photo.ts)): that is one tile for the image encoder, while llama.cpp cuts larger photos into several tiles and reading them takes about five times longer. For small text, tap **Detail** on the photo before sending: it goes at up to 896 px (four tiles and an overview). Photos are saved with the chat, and only the most recent photo in a chat is shown to the model, so follow-up questions about it work while older photos do not use up memory.

Looking at a photo is slow on a CPU: about 2 minutes for the first answer on a 4-core laptop with 2 threads. Follow-up questions about the same photo are answered in seconds, because the photo stays in the model's memory. Small text in a photo is hard to read at 448 px: photograph documents up close, or use Detail.

## Voice

- **Speak a message:** tap the microphone in the chat box, speak, and pause; the words are sent as a message. In the Android app this uses the phone's own speech recogniser through [@capacitor-community/speech-recognition](https://github.com/capacitor-community/speech-recognition); it works offline once the language's offline speech pack is installed (Settings → Google → Voice). In the browser it uses the Web Speech API, which in Chrome sends audio to Google and needs internet.
- **Read replies aloud:** tap the speaker under a reply, or turn on **Read replies aloud** under AI replies. It uses the device's voices ([@capacitor-community/text-to-speech](https://github.com/capacitor-community/text-to-speech) on Android, `speechSynthesis` on the web), reads Markdown as plain sentences, and picks Indonesian or English from the reply language setting (or guesses it from the text) ([src/voice.ts](src/voice.ts)).
- **Voice chat:** tap **Voice chat** above the message box to talk hands-free: the app listens, sends what you said, reads the reply aloud, then listens again, until you tap **Stop voice chat** or say nothing twice in a row.

## Share to Pocket AI

Pick **Share → Pocket Ai Research** in another app (WhatsApp, a browser, the gallery, a file manager) to start a new chat with what you shared: text goes into the message box (ready for a template such as Summarise), a PDF or text file is attached as a document, and a photo waits for the Vision model. In the Android app this is a share intent handled by a small native plugin ([SharedContentPlugin.java](android/app/src/main/java/com/pocketairesearch/app/SharedContentPlugin.java), files up to 25 MB); in the installed web app it is the Web Share Target API, received by the service worker ([src/sw.js](src/sw.js), [src/shareTarget.ts](src/shareTarget.ts)).

## Ask your documents

Tap the paperclip in a chat to attach a PDF, TXT or Markdown file, then ask about it. Everything happens on the device:

- Text is extracted with [PDF.js](https://mozilla.github.io/pdf.js/) (loaded only when a PDF is opened) and split into passages of about 700 characters ([src/docs/extract.ts](src/docs/extract.ts)).
- For each question, the best-matching passages are found with BM25 keyword search, which ignores common English and Indonesian words ([src/docs/retrieve.ts](src/docs/retrieve.ts)). When nothing matches (for example "summarise this"), the start of the document is used.
- **Search by meaning** (Documents → Find passages by → Meaning) also ranks passages with a small multilingual embedding model, [multilingual E5 small](https://huggingface.co/intfloat/multilingual-e5-small) (132 MB, MIT, downloaded once), and fuses both rankings (reciprocal rank fusion). It finds passages that say the same thing in other words or another language: an Indonesian question about solar power found the right section of an English report that shares no word with the question. Each passage is indexed when the document is attached (about 0.15 s per passage on a laptop) and the vectors are stored with it ([src/ai/embeddings.ts](src/ai/embeddings.ts)). The model runs in its own wllama instance, one text per request.
- The AI answers from those passages only and cites them like [1]; the sources (file and page) are listed under the reply.
- **Quiz me** (above the message box when a document is attached) writes five practice questions from passages spread through the document, each a multiple-choice question with an explanation and its source, to answer as a quiz or turn over as flashcards ([src/quiz.ts](src/quiz.ts)). The model's output is held to a JSON schema (llama.cpp turns it into a grammar), so even small models produce well-formed questions; the choices are shuffled because small models tend to put the right one first. Each question takes a while on a phone, so they appear one by one.
- Documents are stored in IndexedDB, stay attached to their chat, and can be deleted under **Documents** on the start page. Scanned PDFs (pictures of pages) have no text and are not supported yet.

## Map

An online world map with GPS, where you can pick a country and then drill down through its own administrative levels (in Indonesia: province → regency / city → district (kecamatan) → village). Any selected region can be downloaded for offline use in the Android app.

- **Online map:** [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, "Liberty" style), drawn with [MapLibre GL JS](https://maplibre.org). Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- **Region lists:** countries are bundled ([src/map/countries.json](src/map/countries.json), generated once from OpenStreetMap). Levels below a country come from the [Overpass API](https://overpass-api.de) (with a mirror as fallback) and are cached on the device, so each list is slow only the first time. Level names per country are in [src/map/admin.ts](src/map/admin.ts).
- **Offline areas:** tiles for the region's box, plus the style, sprite and Latin glyphs, are stored in IndexedDB and served to MapLibre through an `offline://` protocol ([src/map/offlineMap.ts](src/map/offlineMap.ts)).

**Search and ask:** the Search tab finds places around your GPS position (or the map centre) in the map data itself: online from OpenFreeMap, offline from the saved area. Questions in English or Indonesian are matched to categories ("nearest hospital", "masjid terdekat", "SPBU", "apotek", ...) or to place names. Results are listed and numbered on the map with distance and direction, and when an AI model is open it writes a short answer using only those places, so it cannot invent locations ([src/map/places.ts](src/map/places.ts)).

**Trips:** the Trips tab records a walk, hike or ride with GPS: time, distance, average speed and climb while recording, the route drawn on the map, and saved trips kept on the device, to show again, export as GPX (for Strava, Komoot or Google Earth; shared through the share sheet in the Android app) or delete ([src/map/tripRecorder.ts](src/map/tripRecorder.ts)). Recording goes on when you switch tabs or open the chat, and the screen is kept on while it runs: Android's WebView receives no positions with the screen off or the app in the background, which would need a native background service.

**Saved places:** star a search result, or save your location or the map centre under a name such as "Rumah", to get directions with one tap (**Go**), online or in an offline area. Asking for a saved place by name works too ("rute ke rumah"). They are kept on the device in IndexedDB.

**Emergency (SOS):** the red **SOS** button on the map opens Indonesia's emergency numbers (112, 110, 118, 119, 113, 115; tap to call, free, needs mobile signal only), buttons for directions to the nearest hospital, police station or fire station (found and routed on the device, without waiting for an AI answer), and **My location**: coordinates, accuracy, a compass on phones with the sensor, and buttons to share the location, send it by SMS (works without internet) or copy it ([src/map/EmergencyPanel.tsx](src/map/EmergencyPanel.tsx)).

**Directions:** tap **Go** next to a place, or ask the way ("route to the nearest hospital", "rute ke SPBU terdekat", "jalan kaki ke masjid terdekat"). The route is worked out on the device from the roads in the same map tiles, online or in an offline area, for walking or for a car or motorbike (one-way streets respected). It is drawn on the map with the distance, an estimated time and turn-by-turn steps with street names, and the AI explains it using only those steps ([src/map/route.ts](src/map/route.ts)).

The tiles are made for drawing, not routing, so the road network is rebuilt from them: roads split at tile edges are joined, and junctions that the tiles' simplification removed are restored where a road ends on, or crosses, another (bridges and tunnels excepted). A* then searches it in a Web Worker. Limits, stated in the app too: no traffic, turn restrictions or road closures; travel times use typical town speeds; routes reach up to about 20 km on street-level data, and longer ones use a coarser zoom level with main roads only. An offline area must be detailed enough (neighbourhood level or better) for directions.

Downloads follow [OpenFreeMap's terms](https://openfreemap.org/tos/) for in-app offline downloads: at most 3,000 tiles or 50 MB per download, at most 4 parallel requests, and a User-Agent that identifies the app. The detail level therefore depends on the area's size: a district or regency gets street-level detail, a large province or a country gets a coarser map. The Android app adds the identifying User-Agent ([capacitor.config.ts](capacitor.config.ts)); browsers cannot, so the web version offers the online map only.

## How it works

- One codebase: a Vite + React + TypeScript web app. [Capacitor](https://capacitorjs.com) wraps the same app as an Android APK.
- The model runs with [wllama](https://github.com/ngxson/wllama) (llama.cpp compiled to WebAssembly). It runs on the CPU by default; GPU acceleration through WebGPU is an experimental setting. If the app dies while a model loads or replies (usually out of memory), the next launch explains what happened and steps the settings down (GPU off, then one CPU thread).
- Cross-origin isolation headers let wllama use several CPU threads, which roughly doubles speed. The Android app adds them in [MainActivity.java](android/app/src/main/java/com/pocketairesearch/app/MainActivity.java) and the local dev server in [vite.config.ts](vite.config.ts). GitHub Pages cannot set custom headers, so on the web the service worker ([src/sw.js](src/sw.js)) adds them; on the first visit the page reloads once when the worker takes over.
- There is no backend server or login. Chats are saved on the device in IndexedDB, and replies are rendered as Markdown without ever rendering raw HTML.

See [docs/CONCEPT.md](docs/CONCEPT.md) for the full concept and usage guide.

## Logo

A hand putting a phone with a glowing AI spark into a jeans pocket: the AI that lives in your pocket. The source is the 3D render [design/logo-3d.png](design/logo-3d.png). App icons are its frame, cut out along the rounded glass rim with transparent corners: the web app and Android icons, the favicon and the header logo; icons that launchers crop to a circle (the maskable web icon and Android's round and adaptive icons) keep the whole frame inside the visible circle, on the image's dark background (#050C14). Android's splash screen shows the whole image, wordmark included, its edges faded into that background. At 16 px (a browser tab) the detailed render reads only as the orange frame.

## Development

Requirements: Node.js 24 or newer.

```bash
npm install            # install dependencies
npm run dev      # start the dev server at http://localhost:5173
npm run build    # type-check and build to dist/
npm run preview  # serve the production build locally
```

To work on the Android app locally you also need Android Studio (JDK 21 and the Android SDK):

```bash
npm run android:sync   # build the web app and copy it into android/
npx cap open android   # open the project in Android Studio
```

## Releases and deployment

| Workflow | Trigger | Result |
|---|---|---|
| [deploy.yml](.github/workflows/deploy.yml) | Push to `main` | Web version published to GitHub Pages |
| [android.yml](.github/workflows/android.yml) | Push a tag such as `v0.2.0` | Signed APK attached to a new GitHub Release |
| [android.yml](.github/workflows/android.yml) | Run manually | APK uploaded as a workflow artifact |

Publish a new Android version:

```bash
git tag v0.2.0
git push origin v0.2.0
```

### Android release signing

Every release must be signed with the same key, or users cannot update in place. The workflow reads the key from three repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The PKCS#12 keystore (`.p12`), base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore |

Keep the keystore and its password backed up outside the repository. Never commit them.

## Roadmap

- [x] **Phase 1**: project setup and automatic deployment
- [x] **Phase 2**: on-device AI chat with a model picker, Android app
- [x] **Phase 3a**: saved conversations and Markdown-formatted replies
- [x] **Smart model**: Qwen3 1.7B (3B models do not fit in WebAssembly memory)
- [x] **Ask your documents**: PDF / TXT / Markdown, answered on the device with cited passages
- [x] **Chat tools**: copy, share and regenerate replies; reply language, length and style settings
- [x] **AI Map 1**: online world map with country → province → regency → district selection, GPS, and offline downloads
- [x] **AI Map 2**: search places (online and offline) and ask the AI about them ("nearest hospital?")
- [x] **AI Map 3**: offline directions drawn on the map and explained by the AI
- [x] **Read photos**: ask about a photo with the Vision model (InternVL3 1B)
- [x] **Voice**: speak messages and have replies read aloud
- [x] **Phase 3b**: installable offline web app (PWA) and multi-threading on GitHub Pages
- [ ] **Phase 4**: custom domain and design polish
- [ ] **Phase 5**: ask your documents, task templates, voice input
