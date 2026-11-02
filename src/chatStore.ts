import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChatMessage } from './ai/engine'

export interface ChatEntry extends ChatMessage {
  tokensPerSecond?: number
  error?: boolean
}

export interface Conversation {
  id: string
  title: string
  modelId: string
  messages: ChatEntry[]
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
