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
  /** A photo sent with a user message, as a JPEG data URL. */
  image?: string
  /** The photo was sent in detail (several tiles, see src/photo.ts). */
  detail?: boolean
}

export interface LoadedModel {
  model: ModelOption
  settings: EngineSettings
  backend: 'GPU' | 'CPU'
  threads: number
  /** Whether the model can look at images (a vision model with its projector loaded). */
  vision: boolean
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
  // Without this, the browser may delete downloaded models when the device runs low on space.
  await navigator.storage?.persist?.().catch(() => false)

  const params = {
    n_ctx: model.contextSize ?? CONTEXT_SIZE,
    n_batch: BATCH_SIZE,
    n_ubatch: BATCH_SIZE,
    // Parse the model's chat template with Jinja, as llama-server does; Qwen3's switch for its
    // thinking mode only works through it.
    jinja: true,
    // Thoughts arrive apart from the answer (reasoning_content); each request says whether to think.
    ...(model.canThink ? { reasoning_format: 'deepseek' as const } : {}),
    // n_gpu_layers: 0 makes wllama skip WebGPU device setup entirely.
    ...(settings.gpu ? {} : { n_gpu_layers: 0 }),
    ...(settings.singleThread ? { n_threads: 1 } : {}),
    progressCallback: ({ loaded: done, total }: { loaded: number; total: number }) => onProgress(total ? done / total : 0),
  }

  let usedGpu = settings.gpu
  // The browser sometimes refuses to read the cached file at first (seen right after a download
  // and when the app reopens a model on start); later attempts wait longer.
  const readRetryDelays = [1000, 3000, 8000, 15000]
  let instance: Wllama
  for (let attempt = 0; ; attempt++) {
    instance = createWllama()
    try {
      const source = model.mmprojUrl ? { url: model.url, mmprojUrl: model.mmprojUrl } : model.url
      await instance.loadModelFromUrl(source, usedGpu ? params : { ...params, n_gpu_layers: 0 })
      // wllama resolves even when llama.cpp could not load the model, e.g. when WebAssembly
      // memory has no room for its weights; an empty vocabulary gives that away.
      if (!instance.getLoadedContextInfo().n_vocab) {
        throw new WllamaError('The model could not be loaded: not enough memory for its weights.', 'load_error')
      }
      break
    } catch (err) {
      await instance.exit().catch(() => {})
      if (err instanceof WllamaError && err.type === 'download_error') throw err
      if (isFileReadError(err) && attempt < readRetryDelays.length) {
        await new Promise((resolve) => setTimeout(resolve, readRetryDelays[attempt]))
      } else if (usedGpu && !isFileReadError(err)) {
        // Some GPU drivers fail under WebGPU. The file is cached by now, so retry on the CPU.
        usedGpu = false
      } else {
        throw err
      }
    }
  }

  wllama = instance
  loaded = {
    model,
    settings,
    // navigator.gpu can exist without a usable adapter, so ask for one.
    backend: usedGpu && (await hasWebGPU()) ? 'GPU' : 'CPU',
    threads: instance.isMultithread() ? instance.getNumThreads() : 1,
    vision: instance.supportInputModality('image'),
  }
  return loaded
}

export interface ReplyOptions {
  reply: ReplySettings
  /** Facts the reply must be based on (map places, document passages), added to the system prompt. */
  context?: string
  /** The user's instructions for this chat, e.g. "You are a maths teacher". */
  instructions?: string
}

function systemPrompt({ reply, context, instructions }: ReplyOptions) {
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
  const own = instructions?.trim()
  const label = reply.language === 'indonesian' ? 'Instruksi dari pengguna untuk chat ini' : "The user's instructions for this chat"
  const rules = own ? `${base}\n\n${label}: ${own}` : base
  return context ? `${rules}\n\n${context}` : rules
}

/** Streams a reply; with Think first on a model that can think, its thoughts go to onThought first. */
export async function generateReply(
  history: ChatMessage[],
  options: ReplyOptions,
  onText: (piece: string) => void,
  signal: AbortSignal,
  onThought?: (piece: string) => void,
): Promise<{ tokensPerSecond?: number }> {
  if (!wllama || !loaded) throw new Error('No model is loaded.')
  markBusy({ modelId: loaded.model.id, phase: 'replying', settings: loaded.settings })
  try {
    return await streamReply(wllama, loaded, history, options, onText, signal, onThought)
  } finally {
    clearBusy()
  }
}

// Rough token count (about 3 characters per token, on the safe side for Indonesian text).
const estimateTokens = (text: string) => Math.ceil(text.length / 3) + 4
// A photo becomes 256 tokens per 448 px tile once the projector has encoded it (see src/photo.ts).
const IMAGE_TOKENS = 300
const DETAIL_IMAGE_TOKENS = 5 * 256 + 50
const messageTokens = (m: ChatMessage, withImage: boolean) =>
  estimateTokens(m.content) + (withImage ? (m.detail ? DETAIL_IMAGE_TOKENS : IMAGE_TOKENS) : 0)

/**
 * Drops the oldest messages until the prompt and the reply fit in the context window. Only the
 * most recent photo is kept as an image; older ones become "[photo]".
 */
function fitHistory(history: ChatMessage[], budget: number) {
  const lastImage = history.findLastIndex((m) => m.image)
  const kept = history
    .map((m, i) => (m.image && i !== lastImage ? { ...m, image: undefined, detail: undefined, content: `[photo] ${m.content}` } : m))
    .slice(-MAX_HISTORY)
  let used = kept.reduce((sum, m) => sum + messageTokens(m, Boolean(m.image)), 0)
  while (kept.length > 1 && used > budget) {
    const dropped = kept.shift()!
    used -= messageTokens(dropped, Boolean(dropped.image))
  }
  return kept
}

/** The chat format wllama expects; a photo goes in as image bytes before the text. */
async function toCompletionMessage(m: ChatMessage, vision: boolean): Promise<ChatCompletionMessage> {
  if (m.role === 'user' && m.image && vision) {
    const data = await (await fetch(m.image)).arrayBuffer()
    return { role: 'user', content: [{ type: 'image', data }, { type: 'text', text: m.content }] }
  }
  return { role: m.role, content: m.content }
}

async function streamReply(
  instance: Wllama,
  model: LoadedModel,
  history: ChatMessage[],
  options: ReplyOptions,
  onText: (piece: string) => void,
  signal: AbortSignal,
  onThought?: (piece: string) => void,
): Promise<{ tokensPerSecond?: number }> {
  const contextSize = model.model.contextSize ?? CONTEXT_SIZE
  const think = Boolean(model.model.canThink && options.reply.think)
  const system = systemPrompt(options)
  // A small context leaves at most half of it for the reply. Thinking takes the whole half:
  // the thoughts come out of the same budget as the answer.
  const maxTokens = think
    ? Math.floor(contextSize / 2)
    : Math.min(LENGTHS[options.reply.length].maxTokens, Math.floor(contextSize / 2))
  const recent = fitHistory(history, contextSize - maxTokens - estimateTokens(system) - 64)
  // Small models follow the language of the last message over the system prompt, so a fixed
  // reply language is repeated there too (sent to the model only, never shown).
  const last = recent.at(-1)
  if (last?.role === 'user' && options.reply.language !== 'auto') {
    recent[recent.length - 1] = { ...last, content: `${last.content}\n\n(${LANGUAGE_RULES[options.reply.language]})` }
  }
  const vision = model.vision
  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: system },
    ...(await Promise.all(recent.map((m) => toCompletionMessage(m, vision)))),
  ]
  const stream = await instance.createChatCompletion({
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature: TEMPERATURES[options.reply.creativity],
    top_p: 0.9,
    penalty_repeat: 1.1,
    ...(model.model.canThink ? { chat_template_kwargs: { enable_thinking: think } } : {}),
    abortSignal: signal,
  })

  let tokensPerSecond: number | undefined
  for await (const chunk of stream) {
    // llama-server sends a thinking model's thoughts as reasoning_content, apart from the answer.
    const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null } | undefined
    if (delta?.reasoning_content) onThought?.(delta.reasoning_content)
    if (delta?.content) onText(delta.content)
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
