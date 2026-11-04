import { ModelManager } from '@wllama/wllama/esm/index.js'
import type { ModelOption } from './models'

/**
 * Models people add themselves: a GGUF file from the device, or a link to one (usually on Hugging
 * Face). A file is copied into the same cache as downloaded models, under an address on the
 * reserved .invalid domain: the engine then opens it like any downloaded model and never tries to
 * fetch it. A link is downloaded the first time it is opened, like the built-in models.
 */

const KEY = 'pocket-ai:custom-models'
const FILE_HOST = 'https://imported.invalid/'
/** In WebAssembly the weights need one allocation; above about 2 GB that fails (see models.ts). */
export const MAX_MODEL_BYTES = 1.5e9
// Imported models get a modest context: their memory use is unknown, and phones have little.
const CONTEXT_SIZE = 2048
// The metadata that matters is at the start of the file, before the large vocabulary lists.
const HEADER_BYTES = 4 * 1024 * 1024

export function readCustomModels(): ModelOption[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((m) => m?.id && m?.url) : []
  } catch {
    return []
  }
}

function writeCustomModels(list: ModelOption[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function forgetCustomModel(id: string) {
  writeCustomModels(readCustomModels().filter((m) => m.id !== id))
}

export const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

interface GgufInfo {
  architecture?: string
  /** 'model', 'mmproj' or 'adapter' in newer files. */
  type?: string
  contextLength?: number
}

/** Reads the key/value metadata at the start of a GGUF file, as far as the bytes given reach. */
export function readGgufInfo(buffer: ArrayBuffer): GgufInfo {
  const view = new DataView(buffer)
  if (buffer.byteLength < 24 || view.getUint32(0, true) !== 0x46554747) {
    throw new Error('This is not a GGUF model file.')
  }
  const version = view.getUint32(4, true)
  if (version < 2) throw new Error('This GGUF file is too old for the app. Look for a newer conversion of the model.')
  let at = 8
  const u32 = () => ((at += 4), view.getUint32(at - 4, true))
  const u64 = () => ((at += 8), Number(view.getBigUint64(at - 8, true)))
  const text = () => {
    const length = u64()
    if (at + length > buffer.byteLength) throw new RangeError('past the end')
    const value = new TextDecoder().decode(new Uint8Array(buffer, at, length))
    at += length
    return value
  }
  // Sizes of the fixed-size value types, by type number (8 string and 9 array are read apart).
  const sizes: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
  const value = (type: number): unknown => {
    switch (type) {
      case 4:
        return u32()
      case 5:
        return ((at += 4), view.getInt32(at - 4, true))
      case 10:
        return u64()
      case 8:
        return text()
      case 9: {
        const itemType = u32()
        const count = u64()
        if (itemType === 8) for (let i = 0; i < count; i++) text()
        else at += count * (sizes[itemType] ?? 0)
        return undefined
      }
      default:
        if (!(type in sizes)) throw new Error('This GGUF file could not be read.')
        at += sizes[type]
        return undefined
    }
  }

  const info: GgufInfo = {}
  try {
    u64() // tensor count
    const pairs = u64()
    for (let i = 0; i < pairs; i++) {
      const key = text()
      const found = value(u32())
      if (at > buffer.byteLength) break
      if (key === 'general.architecture' && typeof found === 'string') info.architecture = found
      else if (key === 'general.type' && typeof found === 'string') info.type = found
      else if (info.architecture && key === `${info.architecture}.context_length` && typeof found === 'number') {
        info.contextLength = found
      }
    }
  } catch (err) {
    // The bytes ran out (the rest of the file was not read): keep what was found so far.
    if (!(err instanceof RangeError)) throw err
  }
  return info
}

function checkInfo(info: GgufInfo) {
  if (info.type === 'mmproj' || info.architecture === 'clip') {
    throw new Error(
      'This is the image part (mmproj) of a vision model, not a model to chat with. Vision models cannot be added yet; use the Vision model in the list.',
    )
  }
  if (info.type === 'adapter') throw new Error('This is an adapter (LoRA), not a whole model.')
}

function toModel(id: string, url: string, fileName: string, bytes: number, info: GgufInfo, custom: 'file' | 'link'): ModelOption {
  const architecture = info.architecture ?? 'unknown'
  return {
    id,
    // The file name, not general.name: uploads often leave a training-run name there.
    name: fileName.replace(/\.gguf$/i, ''),
    tier: 'Your model',
    size: formatBytes(bytes),
    description: `${custom === 'file' ? 'Added from a file' : 'Added from a link'} (${architecture} architecture).`,
    url,
    contextSize: Math.min(CONTEXT_SIZE, info.contextLength ?? CONTEXT_SIZE),
    // Qwen3 thinks before every answer unless told not to; its switch is the Think first button.
    canThink: /^qwen3/.test(architecture) || undefined,
    custom,
  }
}

function checkSize(bytes: number) {
  if (bytes > MAX_MODEL_BYTES) {
    throw new Error(
      `This model is ${formatBytes(bytes)}. Models up to ${formatBytes(MAX_MODEL_BYTES)} can run in the app; choose a smaller one or a smaller quantisation (for example Q4_K_M or Q3_K_M).`,
    )
  }
}

const newId = () => `custom-${crypto.randomUUID().slice(0, 8)}`

/** Copies a GGUF file from the device into the model cache, so it opens offline like the others. */
export async function addModelFile(file: File, onProgress: (fraction: number) => void): Promise<ModelOption> {
  checkSize(file.size)
  const info = readGgufInfo(await file.slice(0, HEADER_BYTES).arrayBuffer())
  checkInfo(info)
  const { quota, usage } = (await navigator.storage?.estimate?.().catch(() => null)) ?? {}
  if (quota !== undefined && usage !== undefined && quota - usage < file.size * 1.05) {
    throw new Error(`There is not enough free space for this model (${formatBytes(file.size)}). Delete a model you no longer use first.`)
  }
  await navigator.storage?.persist?.().catch(() => false)

  const id = newId()
  const fileName = file.name.toLowerCase().endsWith('.gguf') ? file.name : `${file.name}.gguf`
  const url = `${FILE_HOST}${id}/${fileName.replace(/[^\w.-]+/g, '_')}`
  const cache = new ModelManager({ allowOffline: true }).cacheManager
  const name = await cache.getNameFromURL(url)
  let copied = 0
  const counted = file.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        copied += chunk.byteLength
        onProgress(copied / file.size)
        controller.enqueue(chunk)
      },
    }),
  )
  try {
    await cache.write(name, counted, { etag: 'imported', originalSize: file.size, originalURL: url })
  } catch (err) {
    await cache.delete(name).catch(() => {})
    throw err
  }
  const model = toModel(id, url, file.name, file.size, info, 'file')
  writeCustomModels([...readCustomModels(), model])
  return model
}

/**
 * The direct download address for a GGUF link: a Hugging Face file page (…/blob/…) becomes its
 * download link (…/resolve/…).
 */
export function normaliseModelLink(link: string): string {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new Error('This is not a web address. Paste the link to a .gguf file, for example from Hugging Face.')
  }
  if (url.protocol !== 'https:') throw new Error('The link must start with https://.')
  if (/^(www\.)?(huggingface\.co|hf\.co)$/.test(url.hostname)) url.pathname = url.pathname.replace('/blob/', '/resolve/')
  url.search = ''
  url.hash = ''
  if (!url.pathname.toLowerCase().endsWith('.gguf')) {
    throw new Error('The link must point to one .gguf file (on Hugging Face: open the file and copy its address).')
  }
  if (/-\d{5}-of-\d{5}\.gguf$/i.test(url.pathname)) throw new Error('This model is split into several files, which is too large for the app.')
  return url.toString()
}

/** The first bytes of a remote file; stops reading there even when the server ignores the range. */
async function readStart(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } })
  if (!response.ok || !response.body) throw new Error(`The link could not be opened (error ${response.status}).`)
  const start = new Uint8Array(HEADER_BYTES)
  let filled = 0
  const reader = response.body.getReader()
  while (filled < HEADER_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    const piece = value.subarray(0, HEADER_BYTES - filled)
    start.set(piece, filled)
    filled += piece.byteLength
  }
  await reader.cancel().catch(() => {})
  return start.buffer.slice(0, filled)
}

/** Adds a model from a link after checking its size and reading its name; it downloads when opened. */
export async function addModelLink(link: string): Promise<ModelOption> {
  const url = normaliseModelLink(link)
  const existing = readCustomModels().find((m) => m.url === url)
  if (existing) throw new Error(`This model is already in the list as ${existing.name}.`)
  let head: Response
  try {
    head = await fetch(url, { method: 'HEAD' })
  } catch {
    throw new Error('The link could not be reached. Check your internet connection, and that the file can be downloaded without signing in.')
  }
  if (!head.ok) {
    throw new Error(
      head.status === 401 || head.status === 403
        ? 'This file needs signing in to download (a gated model), which the app cannot do. Choose another upload of the model.'
        : `The link could not be opened (error ${head.status}). Check that it points to a .gguf file.`,
    )
  }
  const bytes = Number(head.headers.get('content-length') ?? 0)
  checkSize(bytes)
  const info = readGgufInfo(await readStart(url))
  checkInfo(info)
  const model = toModel(newId(), url, decodeURIComponent(url.split('/').pop() ?? 'model.gguf'), bytes, info, 'link')
  writeCustomModels([...readCustomModels(), model])
  return model
}
