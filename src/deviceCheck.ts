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
