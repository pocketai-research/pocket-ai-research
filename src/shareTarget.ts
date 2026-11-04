import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Text, documents and photos shared to the app from other apps. In the Android app they come from
 * the share sheet through a small native plugin (android/.../SharedContentPlugin.java); in the
 * installed web app through the Web Share Target API, which the service worker (src/sw.js) turns
 * into a cache entry and a redirect to "?shared=1".
 */
export interface Shared {
  id: number
  text?: string
  file?: File
  /** The share could not be read, e.g. a file over 25 MB. */
  error?: string
}

interface NativeShare {
  text?: string
  subject?: string
  file?: { name: string; mimeType: string; data: string }
  error?: string
}

interface SharedContentPlugin {
  take(): Promise<NativeShare>
  addListener(event: 'shared', handler: () => void): Promise<{ remove: () => Promise<void> }>
}

const SharedContent = registerPlugin<SharedContentPlugin>('SharedContent')

export const SHARE_CACHE = 'pocket-ai-shared'

/** Joins a page title and its link (what a browser shares) or keeps plain text as it is. */
function sharedText(subject?: string | null, text?: string | null) {
  const parts = [subject, text].map((part) => part?.trim()).filter(Boolean) as string[]
  if (parts.length === 2 && parts[1].includes(parts[0])) return parts[1]
  return parts.join('\n') || undefined
}

async function takeNative(): Promise<Shared | null> {
  const shared = await SharedContent.take()
  const file =
    shared.file &&
    new File([await (await fetch(`data:${shared.file.mimeType};base64,${shared.file.data}`)).blob()], shared.file.name, {
      type: shared.file.mimeType,
    })
  const text = sharedText(shared.subject, shared.text)
  if (!text && !file && !shared.error) return null
  return { id: Date.now(), text, file, error: shared.error }
}

async function takeWeb(): Promise<Shared | null> {
  const url = new URL(location.href)
  if (!url.searchParams.has('shared')) return null
  url.searchParams.delete('shared')
  history.replaceState(null, '', url)
  const cache = await caches.open(SHARE_CACHE)
  const textResponse = await cache.match('text')
  const fileResponse = await cache.match('file')
  const text = textResponse ? sharedText(null, await textResponse.text()) : undefined
  const file =
    fileResponse &&
    new File([await fileResponse.blob()], decodeURIComponent(fileResponse.headers.get('X-File-Name') ?? 'Shared file'), {
      type: fileResponse.headers.get('Content-Type') ?? '',
    })
  await caches.delete(SHARE_CACHE)
  if (!text && !file) return null
  return { id: Date.now(), text, file }
}

/** Calls back with the share that opened the app, then with each later one. Returns a stop function. */
export function onShared(callback: (shared: Shared) => void): () => void {
  if (!Capacitor.isNativePlatform()) {
    if ('caches' in window) takeWeb().then((shared) => shared && callback(shared), () => {})
    return () => {}
  }
  const take = () => takeNative().then((shared) => shared && callback(shared), () => {})
  take()
  const listener = SharedContent.addListener('shared', take)
  return () => {
    listener.then((l) => l.remove())
  }
}
