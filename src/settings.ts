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

export interface ReplySettings {
  language: 'english' | 'indonesian' | 'auto'
  length: 'short' | 'normal' | 'detailed'
  creativity: 'precise' | 'balanced' | 'creative'
  /** Read each reply aloud with the device's voice when it is finished. */
  readAloud: 'off' | 'on'
  /** Let models that can (Qwen3) think before answering: better at maths and logic, but slower. */
  think: boolean
  /** Find document passages by words only, or also by meaning (a 132 MB embedding model). */
  docSearch: 'words' | 'meaning'
  /** Add the facts the user saved (src/memory.ts) to every chat. */
  memory: 'on' | 'off'
}

const REPLY_KEY = 'pocket-ai:replies'
const DEFAULT_REPLY_SETTINGS: ReplySettings = {
  language: 'english',
  length: 'normal',
  creativity: 'balanced',
  readAloud: 'off',
  think: false,
  docSearch: 'words',
  memory: 'on',
}

export function readReplySettings(): ReplySettings {
  try {
    return { ...DEFAULT_REPLY_SETTINGS, ...JSON.parse(read(REPLY_KEY) ?? '{}') }
  } catch {
    return DEFAULT_REPLY_SETTINGS
  }
}

export const saveReplySettings = (settings: ReplySettings) => write(REPLY_KEY, JSON.stringify(settings))

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
/** True while a model is loading or replying. */
export const isBusy = () => read(BUSY_KEY) !== null

export function takeBusyMarker(): BusyMarker | null {
  const raw = read(BUSY_KEY)
  clearBusy()
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
