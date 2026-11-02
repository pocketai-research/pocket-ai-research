// Small wrappers around localStorage. Storage can be unavailable (private mode, blocked
// site data); everything kept here is a convenience, so failures are ignored.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Optional storage.
  }
}

const LAST_MODEL_KEY = 'pocket-ai:last-model'
const SETTINGS_KEY = 'pocket-ai:engine'
const BUSY_KEY = 'pocket-ai:busy'

export const readLastModel = () => read(LAST_MODEL_KEY)
export const saveLastModel = (id: string) => write(LAST_MODEL_KEY, id)

export interface EngineSettings {
  /** Offload the model to the GPU through WebGPU. Experimental: some mobile drivers crash. */
  gpu: boolean
  /** Use a single CPU thread. Slower, but avoids multi-threading issues on some devices. */
  singleThread: boolean
}

const DEFAULT_SETTINGS: EngineSettings = { gpu: false, singleThread: false }

export function readEngineSettings(): EngineSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(read(SETTINGS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveEngineSettings = (settings: EngineSettings) => write(SETTINGS_KEY, JSON.stringify(settings))

/**
 * Written synchronously before the model loads or replies and cleared afterwards. If it is
 * still present on the next launch, the app died mid-way (usually out of memory).
 */
export interface BusyMarker {
  modelId: string
  phase: 'loading' | 'replying'
  settings: EngineSettings
}

export const markBusy = (marker: BusyMarker) => write(BUSY_KEY, JSON.stringify(marker))
export const clearBusy = () => write(BUSY_KEY, null)

export function takeBusyMarker(): BusyMarker | null {
  const raw = read(BUSY_KEY)
  clearBusy()
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
