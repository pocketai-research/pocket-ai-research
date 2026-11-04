// Long-term memory: facts the user asked the AI to remember, kept on the device and added to the
// system prompt of every chat. Saved deliberately ("Remember that…", or on the start page), never
// guessed from conversations, so nothing is stored that the user did not choose.

export interface MemoryItem {
  id: string
  text: string
  createdAt: number
}

const KEY = 'pocket-ai:memory'
/** Keeps the system prompt short enough for small context windows. */
export const MAX_MEMORY = 30
export const MAX_FACT_CHARS = 200

export function readMemory(): MemoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function writeMemory(items: MemoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // Without storage the memory lasts until the app closes.
  }
}

/** Adds a fact; the oldest ones go when the memory is full. */
export function withFact(items: MemoryItem[], text: string): MemoryItem[] {
  const fact = text.trim().slice(0, MAX_FACT_CHARS)
  if (!fact || items.some((item) => item.text.toLowerCase() === fact.toLowerCase())) return items
  return [...items, { id: crypto.randomUUID(), text: fact, createdAt: Date.now() }].slice(-MAX_MEMORY)
}

// "Remember that…", "Please remember: …", "Ingat bahwa…", "Tolong ingat…". A bare "ingat" or
// "remember" is left alone: "Ingat tidak…?" and "Remember when…?" are questions.
const REMEMBER = [
  /^(?:please\s+)?remember\s+that\s+(.+)/is,
  /^(?:please\s+)?remember\s*:\s*(.+)/is,
  /^please\s+remember\s+(.+)/is,
  /^(?:tolong\s+)?ingat(?:lah)?\s+bahwa\s+(.+)/is,
  /^(?:tolong\s+)?ingat(?:lah)?\s*:\s*(.+)/is,
  /^tolong\s+ingat(?:lah|kan)?\s+(.+)/is,
]

/** The fact in a message that asks the AI to remember something, or null. */
export function factToRemember(message: string): string | null {
  const text = message.trim()
  for (const pattern of REMEMBER) {
    const fact = text.match(pattern)?.[1]?.trim().replace(/[.!]+$/, '')
    if (fact) return fact
  }
  return null
}
