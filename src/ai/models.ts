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
}

// Single-file Q4_K_M GGUFs. In WebAssembly the weights must fit in one allocation, which fails
// at about 2 GB: Llama 3.2 3B (2.0 GB) downloads but cannot load, so models stay well below that.
export const MODELS: ModelOption[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B Instruct',
    tier: 'Light',
    size: '491 MB',
    description: 'Fastest. Best for phones and short questions.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen2.5 1.5B Instruct',
    tier: 'Balanced',
    size: '1.1 GB',
    description: 'Smarter answers. Best for laptops and newer phones.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    tier: 'Smart',
    size: '1.1 GB',
    description: 'Newest model, best at reasoning and Indonesian. A little slower than Balanced.',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    // Qwen3 keeps 8 key/value heads, so its context costs about 4x more memory than Qwen2.5's.
    contextSize: 3072,
    canThink: true,
  },
  {
    id: 'internvl3-1b',
    name: 'InternVL3 1B',
    tier: 'Vision',
    size: '1.0 GB',
    description: 'Reads photos, including text in them. Use it to ask about pictures.',
    url: 'https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF/resolve/main/InternVL3-1B-Instruct-Q8_0.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/InternVL3-1B-Instruct-GGUF/resolve/main/mmproj-InternVL3-1B-Instruct-Q8_0.gguf',
  },
]
