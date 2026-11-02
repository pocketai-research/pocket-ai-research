# Pocket AI Research: Concept

> An English-language AI assistant that runs **directly in the browser**. Download the model once, then use it **without an internet connection**. It is free, and conversations are never sent to any server.

## 1. What we are building

A chat web app, like a small ChatGPT, where the AI runs on the user's own device instead of on a server.

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
1. **GitHub repository**: holds all of the website's code.
2. **GitHub Actions + GitHub Pages**: every push builds the site and publishes it for free. A custom domain points to it.
3. **Web app**: small (about 1 to 3 MB). **No backend server, no database, no login.**
4. **In-browser AI engine**, chosen automatically for each device:
   - **WebLLM** runs the model on the GPU through WebGPU, which is faster.
   - **wllama** (llama.cpp compiled to WebAssembly) runs the model on the CPU when WebGPU is not available.
5. **Model files**: downloaded from Hugging Face (a host for open-source AI models) on first use, then stored in the browser. They are not stored on GitHub because GitHub limits files to 100 MB.
6. **Service worker**: caches the app's files so the site opens without internet.
7. **IndexedDB**: a small database inside the browser for conversations and settings.

### Flow
```
 DEVELOPER
 VS Code ──git push──▶ GitHub repo ──▶ GitHub Actions (build) ──▶ GitHub Pages
                                                                      ▲
                                                     custom domain ───┘ (DNS)

 USER, first visit (internet needed)
 Browser ──open site──▶ download the app (~2 MB) ──▶ cached by the service worker
         ──pick model──▶ download the model from Hugging Face (0.5–2 GB) ──▶ stored in the browser

 USER, later visits (no internet needed)
 Type a message ──▶ AI engine in the browser (GPU/CPU) ──▶ reply streams in
                                    └──▶ conversation saved in IndexedDB (on the device)
```

### Model tiers (candidates, final choice after testing)
| Tier | Download size | Candidates | Suited to |
|---|---|---|---|
| Light | ~0.5 GB | Qwen 0.5B | Phones, laptops with 4 GB RAM |
| Balanced | ~1 GB | Small Qwen, Gemma or Llama models (1–1.5B) | Laptops with 8 GB RAM |
| Smart | ~2 GB | 3B models | Laptops with 8 GB+ RAM and a GPU |

Models will be chosen by testing English quality and speed on real devices.

### Tech stack
- **Vite + React + TypeScript**: website framework
- **@mlc-ai/web-llm** and **@wllama/wllama**: AI engines
- **vite-plugin-pwa**: offline mode and installability
- **Dexie (IndexedDB)**: local storage
- **GitHub Actions + GitHub Pages**: automatic deployment

## 3. How to use it

### For users
1. Open the site in **Chrome or Edge** (recommended), ideally on Wi-Fi.
2. Pick a model, click **Download**, and wait until it reaches 100%. This happens only once.
3. When the **"Ready offline"** badge appears, start chatting.
4. (Recommended) Install the app: on a laptop, click the install icon in the address bar; on Android, open the ⋮ menu and choose *Add to Home screen*.
5. From then on, open it from the app icon any time, with or without internet.
6. In Settings you can switch models, clear history, or delete a model to free up space.

**Device requirements:** at least 4 GB RAM (8 GB recommended), about 2 to 3 GB of free space, and an up-to-date browser.

### For developers
1. Edit the code in VS Code.
2. Run `npm run dev` and open `http://localhost:5173`.
3. `git push` to GitHub. The site deploys automatically in about 1 to 2 minutes.
4. Connect a custom domain (once): buy a domain, point its DNS to GitHub Pages, and enter it under *Settings → Pages*. HTTPS turns on automatically.

## 4. Known limitations
- Small models are **less capable than ChatGPT**. They can get facts wrong, struggle with complex problems, and do not know recent news.
- The first download is large (0.5 to 2 GB).
- Speed depends on the user's device. Older phones may not cope.
- Models and conversations are lost if the user clears the browser's site data.
- The first download depends on Hugging Face hosting the model files.

## 5. Costs (estimates)
- GitHub, GitHub Pages and Hugging Face: **free**.
- Domain: around Rp15,000–30,000 per year for `.my.id`, or Rp150,000–200,000 per year for `.com`.

## 6. Phases
1. **Phase 1**: GitHub repository, website skeleton, and automatic deployment to `sanadaryuki10-lgtm.github.io/pocket-ai-research`.
2. **Phase 2**: AI engine, streamed chat replies, model picker, testing on real devices.
3. **Phase 3**: offline mode (PWA) and saved conversations.
4. **Phase 4**: custom domain, design polish, mobile testing.
5. **Phase 5 (optional)**: ask your documents, task templates, voice input.
