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
import type { ModelOption } from './models'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LoadedModel {
  model: ModelOption
  backend: 'GPU' | 'CPU'
  threads: number
}

const SYSTEM_PROMPT =
  "You are the Pocket Ai Research assistant, a helpful AI that runs offline on the user's device. Reply in clear, concise English."
const CONTEXT_SIZE = 4096
const MAX_REPLY_TOKENS = 1024
// Only the most recent messages are sent so long chats stay inside the context window.
const MAX_HISTORY = 12

let wllama: Wllama | null = null
let loaded: LoadedModel | null = null
let pending: { id: string; promise: Promise<LoadedModel> } | null = null

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

export function loadModel(model: ModelOption, onProgress: (fraction: number) => void): Promise<LoadedModel> {
  // Repeated calls for the same model (e.g. React StrictMode effects) share one load.
  if (pending?.id === model.id) return pending.promise
  const promise = doLoadModel(model, onProgress).finally(() => {
    if (pending?.promise === promise) pending = null
  })
  pending = { id: model.id, promise }
  return promise
}

async function doLoadModel(model: ModelOption, onProgress: (fraction: number) => void): Promise<LoadedModel> {
  if (loaded?.model.id === model.id) return loaded
  await unloadModel()

  const params = {
    n_ctx: CONTEXT_SIZE,
    progressCallback: ({ loaded: done, total }: { loaded: number; total: number }) => onProgress(total ? done / total : 0),
  }

  let instance = createWllama()
  let forcedCpu = false
  try {
    await instance.loadModelFromUrl(model.url, params)
  } catch (err) {
    await instance.exit().catch(() => {})
    if (err instanceof WllamaError && err.type === 'download_error') throw err
    // Some GPU drivers fail under WebGPU. The file is cached by now, so retry on the CPU.
    instance = createWllama()
    forcedCpu = true
    await instance.loadModelFromUrl(model.url, { ...params, n_gpu_layers: 0 })
  }

  wllama = instance
  loaded = {
    model,
    // navigator.gpu can exist without a usable adapter, so ask for one.
    backend: !forcedCpu && (await hasWebGPU()) ? 'GPU' : 'CPU',
    threads: instance.getNumThreads(),
  }
  return loaded
}

export async function generateReply(
  history: ChatMessage[],
  onText: (piece: string) => void,
  signal: AbortSignal,
): Promise<{ tokensPerSecond?: number }> {
  if (!wllama) throw new Error('No model is loaded.')

  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY),
  ]
  const stream = await wllama.createChatCompletion({
    messages,
    stream: true,
    max_tokens: MAX_REPLY_TOKENS,
    temperature: 0.7,
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

export function describeError(err: unknown): string {
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
