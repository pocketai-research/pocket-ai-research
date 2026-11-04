import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface DocChunk {
  text: string
  /** PDF page number; null for plain text files. */
  page: number | null
}

export interface DocSummary {
  id: string
  name: string
  /** Characters of extracted text. */
  chars: number
  addedAt: number
}

export interface DocRecord extends DocSummary {
  chunks: DocChunk[]
  /** One unit vector per chunk, for search by meaning (src/ai/embeddings.ts); absent until indexed. */
  vectors?: Float32Array[]
}

interface DocsDB extends DBSchema {
  documents: { key: string; value: DocRecord }
}

let dbPromise: Promise<IDBPDatabase<DocsDB>> | null = null

function db() {
  dbPromise ??= openDB<DocsDB>('pocket-ai-docs', 1, {
    upgrade(database) {
      database.createObjectStore('documents', { keyPath: 'id' })
    },
  })
  return dbPromise
}

export const summarize = ({ id, name, chars, addedAt }: DocRecord): DocSummary => ({ id, name, chars, addedAt })

export async function saveDocument(doc: DocRecord) {
  await (await db()).put('documents', doc)
}

export async function getDocuments(ids: string[]): Promise<DocRecord[]> {
  const database = await db()
  const docs = await Promise.all(ids.map((id) => database.get('documents', id)))
  return docs.filter((d): d is DocRecord => d !== undefined)
}

export async function listDocuments(): Promise<DocSummary[]> {
  try {
    return (await (await db()).getAll('documents')).map(summarize).sort((a, b) => b.addedAt - a.addedAt)
  } catch {
    return []
  }
}

export async function deleteDocument(id: string) {
  await (await db()).delete('documents', id)
}
