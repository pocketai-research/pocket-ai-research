import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { isBusy } from './settings'

const RELOADED_KEY = 'pocket-ai:isolation-reload'
const UPDATE_RELOAD_KEY = 'pocket-ai:update-reload'

/**
 * Registers the service worker (src/sw.js) on the web; the Android app ships its files and sets
 * the headers itself. On the first visit the page loaded before the worker could add the
 * cross-origin isolation headers, so once it takes control the page reloads one time, unless a
 * model is loading or replying (the next visit is isolated anyway).
 */
export function registerServiceWorker() {
  if (Capacitor.isNativePlatform() || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (crossOriginIsolated || isBusy()) return
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return
      sessionStorage.setItem(RELOADED_KEY, '1')
    } catch {
      return
    }
    location.reload()
  })
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Without the worker the app still works online, on one CPU thread.
  })

  // After an update the new worker deletes the old version's files, so a page still running the
  // old version cannot load its lazily loaded parts (the map, the PDF reader). Reload into the new
  // version, unless a model is busy, and at most once a minute so a missing file cannot loop.
  window.addEventListener('vite:preloadError', (event) => {
    if (isBusy()) return
    try {
      if (Date.now() - Number(sessionStorage.getItem(UPDATE_RELOAD_KEY) ?? 0) < 60_000) return
      sessionStorage.setItem(UPDATE_RELOAD_KEY, String(Date.now()))
    } catch {
      return
    }
    event.preventDefault()
    location.reload()
  })
}

// Chromium's install prompt, not yet in TypeScript's DOM library.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEvent
  listeners.forEach((listener) => listener())
})

/** A function that shows the browser's install dialog, or null when the app cannot be installed. */
export function useInstallPrompt() {
  const [available, setAvailable] = useState(deferredPrompt !== null)
  useEffect(() => {
    const update = () => setAvailable(deferredPrompt !== null)
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  if (!available) return null
  return async () => {
    await deferredPrompt?.prompt()
    deferredPrompt = null
    listeners.forEach((listener) => listener())
  }
}
