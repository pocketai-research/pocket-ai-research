import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChatMessage } from './ai/engine'
import type { ReplySettings } from './settings'

export interface ChatEntry extends ChatMessage {
  /** What a thinking model worked through before its answer (Think first). */
  thoughts?: string
  tokensPerSecond?: number
  error?: boolean
  /** Document passages the reply was based on, e.g. "report.pdf p. 3". */
  sources?: string[]
  /** Tools the app ran for the reply, e.g. "calculator: 17 × 23 × 4 = 1,564" (src/ai/tools.ts). */
  tools?: string[]
  /** A user message sent with a translation template: the reply's language, whatever the settings say. */
  replyLanguage?: ReplySettings['language']
  /** A user message whose fact was saved to memory ("Remember that…"). */
  remembered?: boolean
}

export interface Conversation {
  id: string
  title: string
  modelId: string
  messages: ChatEntry[]
  /** Documents attached to this chat (see src/docs/store.ts). */
  documentIds?: string[]
  /** The user's instructions for this chat, e.g. "You are a maths teacher". */
  instructions?: string
  createdAt: number
  updatedAt: number
}

interface ChatDB extends DBSchema {
  conversations: {
    key: string
    value: Conversation
    indexes: { updatedAt: number }
  }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

function db() {
  dbPromise ??= openDB<ChatDB>('pocket-ai', 1, {
    upgrade(database) {
      const store = database.createObjectStore('conversations', { keyPath: 'id' })
      store.createIndex('updatedAt', 'updatedAt')
    },
  })
  return dbPromise
}

export function titleFrom(messages: ChatEntry[]): string {
  const first = messages.find((m) => m.role === 'user')?.content.trim().split('\n')[0] ?? 'New chat'
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first
}

/** Newest first. Returns an empty list when storage is unavailable (e.g. private browsing). */
export async function listConversations(): Promise<Conversation[]> {
  try {
    return (await (await db()).getAllFromIndex('conversations', 'updatedAt')).reverse()
  } catch {
    return []
  }
}

export async function saveConversation(conversation: Conversation) {
  try {
    await (await db()).put('conversations', conversation)
  } catch {
    // Saving is best effort; the chat keeps working without it.
  }
}

export async function deleteConversation(id: string) {
  await (await db()).delete('conversations', id)
}
