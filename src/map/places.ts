import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { tileRange, type BBox } from './geo'
import { getTile, type OfflineArea } from './offlineStore'

export interface Place {
  name: string
  /** OpenMapTiles POI class and subclass, e.g. "hospital / clinic". */
  kind: string
  /** The most specific of the two, e.g. "clinic". */
  subclass: string
  lon: number
  lat: number
  /** Metres from the search origin. */
  distance: number
  /** Compass direction from the search origin, e.g. "north-east". */
  direction: string
}

interface Category {
  label: string
  /** OpenMapTiles POI class or subclass values. */
  kinds: string[]
  /** Words in English or Indonesian that ask for this category. */
  words: string[]
  /** Also match places of worship whose religion is not tagged but whose name contains one of these. */
  names?: string[]
  /** Kinds listed first, before closer matches of other kinds (real hospitals before clinics). */
  prefer?: string[]
}

const CATEGORIES: Category[] = [
  { label: 'hospitals', kinds: ['hospital', 'clinic', 'doctors'], prefer: ['hospital'], words: ['hospital', 'rumah sakit', 'rs', 'rsud'] },
  { label: 'clinics', kinds: ['clinic', 'doctors', 'hospital'], prefer: ['clinic', 'doctors'], words: ['clinic', 'doctor', 'klinik', 'puskesmas', 'dokter', 'posyandu'] },
  { label: 'pharmacies', kinds: ['pharmacy', 'chemist'], words: ['pharmacy', 'drugstore', 'apotek', 'apotik', 'obat'] },
  // For places of worship OpenMapTiles puts the religion in the subclass.
  { label: 'mosques', kinds: ['muslim'], names: ['masjid', 'mosque', 'musholla', 'mushola', 'musala', 'langgar'], words: ['mosque', 'masjid', 'musholla', 'mushola', 'musala'] },
  { label: 'churches', kinds: ['christian'], names: ['gereja', 'church', 'katedral', 'cathedral'], words: ['church', 'gereja'] },
  { label: 'temples', kinds: ['hindu', 'buddhist', 'taoist', 'confucian'], names: ['pura', 'vihara', 'klenteng', 'temple'], words: ['temple', 'pura', 'vihara', 'klenteng'] },
  { label: 'places of worship', kinds: ['place_of_worship'], words: ['worship', 'ibadah'] },
  { label: 'petrol stations', kinds: ['fuel'], words: ['petrol', 'gas station', 'fuel', 'spbu', 'pom bensin', 'bensin', 'pertamina'] },
  { label: 'ATMs and banks', kinds: ['atm', 'bank'], words: ['atm', 'bank', 'cash'] },
  { label: 'places to eat', kinds: ['restaurant', 'fast_food', 'food_court', 'cafe'], words: ['restaurant', 'food', 'eat', 'lunch', 'dinner', 'makan', 'restoran', 'rumah makan', 'warung', 'kuliner'] },
  { label: 'cafes', kinds: ['cafe'], words: ['cafe', 'coffee', 'kopi', 'kafe'] },
  { label: 'schools and universities', kinds: ['school', 'kindergarten', 'college', 'university'], words: ['school', 'university', 'college', 'campus', 'sekolah', 'universitas', 'kampus', 'sd', 'smp', 'sma', 'smk'] },
  { label: 'hotels', kinds: ['lodging', 'hotel', 'hostel', 'motel', 'guest_house'], words: ['hotel', 'hostel', 'stay', 'penginapan', 'losmen', 'homestay', 'guest house'] },
  { label: 'shops and markets', kinds: ['grocery', 'supermarket', 'convenience', 'marketplace', 'mall'], words: ['supermarket', 'minimarket', 'market', 'shop', 'store', 'mall', 'pasar', 'toko', 'indomaret', 'alfamart', 'belanja'] },
  // "police station" must outrank the bus and train stops' "station" (the longest match wins).
  { label: 'police stations', kinds: ['police'], words: ['police station', 'police', 'kantor polisi', 'polisi', 'polsek', 'polres'] },
  { label: 'fire stations', kinds: ['fire_station'], words: ['fire station', 'fire brigade', 'pemadam', 'pemadam kebakaran', 'damkar'] },
  { label: 'bus and train stops', kinds: ['bus', 'bus_stop', 'bus_station', 'railway', 'station', 'halt'], words: ['bus', 'train', 'station', 'halte', 'stasiun', 'terminal', 'kereta'] },
  { label: 'toilets', kinds: ['toilets'], words: ['toilet', 'restroom', 'wc', 'kamar mandi'] },
  { label: 'parking', kinds: ['parking'], words: ['parking', 'parkir'] },
  { label: 'parks', kinds: ['park'], words: ['park', 'taman'] },
  { label: 'post offices', kinds: ['post', 'post_office'], words: ['post office', 'kantor pos'] },
]

const STOP_WORDS = new Set(
  'where is are the a an near nearest closest me here around any find show what which how to of in di mana dimana yang terdekat dekat sini sekitar ada cari carikan tunjukkan apa ke dari saya aku'.split(' '),
)

export interface PlaceQuery {
  category: Category | null
  /** Words to match in place names when no category was recognised. */
  text: string
  /** Asks the way there ("route to…", "rute ke…"): show directions to the first place found. */
  route: boolean
  /** "walk", "jalan kaki": directions on foot. */
  walk: boolean
}

// Longest first, so "how do i get to" is removed whole.
const ROUTE_PHRASES = [
  'jalan kaki menuju', 'jalan kaki ke', 'walking to', 'how do i get to', 'how can i get to', 'how to get to', 'how to go to', 'directions to', 'direction to',
  'take me to', 'navigate to', 'route to', 'walk to', 'way to', 'go to',
  'bagaimana cara ke', 'cara pergi ke', 'cara menuju', 'jalan menuju', 'rute menuju', 'arah menuju',
  'rute ke', 'arah ke', 'jalan ke', 'cara ke', 'pergi ke', 'antar ke', 'menuju ke', 'menuju', 'rute', 'directions',
]
const WALK_WORDS = ['jalan kaki', 'on foot', 'walking', 'walk']

export function parseQuery(input: string): PlaceQuery {
  let lower = ` ${input.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `
  const walk = WALK_WORDS.some((w) => lower.includes(` ${w} `))
  const route = ROUTE_PHRASES.some((phrase) => lower.includes(` ${phrase} `))
  for (const phrase of [...ROUTE_PHRASES, ...WALK_WORDS]) lower = lower.replaceAll(` ${phrase} `, ' ')
  // Longest phrase first, so "rumah sakit" wins over shorter words.
  const matches = CATEGORIES.flatMap((category) => category.words.map((word) => ({ category, word })))
    .filter(({ word }) => lower.includes(` ${word} `))
    .sort((a, b) => b.word.length - a.word.length)
  if (matches.length) return { category: matches[0].category, text: '', route, walk }
  const text = lower
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ')
  return { category: null, text, route, walk }
}

export const describeQuery = (query: PlaceQuery) => query.category?.label ?? `places named “${query.text}”`

const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

function measure(from: [number, number], to: [number, number]) {
  const rad = Math.PI / 180
  const [lon1, lat1] = [from[0] * rad, from[1] * rad]
  const [lon2, lat2] = [to[0] * rad, to[1] * rad]
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  const distance = 2 * 6371000 * Math.asin(Math.sqrt(a))
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  const bearing = ((Math.atan2(y, x) / rad) + 360) % 360
  return { distance, direction: DIRECTIONS[Math.round(bearing / 45) % 8] }
}

/** A place at a point, with its distance and direction from the origin (a saved place, for example). */
export function placeAt(name: string, kind: string, lon: number, lat: number, origin: [number, number]): Place {
  return { name, kind, subclass: kind, lon, lat, ...measure(origin, [lon, lat]) }
}

export const formatDistance = (metres: number) =>
  metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`

// POIs are complete at zoom 14, the deepest OpenMapTiles level.
const POI_ZOOM = 14

let onlineTemplate: Promise<string> | null = null
const onlineTiles = new Map<string, Promise<ArrayBuffer | undefined>>()

function fetchOnlineTile(z: number, x: number, y: number) {
  // Directions read up to 150 tiles; keep the cache from growing without bound.
  if (onlineTiles.size > 400) onlineTiles.clear()
  onlineTemplate ??= fetch('https://tiles.openfreemap.org/planet')
    .then((res) => res.json())
    .then((tileJson) => tileJson.tiles[0] as string)
  const key = `${z}/${x}/${y}`
  let tile = onlineTiles.get(key)
  if (!tile) {
    tile = onlineTemplate
      .then((template) => fetch(template.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`)))
      .then((res) => (res.ok ? res.arrayBuffer() : undefined))
    onlineTiles.set(key, tile)
  }
  return tile
}

/** A vector tile from the offline area, or from OpenFreeMap when no area is open. */
export const loadTile = (area: OfflineArea | null, z: number, x: number, y: number) =>
  area ? getTile(`${area.id}/${z}/${x}/${y}`) : fetchOnlineTile(z, x, y)

function boxAround([lon, lat]: [number, number], metres: number): BBox {
  const dLat = metres / 111_320
  const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

function matches(query: PlaceQuery, name: string, kinds: string[]) {
  const lowerName = name.toLowerCase()
  const category = query.category
  if (category) {
    if (kinds.some((k) => category.kinds.includes(k))) return true
    // A place of worship without a religion tag, recognised by its name ("Masjid ...").
    return !!category.names && kinds.includes('place_of_worship') && category.names.some((n) => lowerName.includes(n))
  }
  return query.text.length > 1 && query.text.split(' ').every((word) => lowerName.includes(word))
}

/**
 * Finds places in the map data around the origin: from an offline area's stored tiles, or from
 * OpenFreeMap when online. Searches 1.5 km first and widens to 5 km if nothing matches.
 */
export async function searchPlaces(
  query: PlaceQuery,
  origin: [number, number],
  area: OfflineArea | null,
): Promise<{ places: Place[]; radius: number; zoom: number }> {
  const zoom = area ? Math.min(POI_ZOOM, area.maxzoom) : POI_ZOOM
  let places: Place[] = []
  let radius = 0
  for (radius of [1500, 5000]) {
    const { x0, x1, y0, y1 } = tileRange(boxAround(origin, radius), zoom)
    const found = new Map<string, Place>()
    const reads: Promise<void>[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const read = loadTile(area, zoom, x, y).then((data) => {
          if (!data || data.byteLength === 0) return
          const layer = new VectorTile(new PbfReader(data)).layers.poi
          for (let i = 0; layer && i < layer.length; i++) {
            const feature = layer.feature(i)
            const { name, class: cls, subclass } = feature.properties
            if (typeof name !== 'string' || !name) continue
            const kinds = [String(cls ?? ''), String(subclass ?? '')]
            if (!matches(query, name, kinds)) continue
            const [lon, lat] = (feature.toGeoJSON(x, y, zoom).geometry as { coordinates: number[] }).coordinates
            const { distance, direction } = measure(origin, [lon, lat])
            if (distance > radius) continue
            found.set(`${name}|${lon.toFixed(4)}|${lat.toFixed(4)}`, {
              name,
              kind: [cls, subclass].filter((k, j, all) => k && all.indexOf(k) === j).join(' / '),
              subclass: String(subclass || cls),
              lon,
              lat,
              distance,
              direction,
            })
          }
        })
        reads.push(read)
      }
    }
    await Promise.all(reads)
    const prefer = query.category?.prefer ?? []
    const rank = (p: Place) => (prefer.includes(p.subclass) ? 0 : 1)
    places = [...found.values()].sort((a, b) => rank(a) - rank(b) || a.distance - b.distance).slice(0, 10)
    // Widen the search when nothing matched, or when only fallback kinds did (clinics for "hospital").
    if (places.length && (!prefer.length || places.some((p) => rank(p) === 0))) break
  }
  return { places, radius, zoom }
}

/** Facts for the AI, so its answer is grounded in real map data. */
export function placesContext(query: PlaceQuery, places: Place[], originLabel: string) {
  if (!places.length) {
    return `The offline map has no ${describeQuery(query)} near ${originLabel}. Say that clearly and do not invent any place.`
  }
  const lines = places.map(
    (p, i) => `${i + 1}. ${p.name} (${p.kind.replace(/_/g, ' ')}), ${formatDistance(p.distance)} ${p.direction} of ${originLabel}`,
  )
  return [
    `Map data: ${describeQuery(query)} near ${originLabel}, closest first:`,
    ...lines,
    'Answer the question using only these places. Mention names, distances and directions. Never invent places.',
  ].join('\n')
}
