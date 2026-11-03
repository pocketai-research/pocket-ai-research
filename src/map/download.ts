import { Capacitor } from '@capacitor/core'
import { planZoom, tileRange, type BBox } from './geo'
import { deleteTiles, getAsset, putAsset, putTiles, saveArea, type OfflineArea } from './offlineStore'

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'

// OpenFreeMap's terms for in-app offline downloads (openfreemap.org/tos): at most 3,000 tiles
// or 50 MB per download, at most 4 parallel requests, and a User-Agent identifying the app.
const MAX_TILES = 3000
const MAX_BYTES = 50 * 1024 * 1024
const PARALLEL = 4
// OpenFreeMap's vector tiles stop at zoom 14; the map overzooms them beyond that.
const MAX_ZOOM = 14

/** Appended to the Android WebView's User-Agent in capacitor.config.ts. */
export const APP_USER_AGENT = 'PocketAiResearch'

/** Browsers cannot set the User-Agent, so only the Android app may download areas. */
export const canDownload = Capacitor.isNativePlatform() || navigator.userAgent.includes(APP_USER_AGENT)

export const planDownload = (bbox: BBox) => planZoom(bbox, MAX_TILES, MAX_ZOOM)

const GLYPH_RANGES = ['0-255', '256-511', '512-767', '768-1023', '8192-8447']

export interface DownloadProgress {
  done: number
  total: number
  bytes: number
}

async function fetchBuffer(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`)
  return res.arrayBuffer()
}

const parseJson = (data: ArrayBuffer) => JSON.parse(new TextDecoder().decode(data))

/** Style, sprite and Latin glyph ranges, shared by every offline area. */
async function ensureStyleAssets(signal: AbortSignal) {
  if (await getAsset('style.json')) return
  const styleData = await fetchBuffer(STYLE_URL, signal)
  const style = parseJson(styleData)

  const fontstacks = new Set<string>()
  for (const layer of style.layers) {
    const font = layer.layout?.['text-font']
    if (Array.isArray(font) && font.every((f) => typeof f === 'string')) fontstacks.add(font.join(','))
  }
  const files: [string, string][] = [
    ...['.json', '.png', '@2x.json', '@2x.png'].map((suffix): [string, string] => [`sprite/ofm${suffix}`, `${style.sprite}${suffix}`]),
    ...[...fontstacks].flatMap((stack) =>
      GLYPH_RANGES.map((range): [string, string] => [
        `glyphs/${stack}/${range}.pbf`,
        style.glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range),
      ]),
    ),
  ]
  for (const [key, url] of files) await putAsset(key, await fetchBuffer(url, signal))
  // Written last, so an interrupted download fetches the whole set again next time.
  await putAsset('style.json', styleData)
}

/**
 * Downloads the box zoom level by zoom level, so if the size cap is reached the area keeps
 * every complete level below it and simply shows less detail.
 */
export async function downloadArea(
  target: { name: string; path: string[]; bbox: BBox },
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<OfflineArea> {
  const plan = planDownload(target.bbox)
  await navigator.storage?.persist?.().catch(() => false)
  await ensureStyleAssets(signal)
  const template: string = parseJson(await fetchBuffer(TILEJSON_URL, signal)).tiles[0]

  const id = crypto.randomUUID()
  let done = 0
  let bytes = 0
  let maxzoom = plan.maxzoom
  try {
    for (let z = 0; z <= plan.maxzoom; z++) {
      const { x0, x1, y0, y1 } = tileRange(target.bbox, z)
      const queue: [number, number][] = []
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) queue.push([x, y])

      const before = { done, bytes }
      let pending: [string, ArrayBuffer][] = []
      let tooBig = false
      const worker = async () => {
        for (let next = queue.pop(); next && !tooBig; next = queue.pop()) {
          const [x, y] = next
          const url = template.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`)
          const res = await fetch(url, { signal })
          // Open sea and other empty places have no tile.
          if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(`Download failed (HTTP ${res.status}).`)
          const data = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0)
          bytes += data.byteLength
          done++
          tooBig = bytes > MAX_BYTES
          pending.push([`${id}/${z}/${x}/${y}`, data])
          if (pending.length >= 50) {
            const batch = pending
            pending = []
            await putTiles(batch)
          }
          onProgress({ done, total: plan.tiles, bytes })
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, worker))
      if (tooBig) {
        await deleteTiles(`${id}/${z}/`)
        ;({ done, bytes } = before)
        maxzoom = z - 1
        break
      }
      await putTiles(pending)
    }
  } catch (err) {
    await deleteTiles(`${id}/`)
    throw err
  }

  const area: OfflineArea = {
    id,
    name: target.name,
    path: target.path,
    bbox: target.bbox,
    maxzoom,
    tiles: done,
    bytes,
    createdAt: Date.now(),
  }
  await saveArea(area)
  return area
}
