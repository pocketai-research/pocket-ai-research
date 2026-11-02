# Pocket AI Research

**Offline AI that runs in your browser.**

An AI assistant that runs **entirely on your device**. Download a model once, then chat any time, even with no internet connection. Your conversations never leave your device.

**Live site:** https://sanadaryuki10-lgtm.github.io/pocket-ai-research/

> Status: **Phase 1 (preview)**. The site and automatic deployment are live. The chat arrives in Phase 2. See the [roadmap](#roadmap).

## Why on-device?

| | Cloud AI (ChatGPT and similar) | Pocket AI Research |
|---|---|---|
| Where the AI runs | The provider's servers | Your own device |
| Internet needed | Always | Only for the first model download |
| Privacy | Messages are sent to a server | Messages stay on your device |
| Cost | Subscription or API fees | Free |
| Capability | Very high | Moderate (small models) |

## How it works

- A static web app (Vite + React + TypeScript) hosted on GitHub Pages. There is no backend, database or login.
- The AI model is downloaded from Hugging Face on first use and stored in the browser.
- The model runs in the browser with **WebLLM** (GPU, via WebGPU) or **wllama** (CPU, via WebAssembly) as a fallback.
- A service worker caches the app so it opens offline, and conversations are saved in IndexedDB on the device.

See [docs/CONCEPT.md](docs/CONCEPT.md) for the full concept, system design and usage guide.

## Development

Requirements: Node.js 24 or newer.

```bash
npm install      # install dependencies
npm run dev      # start the dev server at http://localhost:5173
npm run build    # type-check and build to dist/
npm run preview  # serve the production build locally
```

## Deployment

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which builds the site and publishes it to GitHub Pages. It goes live in about 1 to 2 minutes.

The build uses relative paths (`base: './'` in [vite.config.ts](vite.config.ts)), so the same output works on `github.io/pocket-ai-research/` and on a custom domain.

## Roadmap

- [x] **Phase 1**: project setup and automatic deployment
- [ ] **Phase 2**: on-device AI chat with a model picker
- [ ] **Phase 3**: offline mode (PWA) and saved conversations
- [ ] **Phase 4**: custom domain and mobile polish
- [ ] **Phase 5**: ask your documents, task templates, voice input
