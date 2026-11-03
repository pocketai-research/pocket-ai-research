# Pocket Ai Research

**Offline AI that runs on your device.**

An AI chat assistant that runs **entirely on your phone or computer**. Download a model once, then chat any time, even with no internet connection. Your conversations never leave your device.

- **Android app:** download the latest APK from [Releases](https://github.com/pocketai-research/pocket-ai-research/releases/latest)
- **Web version:** https://pocketai-research.github.io/pocket-ai-research/

## Install on Android

1. Open the [latest release](https://github.com/pocketai-research/pocket-ai-research/releases/latest) on your phone and download `PocketAiResearch-<version>.apk`.
2. Open the file. If Android asks, allow your browser or file manager to **install unknown apps**.
3. Tap **Install**, open **Pocket Ai Research**, choose a model and download it once (Wi-Fi recommended).
4. From then on the chat works offline, even in airplane mode.

To update, install the newer APK over the old one. Downloaded models are kept.

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
| Light | Qwen2.5 0.5B Instruct (Q4_K_M) | 491 MB | Phones, short questions |
| Balanced | Qwen2.5 1.5B Instruct (Q4_K_M) | 1.1 GB | Laptops and newer phones |
| Smart | Qwen3 1.7B (Q4_K_M, thinking mode off) | 1.1 GB | Best reasoning and Indonesian; a little slower |

Under **AI replies** you can choose the reply language (English, Indonesian, or the language of your message), the length and the style. Small models follow the language setting unreliably: Indonesian replies work best with the Balanced model. Each reply can be copied, shared, or regenerated.

Models must stay well under 2 GB: in WebAssembly the weights need one allocation, and a 3B model (about 2 GB, e.g. Llama 3.2 3B) downloads but cannot load. The Smart model therefore is Qwen3 1.7B with its thinking mode turned off. It uses a 3,072-token context to save memory; older messages are dropped from what a model sees when a chat gets longer than its context.

Models are downloaded from Hugging Face on first use and kept in the app's private storage (the browser's Origin Private File System).

## Ask your documents

Tap the paperclip in a chat to attach a PDF, TXT or Markdown file, then ask about it. Everything happens on the device:

- Text is extracted with [PDF.js](https://mozilla.github.io/pdf.js/) (loaded only when a PDF is opened) and split into passages of about 700 characters ([src/docs/extract.ts](src/docs/extract.ts)).
- For each question, the best-matching passages are found with BM25 keyword search, which ignores common English and Indonesian words ([src/docs/retrieve.ts](src/docs/retrieve.ts)). No second AI model is needed, which keeps memory use low on phones. When nothing matches (for example "summarise this"), the start of the document is used.
- The AI answers from those passages only and cites them like [1]; the sources (file and page) are listed under the reply.
- Documents are stored in IndexedDB, stay attached to their chat, and can be deleted under **Documents** on the start page. Scanned PDFs (pictures of pages) have no text and are not supported yet.

## Map

An online world map with GPS, where you can pick a country and then drill down through its own administrative levels (in Indonesia: province → regency / city → district (kecamatan) → village). Any selected region can be downloaded for offline use in the Android app.

- **Online map:** [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, "Liberty" style), drawn with [MapLibre GL JS](https://maplibre.org). Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- **Region lists:** countries are bundled ([src/map/countries.json](src/map/countries.json), generated once from OpenStreetMap). Levels below a country come from the [Overpass API](https://overpass-api.de) (with a mirror as fallback) and are cached on the device, so each list is slow only the first time. Level names per country are in [src/map/admin.ts](src/map/admin.ts).
- **Offline areas:** tiles for the region's box, plus the style, sprite and Latin glyphs, are stored in IndexedDB and served to MapLibre through an `offline://` protocol ([src/map/offlineMap.ts](src/map/offlineMap.ts)).

**Search and ask:** the Search tab finds places around your GPS position (or the map centre) in the map data itself: online from OpenFreeMap, offline from the saved area. Questions in English or Indonesian are matched to categories ("nearest hospital", "masjid terdekat", "SPBU", "apotek", ...) or to place names. Results are listed and numbered on the map with distance and direction, and when an AI model is open it writes a short answer using only those places, so it cannot invent locations ([src/map/places.ts](src/map/places.ts)).

Downloads follow [OpenFreeMap's terms](https://openfreemap.org/tos/) for in-app offline downloads: at most 3,000 tiles or 50 MB per download, at most 4 parallel requests, and a User-Agent that identifies the app. The detail level therefore depends on the area's size: a district or regency gets street-level detail, a large province or a country gets a coarser map. The Android app adds the identifying User-Agent ([capacitor.config.ts](capacitor.config.ts)); browsers cannot, so the web version offers the online map only.

## How it works

- One codebase: a Vite + React + TypeScript web app. [Capacitor](https://capacitorjs.com) wraps the same app as an Android APK.
- The model runs with [wllama](https://github.com/ngxson/wllama) (llama.cpp compiled to WebAssembly). It runs on the CPU by default; GPU acceleration through WebGPU is an experimental setting. If the app dies while a model loads or replies (usually out of memory), the next launch explains what happened and steps the settings down (GPU off, then one CPU thread).
- Cross-origin isolation headers let wllama use several CPU threads, which roughly doubles speed. The Android app adds them in [MainActivity.java](android/app/src/main/java/com/pocketairesearch/app/MainActivity.java) and the local dev server in [vite.config.ts](vite.config.ts). GitHub Pages cannot set custom headers, so the hosted web version currently runs on one thread (Phase 3 adds a service worker to fix this).
- There is no backend server or login. Chats are saved on the device in IndexedDB, and replies are rendered as Markdown without ever rendering raw HTML.

See [docs/CONCEPT.md](docs/CONCEPT.md) for the full concept and usage guide.

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
- [ ] **AI Map 3**: offline directions drawn on the map and explained by the AI
- [ ] **Phase 3b**: installable offline web app (PWA) and multi-threading on GitHub Pages
- [ ] **Phase 4**: custom domain and design polish
- [ ] **Phase 5**: ask your documents, task templates, voice input
