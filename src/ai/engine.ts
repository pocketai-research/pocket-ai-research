// Import the prebuilt ESM bundle: the package's "main" points at TypeScript sources.
import {
  LoggerWithoutDebug,
  ModelManager,
  Wllama,
  WllamaAbortError,
  WllamaError,
  type ChatCompletionMessage,
} from '@wllama/wllama/esm/index.js'
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
import { hasWebGPU } from '../deviceCheck'
import { clearBusy, markBusy, type EngineSettings, type ReplySettings } from '../settings'
import type { ModelOption } from './models'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LoadedModel {
  model: ModelOption
  settings: EngineSettings
  backend: 'GPU' | 'CPU'
  threads: number
}

// Written in the target language: small models follow that far better than an English rule.
const LANGUAGE_RULES: Record<ReplySettings['language'], string> = {
  english: 'Reply in English.',
  indonesian: 'Jawab dalam Bahasa Indonesia.',
  auto: "Reply in the same language as the user's last message.",
}

const LENGTHS: Record<ReplySettings['length'], { rule: string; maxTokens: number }> = {
  short: { rule: 'Keep replies brief: a few sentences at most.', maxTokens: 256 },
  normal: { rule: 'Keep replies clear and to the point.', maxTokens: 768 },
  detailed: { rule: 'Give thorough, well-structured replies, with examples where they help.', maxTokens: 1536 },
}

const TEMPERATURES: Record<ReplySettings['creativity'], number> = { precise: 0.3, balanced: 0.7, creative: 1.0 }

const CONTEXT_SIZE = 4096
// Smaller than llama.cpp's defaults (2048/512) to trim compute buffers on phones.
const BATCH_SIZE = 256
// Only the most recent messages are sent so long chats stay inside the context window.
const MAX_HISTORY = 12

let wllama: Wllama | null = null
let loaded: LoadedModel | null = null
let pending: { key: string; promise: Promise<LoadedModel> } | null = null

function createWllama() {
  return new Wllama(
    { default: wasmUrl },
    { allowOffline: true, suppressNativeLog: true, logger: LoggerWithoutDebug },
  )
}

export async function listDownloadedUrls(): Promise<Set<string>> {
  try {
    const models = await new ModelManager({ allowOffline: true }).getModels()
    return new Set(models.map((m) => m.url))
  } catch {
    return new Set()
  }
}

export async function deleteModel(model: ModelOption) {
  if (loaded?.model.id === model.id) await unloadModel()
  const models = await new ModelManager({ allowOffline: true }).getModels({ includeInvalid: true })
  await Promise.all(models.filter((m) => m.url === model.url).map((m) => m.remove()))
}

export async function unloadModel() {
  const current = wllama
  wllama = null
  loaded = null
  await current?.exit()
}

export function loadModel(
  model: ModelOption,
  settings: EngineSettings,
  onProgress: (fraction: number) => void,
): Promise<LoadedModel> {
  // Repeated calls for the same model (e.g. React StrictMode effects) share one load.
  const key = JSON.stringify([model.id, settings])
  if (pending?.key === key) return pending.promise
  markBusy({ modelId: model.id, phase: 'loading', settings })
  const promise = doLoadModel(model, settings, onProgress).finally(() => {
    clearBusy()
    if (pending?.promise === promise) pending = null
  })
  pending = { key, promise }
  return promise
}

async function doLoadModel(
  model: ModelOption,
  settings: EngineSettings,
  onProgress: (fraction: number) => void,
): Promise<LoadedModel> {
  if (loaded?.model.id === model.id && JSON.stringify(loaded.settings) === JSON.stringify(settings)) return loaded
  await unloadModel()

  const params = {
    n_ctx: CONTEXT_SIZE,
    n_batch: BATCH_SIZE,
    n_ubatch: BATCH_SIZE,
    // n_gpu_layers: 0 makes wllama skip WebGPU device setup entirely.
    ...(settings.gpu ? {} : { n_gpu_layers: 0 }),
    ...(settings.singleThread ? { n_threads: 1 } : {}),
    progressCallback: ({ loaded: done, total }: { loaded: number; total: number }) => onProgress(total ? done / total : 0),
  }

  let instance = createWllama()
  let usedGpu = settings.gpu
  try {
    await instance.loadModelFromUrl(model.url, params)
  } catch (err) {
    await instance.exit().catch(() => {})
    if (err instanceof WllamaError && err.type === 'download_error') throw err
    if (isFileReadError(err)) {
      // Seen right after downloading another model in the same session: the browser briefly
      // refuses to read the cached file. A fresh instance a moment later usually succeeds.
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } else if (!settings.gpu) {
      throw err
    } else {
      // Some GPU drivers fail under WebGPU. The file is cached by now, so retry on the CPU.
      usedGpu = false
    }
    instance = createWllama()
    await instance.loadModelFromUrl(model.url, usedGpu ? params : { ...params, n_gpu_layers: 0 })
  }

  wllama = instance
  loaded = {
    model,
    settings,
    // navigator.gpu can exist without a usable adapter, so ask for one.
    backend: usedGpu && (await hasWebGPU()) ? 'GPU' : 'CPU',
    threads: instance.isMultithread() ? instance.getNumThreads() : 1,
  }
  return loaded
}

export interface ReplyOptions {
  reply: ReplySettings
  /** Facts the reply must be based on (map places, document passages), added to the system prompt. */
  context?: string
}

function systemPrompt({ reply, context }: ReplyOptions) {
  // For Indonesian the whole prompt is Indonesian; an English prompt pulls small models to English.
  const base =
    reply.language === 'indonesian'
      ? [
          'Kamu adalah asisten Pocket Ai Research, AI yang membantu dan berjalan offline di perangkat pengguna.',
          'Selalu jawab dalam Bahasa Indonesia, walaupun pertanyaannya dalam bahasa lain.',
          LENGTHS[reply.length].rule,
        ].join(' ')
      : [
          "You are the Pocket Ai Research assistant, a helpful AI that runs offline on the user's device.",
          LANGUAGE_RULES[reply.language],
          LENGTHS[reply.length].rule,
        ].join(' ')
  return context ? `${base}\n\n${context}` : base
}

export async function generateReply(
  history: ChatMessage[],
  options: ReplyOptions,
  onText: (piece: string) => void,
  signal: AbortSignal,
): Promise<{ tokensPerSecond?: number }> {
  if (!wllama || !loaded) throw new Error('No model is loaded.')
  markBusy({ modelId: loaded.model.id, phase: 'replying', settings: loaded.settings })
  try {
    return await streamReply(wllama, history, options, onText, signal)
  } finally {
    clearBusy()
  }
}

async function streamReply(
  instance: Wllama,
  history: ChatMessage[],
  options: ReplyOptions,
  onText: (piece: string) => void,
  signal: AbortSignal,
): Promise<{ tokensPerSecond?: number }> {
  const recent = history.slice(-MAX_HISTORY)
  // Small models follow the language of the last message over the system prompt, so a fixed
  // reply language is repeated there too (sent to the model only, never shown).
  const last = recent.at(-1)
  if (last?.role === 'user' && options.reply.language !== 'auto') {
    recent[recent.length - 1] = { ...last, content: `${last.content}\n\n(${LANGUAGE_RULES[options.reply.language]})` }
  }
  const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt(options) }, ...recent]
  const stream = await instance.createChatCompletion({
    messages,
    stream: true,
    max_tokens: LENGTHS[options.reply.length].maxTokens,
    temperature: TEMPERATURES[options.reply.creativity],
    top_p: 0.9,
    penalty_repeat: 1.1,
    abortSignal: signal,
  })

  let tokensPerSecond: number | undefined
  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta.content
    if (piece) onText(piece)
    if (chunk.timings) tokensPerSecond = chunk.timings.predicted_per_second
  }
  return { tokensPerSecond }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof WllamaAbortError || (err instanceof Error && err.name === 'AbortError')
}

function isFileReadError(err: unknown) {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /NotReadableError|File read failed/i.test(text)
}

export function describeError(err: unknown): string {
  if (isFileReadError(err)) {
    return 'The model file could not be read just now. Close and reopen the app, then open the model again. It does not need to be downloaded again.'
  }
  if (err instanceof WllamaError) {
    switch (err.type) {
      case 'download_error':
        return 'The model could not be downloaded. Check your internet connection and try again.'
      case 'kv_cache_full':
        return 'This conversation is too long for the model. Start a new chat.'
      case 'load_error':
        return 'The model could not be loaded. Your device may not have enough free memory.'
    }
  }
  return err instanceof Error ? err.message : String(err)
}
