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

/** A place the user saved, e.g. "Home", for directions with one tap. */
export interface Favorite {
  id: string
  name: string
  lon: number
  lat: number
  createdAt: number
}

/** A point of a recorded trip. */
export interface TripPoint {
  lon: number
  lat: number
  /** Metres above sea level, when the GPS reports it. */
  ele: number | null
  time: number
}

/** A route recorded with GPS (src/map/tripRecorder.ts). */
export interface Trip {
  id: string
  name: string
  startedAt: number
  endedAt: number
  points: TripPoint[]
  /** Metres along the points. */
  distance: number
  /** Metres climbed, from the GPS altitude. */
  climb: number
}

interface MapsDB extends DBSchema {
  areas: { key: string; value: OfflineArea }
  /** Vector tiles, keyed "<areaId>/<z>/<x>/<y>". */
  tiles: { key: string; value: ArrayBuffer }
  /** Style, sprite and glyph files needed to draw the map offline, keyed by name. */
  assets: { key: string; value: ArrayBuffer }
  /** Child regions from Overpass, keyed by parent OSM relation id. */
  admin: { key: number; value: AdminChildren }
  favorites: { key: string; value: Favorite }
  trips: { key: string; value: Trip }
}

let dbPromise: Promise<IDBPDatabase<MapsDB>> | null = null

function db() {
  dbPromise ??= openDB<MapsDB>('pocket-ai-maps', 4, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('areas', { keyPath: 'id' })
        database.createObjectStore('tiles')
        database.createObjectStore('assets')
        database.createObjectStore('admin')
      } else if (oldVersion < 2) {
        // Version 2 changed the cached region lists (grouped by level, overseas areas kept).
        transaction.objectStore('admin').clear()
      }
      // Version 3 added saved places.
      if (oldVersion < 3) database.createObjectStore('favorites', { keyPath: 'id' })
      // Version 4 added recorded trips.
      if (oldVersion < 4) database.createObjectStore('trips', { keyPath: 'id' })
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

/** Saved places, oldest first. */
export async function listFavorites(): Promise<Favorite[]> {
  try {
    return (await (await db()).getAll('favorites')).sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function saveFavorite(favorite: Favorite) {
  await (await db()).put('favorites', favorite)
}

export async function deleteFavorite(id: string) {
  await (await db()).delete('favorites', id)
}

/** Recorded trips, newest first. */
export async function listTrips(): Promise<Trip[]> {
  try {
    return (await (await db()).getAll('trips')).sort((a, b) => b.startedAt - a.startedAt)
  } catch {
    return []
  }
}

export async function saveTrip(trip: Trip) {
  await (await db()).put('trips', trip)
}

export async function deleteTrip(id: string) {
  await (await db()).delete('trips', id)
}
