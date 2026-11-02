import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { FileSource, PMTiles, Protocol } from 'pmtiles'
import { ArrowLeftIcon } from '../icons'
import { REGIONS, type MapRegion } from './regions'

// MapLibre 6 looks for its worker next to its own module, which bundling breaks.
setWorkerUrl(workerUrl)

const protocol = new Protocol()
addProtocol('pmtiles', protocol.tile)

const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>'

const assetUrl = (path: string) => new URL(path, document.baseURI).href

const archives = new Map<string, Promise<void>>()

/**
 * Reads the whole map pack into memory and serves tiles from it. The Android app's local
 * server ignores Range requests (it always sends the file from the start), so streaming the
 * archive with HTTP ranges would return the wrong bytes there.
 */
function loadArchive(region: MapRegion): Promise<void> {
  let promise = archives.get(region.id)
  if (!promise) {
    promise = fetch(assetUrl(`maps/${region.id}.pmtiles`)).then(async (res) => {
      if (!res.ok) throw new Error(`The ${region.name} map data is missing from this build.`)
      const file = new File([await res.blob()], `${region.id}.pmtiles`)
      protocol.add(new PMTiles(new FileSource(file)))
    })
    promise.catch(() => archives.delete(region.id))
    archives.set(region.id, promise)
  }
  return promise
}

export default function MapView({ onBack }: { onBack: () => void }) {
  const region = REGIONS[0]
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let map: MapLibreMap | undefined
    let cancelled = false
    const flavor = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const [west, south, east, north] = region.bbox

    loadArchive(region)
      .then(() => {
        if (cancelled || !containerRef.current) return
        map = new MapLibreMap({
          container: containerRef.current,
          style: {
            version: 8,
            glyphs: `${assetUrl('map-assets/fonts/')}{fontstack}/{range}.pbf`,
            sprite: assetUrl(`map-assets/sprites/${flavor}`),
            sources: {
              protomaps: { type: 'vector', url: `pmtiles://${region.id}.pmtiles`, attribution: ATTRIBUTION },
            },
            layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
          },
          bounds: [west, south, east, north],
          maxBounds: [west - 0.05, south - 0.05, east + 0.05, north + 0.05],
          minZoom: 10,
          maxZoom: 19,
          attributionControl: false,
        })
        map.addControl(new AttributionControl({ compact: true }))
        map.addControl(new NavigationControl(), 'top-right')
        map.addControl(new ScaleControl(), 'bottom-left')

        const geolocate = new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        })
        geolocate.on('geolocate', () => setMessage(null))
        // Fired instead of 'geolocate' when the position is outside the map's maxBounds.
        geolocate.on('outofmaxbounds', () => setMessage(`You are outside the ${region.name} map area.`))
        geolocate.on('error', () => setMessage('Location is unavailable. Allow location access and turn on GPS.'))
        map.addControl(geolocate, 'top-right')
        map.once('load', () => setReady(true))
      })
      .catch((err: Error) => {
        if (!cancelled) setMessage(err.message)
      })

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [region])

  return (
    <div className="map-layout">
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="topbar-start">
            <button className="icon-btn" aria-label="Back" title="Back" onClick={onBack}>
              <ArrowLeftIcon />
            </button>
            <div className="map-title">
              <strong>Offline map</strong>
              <span>{region.name}</span>
            </div>
          </div>
          <span className="badge">Works offline</span>
        </div>
      </header>
      <div className="map-area">
        <div ref={containerRef} className="map-canvas" />
        {!ready && !message && <p className="map-overlay">Loading map…</p>}
        {message && (
          <p className="map-overlay" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
