import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { ArrowLeftIcon } from '../icons'
import { STYLE_URL } from './download'
import type { BBox } from './geo'
import { offlineStyle } from './offlineMap'
import { listAreas, type OfflineArea } from './offlineStore'
import type { Place } from './places'
import type { Route } from './route'
import RegionPanel from './RegionPanel'
import type { SearchOrigin } from './SearchPanel'
import type { ReplySettings } from '../settings'

// MapLibre 6 looks for its worker next to its own module, which bundling breaks.
setWorkerUrl(workerUrl)

type Mode = { kind: 'online' } | { kind: 'offline'; area: OfflineArea }

const pad = ([w, s, e, n]: BBox, d: number): BBox => [w - d, s - d, e + d, n + d]

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Dashed outline of the selected region's box, which is also what a download covers. */
function showOutline(map: MapLibreMap, bbox: BBox) {
  const [w, s, e, n] = bbox
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  }
  const source = map.getSource('selection') as GeoJSONSource | undefined
  if (source) return source.setData(data)
  map.addSource('selection', { type: 'geojson', data })
  map.addLayer({
    id: 'selection-outline',
    type: 'line',
    source: 'selection',
    paint: { 'line-color': '#0f766e', 'line-width': 2, 'line-dasharray': [2, 2] },
  })
}

/**
 * Runs draw once the map can take new sources and layers. isStyleLoaded() is also false while
 * tiles are loading (after a move, for example), when 'load' has long fired, so wait for 'idle'.
 */
function whenReady(map: MapLibreMap, draw: () => void) {
  if (map.isStyleLoaded()) draw()
  else map.once('idle', draw)
}

const panelHeight = () => document.querySelector('.region-panel')?.getBoundingClientRect().height ?? 0

/** Numbered dots for search results. */
function showPlaces(map: MapLibreMap, places: Place[]) {
  const data = {
    type: 'FeatureCollection' as const,
    features: places.map((place, i) => ({
      type: 'Feature' as const,
      properties: { rank: String(i + 1) },
      geometry: { type: 'Point' as const, coordinates: [place.lon, place.lat] },
    })),
  }
  const source = map.getSource('search-results') as GeoJSONSource | undefined
  if (source) return source.setData(data)
  map.addSource('search-results', { type: 'geojson', data })
  map.addLayer({
    id: 'search-results-dot',
    type: 'circle',
    source: 'search-results',
    paint: { 'circle-radius': 11, 'circle-color': '#0f766e', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  })
  map.addLayer({
    id: 'search-results-rank',
    type: 'symbol',
    source: 'search-results',
    layout: { 'text-field': ['get', 'rank'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  })
}

/** The route as a line under the result dots, with a white casing so it shows on any road colour. */
function showRoute(map: MapLibreMap, route: Route | null) {
  const data = {
    type: 'FeatureCollection' as const,
    features: route
      ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route.line } }]
      : [],
  }
  const source = map.getSource('route') as GeoJSONSource | undefined
  if (source) return source.setData(data)
  map.addSource('route', { type: 'geojson', data })
  const below = map.getLayer('search-results-dot') ? 'search-results-dot' : undefined
  const layout = { 'line-join': 'round' as const, 'line-cap': 'round' as const }
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout, paint: { 'line-color': '#ffffff', 'line-width': 9 } }, below)
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout, paint: { 'line-color': '#2563eb', 'line-width': 5 } }, below)
}

interface MapViewProps {
  onBack: () => void
  /** Whether an AI model is open, for written answers to place searches. */
  ai: { ready: boolean; reply: ReplySettings }
}

export default function MapView({ onBack, ai }: MapViewProps) {
  const positionRef = useRef<[number, number] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const online = useOnline()
  const [areas, setAreas] = useState<OfflineArea[]>([])
  const [mode, setMode] = useState<Mode | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refreshAreas = () => listAreas().then(setAreas)

  // Start online, or on the newest offline area when there is no connection.
  useEffect(() => {
    listAreas().then((list) => {
      setAreas(list)
      setMode(!navigator.onLine && list.length ? { kind: 'offline', area: list[0] } : { kind: 'online' })
    })
  }, [])

  useEffect(() => {
    if (!mode) return
    let map: MapLibreMap | undefined
    let cancelled = false
    setMessage(null)

    const create = async () => {
      const style = mode.kind === 'online' ? STYLE_URL : await offlineStyle(mode.area)
      if (cancelled || !containerRef.current) return
      map = new MapLibreMap({
        container: containerRef.current,
        style,
        maxZoom: 19,
        attributionControl: false,
        ...(mode.kind === 'offline'
          ? { bounds: mode.area.bbox, maxBounds: pad(mode.area.bbox, 0.2) }
          : { center: [110, 0], zoom: 1.5 }),
      })
      mapRef.current = map
      // Top-left, because the region panel covers the bottom of the map. Attribution is required.
      map.addControl(new AttributionControl({ compact: true }), 'top-left')
      map.addControl(new ScaleControl(), 'top-left')
      map.addControl(new NavigationControl(), 'top-right')

      const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true })
      geolocate.on('geolocate', (event) => {
        positionRef.current = [event.coords.longitude, event.coords.latitude]
        setMessage(null)
      })
      // Fired instead of 'geolocate' when the position is outside the offline area's bounds.
      geolocate.on('outofmaxbounds', () =>
        setMessage(mode.kind === 'offline' ? `You are outside the ${mode.area.name} offline map.` : null),
      )
      geolocate.on('error', () => setMessage('Location is unavailable. Allow location access and turn on GPS.'))
      map.addControl(geolocate, 'top-right')
    }
    create().catch((err: Error) => !cancelled && setMessage(err.message))

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [mode])

  function select(bbox: BBox) {
    const map = mapRef.current
    if (!map || mode?.kind !== 'online') return
    const panel = document.querySelector('.region-panel')?.getBoundingClientRect().height ?? 0
    map.fitBounds(bbox, { padding: { top: 40, left: 40, right: 60, bottom: panel + 20 }, maxZoom: 14 })
    whenReady(map, () => showOutline(map, bbox))
  }

  /** Searches start from the GPS position once it is known, otherwise from the map centre. */
  function getOrigin(): SearchOrigin | null {
    if (positionRef.current) return { point: positionRef.current, label: 'your location' }
    const center = mapRef.current?.getCenter()
    return center ? { point: [center.lng, center.lat], label: 'the map centre' } : null
  }

  function showResults(places: Place[], origin: SearchOrigin) {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => showPlaces(map, places))
    if (!places.length) return
    const lons = [origin.point[0], ...places.map((p) => p.lon)]
    const lats = [origin.point[1], ...places.map((p) => p.lat)]
    map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
      padding: { top: 60, left: 40, right: 60, bottom: panelHeight() + 30 },
      maxZoom: 16,
    })
  }

  function drawRoute(route: Route | null) {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => showRoute(map, route))
    if (!route) return
    const lons = route.line.map(([lon]) => lon)
    const lats = route.line.map(([, lat]) => lat)
    map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
      padding: { top: 60, left: 40, right: 60, bottom: panelHeight() + 30 },
      maxZoom: 17,
    })
  }

  function focusPlace(place: Place) {
    mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 16, padding: { top: 0, left: 0, right: 0, bottom: panelHeight() } })
  }

  function visibleBBox(): BBox | null {
    const bounds = mapRef.current?.getBounds()
    return bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null
  }

  const status = mode?.kind === 'offline' ? `Offline · ${mode.area.name}` : online ? 'Online map' : 'No connection'

  return (
    <div className="map-layout">
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="topbar-start">
            <button className="icon-btn" aria-label="Back" title="Back" onClick={onBack}>
              <ArrowLeftIcon />
            </button>
            <div className="map-title">
              <strong>Map</strong>
              <span>{status}</span>
            </div>
          </div>
          <span className="badge">{mode?.kind === 'offline' ? 'Offline' : 'Online'}</span>
        </div>
      </header>
      <div className="map-area">
        <div ref={containerRef} className="map-canvas" />
        {(message || (mode?.kind === 'online' && !online)) && (
          <p className="map-overlay" role="status">
            {message ?? 'You are offline. Open one of your offline areas below.'}
          </p>
        )}
        <RegionPanel
          areas={areas}
          viewingAreaId={mode?.kind === 'offline' ? mode.area.id : null}
          online={online}
          onSelect={select}
          onViewOffline={(area) => setMode({ kind: 'offline', area })}
          onViewOnline={() => setMode({ kind: 'online' })}
          onAreasChange={refreshAreas}
          visibleBBox={visibleBBox}
          ai={ai}
          getOrigin={getOrigin}
          onResults={showResults}
          onFocus={focusPlace}
          onRoute={drawRoute}
        />
      </div>
    </div>
  )
}
