// Service worker for the web version (the Android app does not register it).
// - Precaches the app, including the AI engine's WebAssembly, so the site opens offline.
// - Adds cross-origin isolation headers to same-origin responses. GitHub Pages cannot send them,
//   and without them the AI engine runs on a single CPU thread.
// Models (Hugging Face), map tiles and other cross-origin requests pass through untouched.
import { cleanupOutdatedCaches, matchPrecache, precache } from 'workbox-precaching'

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

precache(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** Copies a response with the isolation headers added. */
function isolated(response) {
  if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.status === 0) return response
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function respond(request) {
  const isPage = request.mode === 'navigate'
  const cached = await matchPrecache(isPage ? 'index.html' : request.url)
  if (cached) return isolated(cached)
  try {
    return isolated(await fetch(request))
  } catch (err) {
    // Offline and not precached: pages still get the app shell.
    const shell = isPage ? await matchPrecache('index.html') : undefined
    if (shell) return isolated(shell)
    throw err
  }
}

// Web Share Target (the manifest's share_target): keep what was shared for the app, which reads
// it from this cache when it opens with ?shared=1 (src/shareTarget.ts).
const SHARE_CACHE = 'pocket-ai-shared'

async function receiveShare(request) {
  const form = await request.formData()
  const cache = await caches.open(SHARE_CACHE)
  const text = ['title', 'text', 'url'].map((name) => form.get(name)).filter((value) => typeof value === 'string' && value)
  if (text.length) await cache.put('text', new Response(text.join('\n')))
  const file = form.get('file')
  if (file instanceof File && file.size) {
    await cache.put('file', new Response(file, { headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } }))
  }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) return event.respondWith(receiveShare(request))
  if (request.method !== 'GET') return
  event.respondWith(respond(request))
})
