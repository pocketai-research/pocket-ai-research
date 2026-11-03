import { Capacitor } from '@capacitor/core'

// The Android app is installed from GitHub Releases and never updates itself, so it asks GitHub
// for the latest release now and then. The web version updates through its service worker.
const LATEST_RELEASE_API = 'https://api.github.com/repos/pocketai-research/pocket-ai-research/releases/latest'
const CHECK_KEY = 'pocket-ai:update-check'
const DISMISSED_KEY = 'pocket-ai:update-dismissed'
// GitHub allows 60 unauthenticated API requests an hour per address; twice a day is plenty.
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000

export interface AppUpdate {
  version: string
  /** The release page, where the APK is downloaded. */
  url: string
}

interface CheckResult {
  checkedAt: number
  latest: AppUpdate | null
}

/** True when version a (e.g. "0.13.0") is newer than b. */
function isNewer(a: string, b: string) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff > 0
  }
  return false
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage the app checks on every launch, which is still fine.
  }
}

/** A newer release of the Android app that the user has not dismissed, or null. */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!Capacitor.isNativePlatform()) return null
  let result = readJson<CheckResult>(CHECK_KEY)
  if ((!result || Date.now() - result.checkedAt > CHECK_EVERY_MS) && navigator.onLine) {
    try {
      const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.ok) {
        const release: { tag_name: string; html_url: string } = await res.json()
        result = { checkedAt: Date.now(), latest: { version: release.tag_name.replace(/^v/, ''), url: release.html_url } }
        write(CHECK_KEY, JSON.stringify(result))
      }
    } catch {
      // Offline or GitHub unreachable: try again on a later launch.
    }
  }
  const latest = result?.latest
  if (!latest || !isNewer(latest.version, __APP_VERSION__)) return null
  return readJson<string>(DISMISSED_KEY) === latest.version ? null : latest
}

/** Hides the notice until a newer release than this one appears. */
export const dismissUpdate = (update: AppUpdate) => write(DISMISSED_KEY, JSON.stringify(update.version))
