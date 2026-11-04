import type { ModelOption } from './ai/models'
import type { EngineSettings } from './settings'

export type CheckStatus = 'ok' | 'warn' | 'unknown'

export interface DeviceCheck {
  id: string
  label: string
  value: string
  status: CheckStatus
  note: string
}

// WebGPU and deviceMemory are not in every TypeScript DOM lib yet.
type NavigatorExtras = Navigator & {
  gpu?: { requestAdapter(): Promise<unknown> }
  deviceMemory?: number
}

const nav = navigator as NavigatorExtras
const GB = 1024 ** 3

export async function hasWebGPU(): Promise<boolean> {
  try {
    return nav.gpu ? (await nav.gpu.requestAdapter()) !== null : false
  } catch {
    return false
  }
}

async function checkGpu(): Promise<DeviceCheck> {
  const base = { id: 'gpu', label: 'GPU acceleration' }
  return (await hasWebGPU())
    ? { ...base, value: 'WebGPU available', status: 'ok', note: 'Can be turned on under Performance. It is experimental and off by default.' }
    : { ...base, value: 'Not available', status: 'unknown', note: 'The AI runs on the CPU, which works on every device.' }
}

function checkThreads(): DeviceCheck {
  const base = { id: 'threads', label: 'Multi-threading' }
  const cores = navigator.hardwareConcurrency || 1
  return crossOriginIsolated
    ? { ...base, value: `On, ${cores} cores`, status: 'ok', note: 'The AI can use several CPU cores.' }
    : { ...base, value: 'Off', status: 'warn', note: 'The AI uses one CPU core, so replies are slower.' }
}

function checkEngine(): DeviceCheck {
  const base = { id: 'engine', label: 'Browser engine' }
  const version = Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0)
  if (!version) return { ...base, value: 'Not Chromium', status: 'unknown', note: 'Chrome, Edge and Android work best.' }
  const name = /; wv\)/.test(navigator.userAgent) ? 'Android WebView' : 'Chromium'
  return version >= 120
    ? { ...base, value: `${name} ${version}`, status: 'ok', note: 'Recent enough to run the AI.' }
    : { ...base, value: `${name} ${version}`, status: 'warn', note: 'Update Chrome or "Android System WebView" from the Play Store.' }
}

function checkMemory(): DeviceCheck {
  const base = { id: 'memory', label: 'Memory (RAM)' }
  const gb = nav.deviceMemory
  if (gb === undefined) {
    return { ...base, value: 'Unknown', status: 'unknown', note: 'This browser does not report memory. 4 GB or more is recommended.' }
  }
  return gb >= 4
    ? { ...base, value: `At least ${gb} GB`, status: 'ok', note: 'Enough to run the small and medium models.' }
    : { ...base, value: `About ${gb} GB`, status: 'warn', note: 'Only the smallest model is likely to run smoothly.' }
}

async function checkStorage(): Promise<DeviceCheck> {
  const base = { id: 'storage', label: 'Storage for models' }
  if (!navigator.storage?.estimate) {
    return { ...base, value: 'Unknown', status: 'unknown', note: 'Models need 0.5 to 2 GB of free space.' }
  }

  const { quota = 0, usage = 0 } = await navigator.storage.estimate()
  const free = (quota - usage) / GB
  return free >= 3
    ? { ...base, value: `${free.toFixed(1)} GB available`, status: 'ok', note: 'Enough room to keep a model on this device.' }
    : { ...base, value: `${free.toFixed(1)} GB available`, status: 'warn', note: 'Models need 0.5 to 2 GB. Free up space for the larger ones.' }
}

export function checkNetwork(online: boolean): DeviceCheck {
  const base = { id: 'network', label: 'Internet connection', status: 'ok' as const }
  return online
    ? { ...base, value: 'Online', note: 'Needed only once, to download a model.' }
    : { ...base, value: 'Offline', note: 'Connect once to download a model. After that, no internet is needed.' }
}

export async function runDeviceChecks(): Promise<DeviceCheck[]> {
  const [gpu, storage] = await Promise.all([checkGpu(), checkStorage()])
  return [checkMemory(), storage, checkThreads(), gpu, checkEngine()]
}

// ---- Speed test and model recommendation

const SPEED_KEY = 'pocket-ai:speed-v2'
const SPEED_TTL_MS = 30 * 24 * 60 * 60 * 1000
/**
 * The speed test's single-thread score (MFLOPS) on the reference laptop, a 4-core PC where each
 * model's referenceSpeed was measured with 2 threads (1,330 to 1,480 over six fresh starts).
 */
const REFERENCE = { score: 1430, threads: 2 }

/**
 * A short CPU test: multiplying small float matrices, in MFLOPS on one thread. It tracks how fast the
 * AI engine's own matrix maths runs, closely enough for a rough estimate. A long warm-up and the
 * middle of three timings keep it steady (a single short timing varied by 40%).
 */
function runSpeedTest() {
  const n = 96
  const a = Float32Array.from({ length: n * n }, () => Math.random())
  const b = Float32Array.from({ length: n * n }, () => Math.random())
  const c = new Float32Array(n * n)
  const round = () => {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) {
        const aik = a[i * n + k]
        for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j]
      }
    }
  }
  // Warm up first, so the JavaScript compiler has optimised the loop.
  for (const start = performance.now(); performance.now() - start < 300; ) round()
  const timings: number[] = []
  for (let run = 0; run < 3; run++) {
    let rounds = 0
    const start = performance.now()
    while (performance.now() - start < 150) {
      round()
      rounds++
    }
    timings.push((rounds * 2 * n * n * n) / ((performance.now() - start) / 1000) / 1e6)
  }
  return timings.sort((a, b) => a - b)[1]
}

/** The single-thread score, measured once and remembered for a month. */
export function speedScore(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(SPEED_KEY) ?? 'null')
    if (saved && Date.now() - saved.at < SPEED_TTL_MS) return saved.score
  } catch {
    // Measure again below.
  }
  const score = runSpeedTest()
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify({ score, at: Date.now() }))
  } catch {
    // Without storage the test runs on each visit, which is fine.
  }
  return score
}

/** CPU threads the AI engine uses: wllama takes half the cores when the page is cross-origin isolated. */
export function engineThreads(settings: EngineSettings) {
  if (settings.singleThread || !crossOriginIsolated) return 1
  return Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))
}

/** Estimated tokens a second for the model on this device; threads help, though less than linearly. */
export function estimateSpeed(model: ModelOption, score: number, threads: number): number | null {
  if (!model.referenceSpeed) return null
  const power = (s: number, t: number) => s * t ** 0.85
  return (model.referenceSpeed * power(score, threads)) / power(REFERENCE.score, REFERENCE.threads)
}

/**
 * The model to suggest: Balanced (the best answers) when the device has the memory and runs it at a
 * readable pace, otherwise Light.
 */
export function recommendModel(models: ModelOption[], score: number, threads: number): ModelOption | undefined {
  const current = models.filter((m) => !m.replacedBy)
  const light = current.find((m) => m.tier === 'Light')
  const balanced = current.find((m) => m.tier === 'Balanced')
  const memory = nav.deviceMemory
  if (!balanced || (memory !== undefined && memory < 4)) return light
  return (estimateSpeed(balanced, score, threads) ?? 0) >= 4 ? balanced : light
}
