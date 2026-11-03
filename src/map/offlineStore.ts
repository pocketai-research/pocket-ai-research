import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AdminChildren } from './admin'
import type { BBox } from './geo'

export interface OfflineArea {
  id: string
  name: string
  /** Where the area sits, e.g. ["Indonesia", "DI Yogyakarta"]. Empty for a custom area. */
  path: string[]
  bbox: BBox
  maxzoom: number
  tiles: number
  bytes: number
  createdAt: number
}

interface MapsDB extends DBSchema {
  areas: { key: string; value: OfflineArea }
  /** Vector tiles, keyed "<areaId>/<z>/<x>/<y>". */
  tiles: { key: string; value: ArrayBuffer }
  /** Style, sprite and glyph files needed to draw the map offline, keyed by name. */
  assets: { key: string; value: ArrayBuffer }
  /** Child regions from Overpass, keyed by parent OSM relation id. */
  admin: { key: number; value: AdminChildren }
}

let dbPromise: Promise<IDBPDatabase<MapsDB>> | null = null

function db() {
  dbPromise ??= openDB<MapsDB>('pocket-ai-maps', 2, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('areas', { keyPath: 'id' })
        database.createObjectStore('tiles')
        database.createObjectStore('assets')
        database.createObjectStore('admin')
      } else {
        // Version 2 changed the cached region lists (grouped by level, overseas areas kept).
        transaction.objectStore('admin').clear()
      }
    },
  })
  return dbPromise
}

const areaRange = (areaId: string) => IDBKeyRange.bound(`${areaId}/`, `${areaId}/￿`)

export async function listAreas(): Promise<OfflineArea[]> {
  try {
    return (await (await db()).getAll('areas')).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function saveArea(area: OfflineArea) {
  await (await db()).put('areas', area)
}

export async function deleteArea(id: string) {
  const database = await db()
  await database.delete('tiles', areaRange(id))
  await database.delete('areas', id)
}

/** Deletes tiles whose key starts with the prefix, e.g. "<areaId>/" or "<areaId>/14/". */
export async function deleteTiles(prefix: string) {
  await (await db()).delete('tiles', IDBKeyRange.bound(prefix, `${prefix}￿`))
}

export async function putTiles(entries: [string, ArrayBuffer][]) {
  const tx = (await db()).transaction('tiles', 'readwrite')
  await Promise.all([...entries.map(([key, data]) => tx.store.put(data, key)), tx.done])
}

export async function getTile(key: string) {
  return (await db()).get('tiles', key)
}

export async function getAsset(key: string) {
  return (await db()).get('assets', key)
}

export async function putAsset(key: string, data: ArrayBuffer) {
  await (await db()).put('assets', data, key)
}

export async function getAdmin(parentId: number) {
  try {
    return await (await db()).get('admin', parentId)
  } catch {
    return undefined
  }
}

export async function putAdmin(parentId: number, children: AdminChildren) {
  try {
    await (await db()).put('admin', children, parentId)
  } catch {
    // Caching is optional.
  }
}
