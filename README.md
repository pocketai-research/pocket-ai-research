# Pocket Ai Research

**Offline AI that runs on your device.**

An AI chat assistant that runs **entirely on your phone or computer**. Download a model once, then chat any time, even with no internet connection. Your conversations never leave your device.

- **Android app:** download the latest APK from [Releases](https://github.com/sanadaryuki10-lgtm/pocket-ai-research/releases/latest)
- **Web version:** https://sanadaryuki10-lgtm.github.io/pocket-ai-research/

## Install on Android

1. Open the [latest release](https://github.com/sanadaryuki10-lgtm/pocket-ai-research/releases/latest) on your phone and download `PocketAiResearch-<version>.apk`.
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

Models are downloaded from Hugging Face on first use and kept in the app's private storage (the browser's Origin Private File System).

## How it works

- One codebase: a Vite + React + TypeScript web app. [Capacitor](https://capacitorjs.com) wraps the same app as an Android APK.
- The model runs with [wllama](https://github.com/ngxson/wllama) (llama.cpp compiled to WebAssembly). It uses the GPU through WebGPU when the device supports it, otherwise the CPU.
- Cross-origin isolation headers let wllama use several CPU threads, which roughly doubles speed. The Android app adds them in [MainActivity.java](android/app/src/main/java/com/pocketairesearch/app/MainActivity.java) and the local dev server in [vite.config.ts](vite.config.ts). GitHub Pages cannot set custom headers, so the hosted web version currently runs on one thread (Phase 3 adds a service worker to fix this).
- There is no backend server or login. Chats are saved on the device in IndexedDB, and replies are rendered as Markdown without ever rendering raw HTML.

See [docs/CONCEPT.md](docs/CONCEPT.md) for the full concept and usage guide.

## Development

Requirements: Node.js 24 or newer.

```bash
npm install      # install dependencies
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
- [ ] **Phase 3b**: installable offline web app (PWA) and multi-threading on GitHub Pages
- [ ] **Phase 4**: custom domain and design polish
- [ ] **Phase 5**: ask your documents, task templates, voice input
