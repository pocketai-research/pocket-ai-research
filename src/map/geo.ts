/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number]

const MAX_LAT = 85.0511

function tileX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function tileY(lat: number, z: number) {
  const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

/** Inclusive tile index range covering the box at zoom z. */
export function tileRange([west, south, east, north]: BBox, z: number) {
  const last = 2 ** z - 1
  const clamp = (v: number) => Math.max(0, Math.min(last, v))
  return { x0: clamp(tileX(west, z)), x1: clamp(tileX(east, z)), y0: clamp(tileY(north, z)), y1: clamp(tileY(south, z)) }
}

export function countTiles(bbox: BBox, z: number) {
  const { x0, x1, y0, y1 } = tileRange(bbox, z)
  return (x1 - x0 + 1) * (y1 - y0 + 1)
}

/** Highest zoom (up to maxZoom) whose tiles from zoom 0 up fit in maxTiles. */
export function planZoom(bbox: BBox, maxTiles: number, maxZoom: number) {
  let tiles = 0
  for (let z = 0; z <= maxZoom; z++) {
    const next = tiles + countTiles(bbox, z)
    if (next > maxTiles) return { maxzoom: z - 1, tiles }
    tiles = next
  }
  return { maxzoom: maxZoom, tiles }
}

export function detailLabel(maxzoom: number) {
  if (maxzoom >= 14) return 'Street level'
  if (maxzoom >= 12) return 'Neighbourhood level'
  if (maxzoom >= 10) return 'Town level'
  if (maxzoom >= 8) return 'Region level'
  return 'Overview only'
}

export function bboxCenter([west, south, east, north]: BBox): [number, number] {
  return [(west + east) / 2, (south + north) / 2]
}

export function containsPoint([west, south, east, north]: BBox, [lon, lat]: [number, number]) {
  return lon >= west && lon <= east && lat >= south && lat <= north
}
