export interface ModelOption {
  id: string
  name: string
  tier: string
  size: string
  description: string
  url: string
  /** Context window in tokens; smaller for big models to save memory. Default 4096. */
  contextSize?: number
  /** The model can think before answering (Qwen3). Off unless the user turns on Think first: slow on phones. */
  canThink?: boolean
  /** Vision models: the projector that turns images into tokens the model understands. */
  mmprojUrl?: string
  /** Shown on the model card when the licence asks for it. */
  attribution?: string
  /** A model replaced by a better one (its id): listed only while it is still downloaded, to open or delete. */
  replacedBy?: string
  /** Tokens a second measured on the reference laptop (see src/deviceCheck.ts), to estimate speed on others. */
  referenceSpeed?: number
  /**
   * Writes the calculation for a word problem, which the app then works out (src/ai/tools.ts).
   * Qwen3 1.7B wrote all four test problems right; Qwen3 0.6B one and Gemma 3 1B one, and a
   * wrong calculation given to the model as exact is worse than none.
   */
  plansCalculations?: boolean
  /** Added by the user (src/ai/customModels.ts): copied from a file on the device, or from a link. */
  custom?: 'file' | 'link'
}

// Single-file Q4_K_M GGUFs. In WebAssembly the weights must fit in one allocation, which fails
// at about 2 GB: Llama 3.2 3B (2.0 GB) downloads but cannot load, so models stay well below that.
// Chosen by comparing answers to Indonesian tasks (translation, facts, sums, explaining, writing a
// message): Qwen3 0.6B beat Qwen2.5 0.5B while being faster, and Gemma 3 1B gave the best answers
// of all, ahead of Qwen2.5 1.5B.
export const MODELS: ModelOption[] = [
  {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    tier: 'Light',
    size: '397 MB',
    description: 'Fastest. Good for quick questions on any phone.',
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
    // Qwen3 keeps 8 key/value heads, so each token of context costs about 10x more memory than
    // with Qwen2.5 0.5B; 2,048 tokens keep the Light model light.
    contextSize: 2048,
    canThink: true,
    referenceSpeed: 7.8,
  },
  {
    id: 'gemma3-1b',
    name: 'Gemma 3 1B',
    tier: 'Balanced',
    size: '806 MB',
    description: 'Best Indonesian and the most natural writing. A little slower than Light.',
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    attribution: 'Gemma is provided under and subject to the Gemma Terms of Use (ai.google.dev/gemma/terms).',
    referenceSpeed: 2.8,
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    tier: 'Smart',
    size: '1.1 GB',
    description: 'Best at reasoning and sums, and can think before answering. Slower than Balanced.',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    // Qwen3 keeps 8 key/value heads, so its context costs about 4x more memory than Qwen2.5's.
    contextSize: 3072,
    canThink: true,
    plansCalculations: true,
    referenceSpeed: 3.6,
  },
  {
    id: 'internvl3-1b',
    name: 'InternVL3 1B',
    tier: 'Vision',
    size: '1.0 GB',
    description: 'Reads photos, including text in them. Use it to ask about pictures.',
    url: 'https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF/resolve/main/InternVL3-1B-Instruct-Q8_0.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF/resolve/main/mmproj-InternVL3-1B-Instruct-Q8_0.gguf',
    referenceSpeed: 6.7,
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B Instruct',
    tier: 'Light (old)',
    size: '491 MB',
    description: 'The earlier Light model.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    replacedBy: 'qwen3-0.6b',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen2.5 1.5B Instruct',
    tier: 'Balanced (old)',
    size: '1.1 GB',
    description: 'The earlier Balanced model.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    replacedBy: 'gemma3-1b',
  },
]
