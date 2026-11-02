export interface ModelOption {
  id: string
  name: string
  tier: string
  size: string
  description: string
  url: string
}

// Single-file Q4_K_M GGUFs. wllama cannot load a single file above 2 GB.
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
]
