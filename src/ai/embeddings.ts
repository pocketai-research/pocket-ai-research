import type { Wllama } from '@wllama/wllama/esm/index.js'
import { createWllama, listDownloadedUrls } from './engine'

/**
 * Search by meaning: a small embedding model (multilingual E5 small) turns text into vectors that
 * lie close together when the meaning is close. It runs in its own wllama instance beside the chat model. Its transformer
 * is small (about 21M parameters besides the vocabulary), so a document indexes quickly on a phone.
 */
export const EMBEDDING_MODEL = {
  name: 'Multilingual E5 small',
  size: '132 MB',
  // A conversion with E5's own SentencePiece (T5/UGM) tokenizer; others on Hugging Face label it as
  // a llama or BERT tokenizer, which crashes llama.cpp or splits words wrongly.
  url: 'https://huggingface.co/TwinSunsLLC/multilingual-e5-small-gguf/resolve/main/multilingual-e5-small-q8_0.gguf',
}

// E5 reads at most 512 tokens; a 700-character passage is about 200.
const MAX_CHARS = 1500

let instance: Promise<Wllama> | null = null

/** Loads the model, downloading it the first time; later calls share the loaded instance. */
export function prepareEmbeddings(onProgress?: (fraction: number) => void): Promise<Wllama> {
  if (!instance) {
    const loading = (async () => {
      const wllama = createWllama()
      try {
        await wllama.loadModelFromUrl(EMBEDDING_MODEL.url, {
          embeddings: true,
          pooling_type: 'mean',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 512,
          n_gpu_layers: 0,
          progressCallback: ({ loaded, total }: { loaded: number; total: number }) => onProgress?.(total ? loaded / total : 0),
        })
        return wllama
      } catch (err) {
        await wllama.exit().catch(() => {})
        throw err
      }
    })()
    instance = loading
    // A failed load (offline before the first download, say) can be retried later.
    loading.catch(() => {
      if (instance === loading) instance = null
    })
  }
  return instance
}

export async function isEmbeddingModelDownloaded() {
  return (await listDownloadedUrls()).has(EMBEDDING_MODEL.url)
}

function normalize(values: number[]) {
  const length = Math.hypot(...values) || 1
  return Float32Array.from(values, (v) => v / length)
}

/**
 * Unit-length vectors for the texts. E5 expects "query: " before a question and "passage: "
 * before the text being searched.
 */
export async function embedTexts(texts: string[], kind: 'query' | 'passage', onProgress?: (done: number) => void) {
  const wllama = await prepareEmbeddings()
  const vectors: Float32Array[] = []
  try {
    // One text per request: wllama answers a list of inputs with a single vector (or not at all).
    for (const text of texts) {
      const result = await wllama.createEmbedding({ input: `${kind}: ${text.slice(0, MAX_CHARS)}` })
      vectors.push(normalize(result.data[0].embedding as number[]))
      onProgress?.(vectors.length)
    }
  } catch (err) {
    // A crash inside llama.cpp leaves the instance unusable: the next call starts a fresh one.
    instance = null
    await wllama.exit().catch(() => {})
    throw err
  }
  return vectors
}
