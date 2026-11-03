import { addProtocol } from 'maplibre-gl'
import { getAsset, getTile, type OfflineArea } from './offlineStore'

const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

/**
 * Serves offline map files from IndexedDB:
 *   offline://tile/<areaId>/<z>/<x>/<y>, offline://glyphs/<fontstack>/<range>.pbf,
 *   offline://sprite/ofm(.json|.png|@2x.json|@2x.png)
 */
addProtocol('offline', async (params) => {
  const [kind, ...rest] = params.url.slice('offline://'.length).split('/')
  const key = kind === 'tile' ? rest.join('/') : `${kind}/${rest.map(decodeURIComponent).join('/')}`
  const data = kind === 'tile' ? await getTile(key) : await getAsset(key)
  if (!data) {
    if (kind === 'sprite') throw new Error(`The offline map is missing ${key}.`)
    // A tile outside the downloaded zoom levels, or a glyph range for another script: draw nothing.
    return { data: new ArrayBuffer(0) }
  }
  return { data: params.type === 'json' ? JSON.parse(new TextDecoder().decode(data)) : data }
})

/** The online style, pointed at the area's tiles and the cached sprite and glyphs. */
export async function offlineStyle(area: OfflineArea) {
  const raw = await getAsset('style.json')
  if (!raw) throw new Error('The offline map style is missing. Download the area again.')
  const style = JSON.parse(new TextDecoder().decode(raw))
  style.sources = {
    openmaptiles: {
      type: 'vector',
      tiles: [`offline://tile/${area.id}/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: area.maxzoom,
      bounds: area.bbox,
      attribution: ATTRIBUTION,
    },
  }
  // Drops the shaded-relief raster layer, which is not downloaded.
  style.layers = style.layers.filter((layer: { source?: string }) => !layer.source || layer.source === 'openmaptiles')
  style.glyphs = 'offline://glyphs/{fontstack}/{range}.pbf'
  style.sprite = 'offline://sprite/ofm'
  return style
}
