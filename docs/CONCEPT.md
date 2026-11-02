# Pocket AI Research: Concept

> An English-language AI assistant that runs **on the user's own device**, as an Android app or in the browser. Download the model once, then use it **without an internet connection**. It is free, and conversations are never sent to any server.

## 1. What we are building

A chat app, like a small ChatGPT, where the AI runs on the user's own device instead of on a server. It ships two ways from one codebase: an **Android app** (APK downloaded from GitHub Releases) and a **web version** on GitHub Pages.

| | ChatGPT and similar | Pocket AI Research |
|---|---|---|
| Where the AI runs | The provider's servers | The user's own device |
| Internet needed | Always | Only for the first download |
| Privacy | Messages are sent to a server | Messages stay on the device |
| Cost | Subscription or API fees | Free (only the domain costs money) |
| Capability | Very high | Moderate (small models) |

### Version 1 features
- Chat with the AI in English, with replies streamed word by word.
- Model choice: **Light** (fast), **Balanced**, and **Smart** (slower).
- Conversation history saved on the device: start a new chat, reopen old ones, delete them.
- Installable as an app (PWA) on laptops and phones, and usable in airplane mode.
- Status indicators: model download progress, a "Ready offline" badge, and reply speed.

### Later features (optional)
- Ask your documents: upload a PDF or TXT file and get answers based on its content, all processed on the device.
- Task templates: summarize, translate, improve writing, help with code.
- Export conversations to a file.
- Voice input.

## 2. System design

### Components
1. **GitHub repository**: holds all of the code.
2. **GitHub Actions**: every push to `main` publishes the web version to GitHub Pages. Every version tag (for example `v0.2.0`) builds a signed Android APK and attaches it to a GitHub Release.
3. **Web app**: about 10 MB including the AI engine. **No backend server, no database, no login.**
4. **Android app**: Capacitor wraps the same web app in an Android WebView, so the app's files are inside the APK and it opens without internet.
5. **AI engine: wllama** (llama.cpp compiled to WebAssembly). It uses the GPU through WebGPU when available, otherwise the CPU. With cross-origin isolation it uses several CPU threads, which roughly doubles speed.
6. **Model files**: downloaded from Hugging Face (a host for open-source AI models) on first use, then stored on the device (Origin Private File System). They are not stored on GitHub because GitHub limits files to 100 MB.
7. **IndexedDB**: saved conversations, kept on the device. Assistant replies are rendered as Markdown (raw HTML is never rendered).
8. **Planned (Phase 3)**: a service worker so the web version also opens offline.

### Flow
```
 DEVELOPER
 VS Code ──git push──▶ GitHub repo ──▶ GitHub Actions ──▶ GitHub Pages (web version)
                           │
                           └──git tag v*──▶ GitHub Actions ──▶ GitHub Release (signed APK)

 USER, first run (internet needed)
 Install the APK (or open the website)
   ──pick model──▶ download the model from Hugging Face (0.5–1.1 GB) ──▶ stored on the device

 USER, later (no internet needed)
 Type a message ──▶ wllama on the device (GPU or CPU) ──▶ reply streams in
```

### Model tiers
| Tier | Download size | Model | Suited to |
|---|---|---|---|
| Light | 491 MB | Qwen2.5 0.5B Instruct (Q4_K_M) | Phones, laptops with 4 GB RAM |
| Balanced | 1.1 GB | Qwen2.5 1.5B Instruct (Q4_K_M) | Laptops with 8 GB RAM, newer phones |

A third, larger tier can be added after testing on real phones. wllama cannot load a single file above 2 GB, so larger models would need to be split.

Measured on a Ryzen 3 4300U laptop (CPU only), Light model: about 5 tokens per second with 2 threads, about 3 with 1 thread.

### Tech stack
- **Vite + React + TypeScript**: app framework
- **Capacitor**: Android packaging
- **@wllama/wllama**: AI engine
- **GitHub Actions, GitHub Pages and GitHub Releases**: build, hosting and APK downloads
- **idb** (IndexedDB) and **react-markdown**: saved conversations and formatted replies
- Planned: **vite-plugin-pwa** (offline web app)

## 3. How to use it

### For Android users
1. Open the repository's **Releases** page on the phone and download the latest `PocketAI-<version>.apk`.
2. Open the file and allow installing apps from this source if Android asks, then tap **Install**.
3. Open **Pocket AI**, pick a model, tap **Download**, and wait until it reaches 100% (Wi-Fi recommended). This happens only once.
4. When the model shows **"Ready offline"**, the chat opens. From then on it works with no internet.
5. Use **Models** to switch or delete models and **New chat** to start over. The app reopens the last model automatically.

### For web users
1. Open the site in **Chrome or Edge**, pick a model and download it once.
2. The model stays in the browser, so later visits skip the download.

**Device requirements:** at least 4 GB RAM (8 GB recommended), 0.5 to 1.1 GB of free space per model, and Android 7.0+ or an up-to-date browser.

### For developers
1. Edit the code in VS Code.
2. Run `npm run dev` and open `http://localhost:5173`.
3. `git push` to GitHub. The web version deploys automatically in about 1 to 2 minutes.
4. To release a new Android version, push a tag: `git tag v0.2.1 && git push origin v0.2.1`. The APK appears under Releases a few minutes later.
5. Connect a custom domain (once): buy a domain, point its DNS to GitHub Pages, and enter it under *Settings → Pages*. HTTPS turns on automatically.

## 4. Known limitations
- Small models are **less capable than ChatGPT**. They can get facts wrong, struggle with complex problems, and do not know recent news.
- The first download is large (0.5 to 1.1 GB).
- Speed depends on the user's device. Older phones may not cope.
- Models and saved chats are lost if the user clears the app's or browser's data.
- The APK is installed outside the Play Store, so Android shows an "unknown apps" warning.
- The first download depends on Hugging Face hosting the model files.

## 5. Costs (estimates)
- GitHub, GitHub Pages and Hugging Face: **free**.
- Domain: around Rp15,000–30,000 per year for `.my.id`, or Rp150,000–200,000 per year for `.com`.

## 6. Phases
1. **Phase 1**: GitHub repository, website skeleton, and automatic deployment to `sanadaryuki10-lgtm.github.io/pocket-ai-research`.
2. **Phase 2**: AI engine, streamed chat replies, model picker, Android app with APK downloads from GitHub Releases.
3. **Phase 3**: saved conversations and formatted replies (done), offline web app (PWA), multi-threading on GitHub Pages.
4. **Phase 4**: custom domain, design polish, mobile testing.
5. **Phase 5 (optional)**: ask your documents, task templates, voice input.
