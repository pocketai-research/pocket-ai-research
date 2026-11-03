import { bboxCenter, containsPoint, type BBox } from './geo'
import { getAdmin, putAdmin } from './offlineStore'

export interface AdminRegion {
  /** OpenStreetMap relation id. */
  id: number
  name: string
  nameEn?: string
  level: number
  bbox: BBox
}

export interface AdminGroup {
  level: number
  regions: AdminRegion[]
}

/** Usually one group; two when a region has subdivisions at two levels (e.g. China's SARs and provinces). */
export interface AdminChildren {
  groups: AdminGroup[]
}

// The main public instance is often at capacity, so fall back to a mirror.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

/** Plural names for OpenStreetMap admin_level values, per country. */
const LEVEL_NAMES: Record<string, Record<number, string>> = {
  ID: { 4: 'Provinces', 5: 'Regencies & cities', 6: 'Districts (kecamatan)', 7: 'Villages (desa / kelurahan)' },
  MY: { 4: 'States', 6: 'Districts' },
  US: { 4: 'States', 6: 'Counties', 8: 'Cities & towns' },
  GB: { 4: 'Nations', 5: 'Regions', 6: 'Counties', 8: 'Districts', 10: 'Parishes' },
  DE: { 4: 'States', 5: 'Government regions', 6: 'Districts', 8: 'Municipalities' },
  FR: { 4: 'Regions', 6: 'Departments', 7: 'Arrondissements', 8: 'Communes' },
  IN: { 4: 'States', 5: 'Districts', 6: 'Subdistricts' },
  PH: { 3: 'Regions', 4: 'Provinces', 6: 'Cities & municipalities', 10: 'Barangays' },
  TH: { 4: 'Provinces', 6: 'Districts', 8: 'Subdistricts' },
  VN: { 4: 'Provinces', 6: 'Districts', 8: 'Communes' },
  AU: { 4: 'States & territories', 6: 'Local government areas' },
}

/**
 * Names only. These countries are left out of LEVEL_NAMES on purpose: two levels sit side by
 * side at the top, so they need the two-level scan rather than a single known level.
 */
const SIDE_BY_SIDE_NAMES: Record<string, Record<number, string>> = {
  CN: { 3: 'Special administrative regions', 4: 'Provinces, regions & municipalities', 5: 'Prefectures', 6: 'Counties' },
}

export function levelName(countryIso: string, level: number) {
  return LEVEL_NAMES[countryIso]?.[level] ?? SIDE_BY_SIDE_NAMES[countryIso]?.[level] ?? `Subdivisions (level ${level})`
}

async function overpass(query: string): Promise<any> {
  let lastError: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.ok) return await res.json()
      lastError = new Error(`Overpass returned HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

function toRegion(element: any): AdminRegion | null {
  const { tags = {}, bounds } = element
  if (!tags.name || !bounds) return null
  return {
    id: element.id,
    name: tags.name,
    nameEn: tags['name:en'] && tags['name:en'] !== tags.name ? tags['name:en'] : undefined,
    level: Number(tags.admin_level),
    bbox: [bounds.minlon, bounds.minlat, bounds.maxlon, bounds.maxlat],
  }
}

async function regionsAt(parent: { id: number; level: number; bbox: BBox }, levels: number[]) {
  const data = await overpass(
    `[out:json][timeout:80];rel(${parent.id});map_to_area->.p;` +
      `rel(area.p)[boundary=administrative][admin_level~"^(${levels.join('|')})$"];out tags bb;`,
  )
  return (
    (data.elements as any[])
      .map(toRegion)
      .filter((r): r is AdminRegion => r !== null && r.level > parent.level)
      // Neighbours that only share a border can slip in; keep regions centred inside the parent.
      // Not for countries: their box is the main territory, which would drop Alaska or Hawaii.
      .filter((r) => parent.level <= 2 || containsPoint(parent.bbox, bboxCenter(r.bbox)))
  )
}

/**
 * The next administrative levels inside a region (e.g. a country's provinces). For countries
 * with known levels this asks for that level only; otherwise it scans two levels at a time and
 * returns every level found in the first window that has any. Results are cached on the device,
 * since boundaries rarely change.
 */
export async function fetchChildren(
  countryIso: string,
  parent: { id: number; level: number; bbox: BBox },
): Promise<AdminChildren> {
  const cached = await getAdmin(parent.id)
  if (cached) return cached

  const known = Object.keys(LEVEL_NAMES[countryIso] ?? {})
    .map(Number)
    .filter((l) => l > parent.level)
    .sort((a, b) => a - b)
  const attempts = known.length ? [[known[0]]] : []
  for (let from = parent.level + 1; from <= 10; from += 2) attempts.push([from, from + 1].filter((l) => l <= 10))

  for (const levels of attempts) {
    const found = await regionsAt(parent, levels)
    if (found.length) {
      const groups = [...new Set(found.map((r) => r.level))].sort((a, b) => a - b).map((level) => ({
        level,
        regions: found.filter((r) => r.level === level).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      await putAdmin(parent.id, { groups })
      return { groups }
    }
  }

  await putAdmin(parent.id, { groups: [] })
  return { groups: [] }
}
