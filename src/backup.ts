import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { listConversations, saveConversation, type Conversation } from './chatStore'
import { getDocuments, listDocuments, listNotes, saveDocument, saveNote, type DocRecord, type Note } from './docs/store'
import { listFavorites, listTrips, saveFavorite, saveTrip, type Favorite, type Trip } from './map/offlineStore'
import { MAX_MEMORY, readMemory, writeMemory, type MemoryItem } from './memory'

/**
 * Everything a person made in the app, in one JSON file, to keep or to move to another phone: chats
 * (photos included), documents, notes, memory, saved places and trips. Models and offline maps are
 * left out (large, and downloaded again); so are the vectors for search by meaning, which are
 * rebuilt after an import when that search is on.
 */
interface Backup {
  app: 'pocket-ai-research'
  format: 1
  exportedAt: string
  conversations: Conversation[]
  documents: DocRecord[]
  notes: Note[]
  memory: MemoryItem[]
  favorites: Favorite[]
  trips: Trip[]
}

export interface BackupSummary {
  conversations: number
  documents: number
  notes: number
  memory: number
  favorites: number
  trips: number
}

const withoutVectors = <T extends { vectors?: Float32Array[] }>(item: T): T => {
  const { vectors: _, ...rest } = item
  return rest as T
}

export function describeSummary(s: BackupSummary) {
  const parts: [number, string][] = [
    [s.conversations, 'chat'],
    [s.documents, 'document'],
    [s.notes, 'note'],
    [s.memory, 'memory'],
    [s.favorites, 'saved place'],
    [s.trips, 'trip'],
  ]
  const text = parts
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word === 'memory' ? (n === 1 ? 'memory' : 'memories') : n === 1 ? word : `${word}s`}`)
  return text.length ? text.join(', ') : 'nothing'
}

async function collect(): Promise<Backup> {
  const [conversations, summaries, notes, favorites, trips] = await Promise.all([
    listConversations(),
    listDocuments(),
    listNotes(),
    listFavorites(),
    listTrips(),
  ])
  const documents = await getDocuments(summaries.map((d) => d.id))
  return {
    app: 'pocket-ai-research',
    format: 1,
    exportedAt: new Date().toISOString(),
    conversations,
    documents: documents.map(withoutVectors),
    notes: notes.map(withoutVectors),
    memory: readMemory(),
    favorites,
    trips,
  }
}

/** Saves the backup file: through the share sheet in the Android app, as a download on the web. */
export async function exportBackup(): Promise<BackupSummary> {
  const backup = await collect()
  const json = JSON.stringify(backup)
  const fileName = `pocket-ai-backup-${backup.exportedAt.slice(0, 10)}.json`
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: 'Pocket Ai Research backup', files: [uri] })
  } else {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return summarize(backup)
}

const summarize = (b: Backup): BackupSummary => ({
  conversations: b.conversations.length,
  documents: b.documents.length,
  notes: b.notes.length,
  memory: b.memory.length,
  favorites: b.favorites.length,
  trips: b.trips.length,
})

/**
 * Adds a backup's contents to this device. An item with the same id as one already here replaces
 * it (the backup's copy is taken as the newer); memory facts already known are not repeated.
 */
export async function importBackup(file: File): Promise<BackupSummary> {
  let backup: Backup
  try {
    backup = JSON.parse(await file.text())
  } catch {
    throw new Error('This file is not a Pocket Ai Research backup (it is not valid JSON).')
  }
  if (backup?.app !== 'pocket-ai-research' || backup.format !== 1) {
    throw new Error('This file is not a Pocket Ai Research backup.')
  }
  const list = <T>(items: T[] | undefined) => (Array.isArray(items) ? items : [])
  for (const conversation of list(backup.conversations)) await saveConversation(conversation)
  for (const doc of list(backup.documents)) await saveDocument(withoutVectors(doc))
  for (const note of list(backup.notes)) await saveNote(withoutVectors(note))
  for (const favorite of list(backup.favorites)) await saveFavorite(favorite)
  for (const trip of list(backup.trips)) await saveTrip(trip)
  const memory = readMemory()
  const known = new Set(memory.map((m) => m.text.toLowerCase()))
  const added = list(backup.memory).filter((m) => m?.text && !known.has(m.text.toLowerCase()))
  writeMemory([...memory, ...added].slice(-MAX_MEMORY))
  return { ...summarize(backup), memory: added.length }
}
