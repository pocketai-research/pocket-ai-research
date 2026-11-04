import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { saveTrip, type Trip, type TripPoint } from './offlineStore'

/**
 * Records a trip with the GPS. It lives outside the map's components, so recording goes on when the
 * panel's tab changes or the chat is opened; the screen is kept on, because Android's WebView stops
 * receiving positions when the screen turns off or the app goes to the background.
 */

export interface RecorderState {
  trip: Trip | null
  recording: boolean
  /** Accuracy of the last position in metres, to show how good the GPS signal is. */
  accuracy: number | null
  error: string | null
}

// Positions worse than this are noise; closer than MIN_STEP to the last point, jitter.
const MAX_ACCURACY = 50
const MIN_STEP = 5
// Altitude from GPS wobbles by several metres, so only rises beyond this count as climbing.
const CLIMB_STEP = 3
const SAVE_EVERY_MS = 30_000

let state: RecorderState = { trip: null, recording: false, accuracy: null, error: null }
const listeners = new Set<() => void>()
let watchId: number | null = null
let saveTimer: ReturnType<typeof setInterval> | null = null
let wakeLock: { release(): Promise<void> } | null = null
let climbBase: number | null = null

function set(next: Partial<RecorderState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const getRecorderState = () => state
export function subscribeRecorder(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Metres between two points (haversine). */
export function metresBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

function onPosition({ coords, timestamp }: GeolocationPosition) {
  const trip = state.trip
  if (!trip) return
  set({ accuracy: coords.accuracy, error: null })
  if (coords.accuracy > MAX_ACCURACY) return
  const point: TripPoint = { lon: coords.longitude, lat: coords.latitude, ele: coords.altitude, time: timestamp }
  const last = trip.points.at(-1)
  const step = last ? metresBetween(last, point) : 0
  if (last && step < MIN_STEP) return
  let climb = trip.climb
  if (point.ele !== null) {
    if (climbBase === null || point.ele < climbBase) climbBase = point.ele
    else if (point.ele - climbBase >= CLIMB_STEP) {
      climb += point.ele - climbBase
      climbBase = point.ele
    }
  }
  set({ trip: { ...trip, points: [...trip.points, point], distance: trip.distance + step, climb, endedAt: timestamp } })
}

function onError(error: GeolocationPositionError) {
  set({
    error:
      error.code === error.PERMISSION_DENIED
        ? 'Location access is off. Allow it for the app, then start again.'
        : 'Waiting for a GPS signal… Go outside or near a window.',
  })
}

async function keepScreenOn() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
}

// The wake lock ends whenever the page is hidden; take it again on return while recording.
document.addEventListener('visibilitychange', () => {
  if (state.recording && document.visibilityState === 'visible') keepScreenOn()
})

export function startRecording() {
  if (state.recording) return
  if (!('geolocation' in navigator)) return set({ error: 'This device has no location service.' })
  const now = Date.now()
  const name = `Trip ${new Date(now).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
  climbBase = null
  set({
    trip: { id: crypto.randomUUID(), name, startedAt: now, endedAt: now, points: [], distance: 0, climb: 0 },
    recording: true,
    accuracy: null,
    error: null,
  })
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30_000 })
  // Saved as it goes, so a crash or a closed app keeps what was recorded.
  saveTimer = setInterval(() => state.trip?.points.length && saveTrip(state.trip), SAVE_EVERY_MS)
  keepScreenOn()
}

/** Stops and saves the trip; resolves to it, or null when no position was recorded. */
export async function stopRecording(): Promise<Trip | null> {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  if (saveTimer) clearInterval(saveTimer)
  watchId = null
  saveTimer = null
  wakeLock?.release().catch(() => {})
  wakeLock = null
  const trip = state.trip
  set({ recording: false, trip: null, accuracy: null })
  if (!trip?.points.length) return null
  const done = { ...trip, endedAt: Date.now() }
  await saveTrip(done)
  return done
}

const xml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The trip as GPX 1.1, which map and fitness apps (Strava, Komoot, Google Earth) open. */
export function toGpx(trip: Trip) {
  const points = trip.points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
        `${p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<time>${new Date(p.time).toISOString()}</time></trkpt>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Pocket Ai Research" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(trip.name)}</name><time>${new Date(trip.startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${xml(trip.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`
}

/** Saves a GPX file: through the share sheet in the Android app, as a download on the web. */
export async function exportGpx(trip: Trip) {
  const fileName = `${trip.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'trip'}.gpx`
  const gpx = toGpx(trip)
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: gpx, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: trip.name, files: [uri] })
    return
  }
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }))
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
