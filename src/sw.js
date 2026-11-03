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

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(respond(request))
})
