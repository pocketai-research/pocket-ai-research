import { formatDistance, type Place } from './places'
import { planRoute, readTiles, RouteError, type Route, type TileSource, type TravelMode } from './route'

/**
 * Directions between two [lon, lat] points. The tiles are read here (IndexedDB or network);
 * building and searching the road network runs in a worker. maxZoom is the deepest zoom level
 * the source has (an offline area may stop below 14).
 */
export async function findRoute(
  from: [number, number],
  to: [number, number],
  destination: string,
  mode: TravelMode,
  source: TileSource,
  maxZoom: number,
  signal: AbortSignal,
): Promise<Route> {
  const plan = planRoute(from, to, maxZoom)
  const tiles = await readTiles(source, plan.zoom, plan.box)
  signal.throwIfAborted()
  const worker = new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Route>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ route?: Route; error?: string }>) =>
        data.route ? resolve(data.route) : reject(new RouteError(data.error))
      worker.onerror = (event) => reject(new RouteError(`Directions failed: ${event.message}`))
      signal.addEventListener('abort', () => reject(signal.reason))
      // Copied rather than transferred: online tiles stay cached for place searches.
      worker.postMessage({ from, to, destination, mode, zoom: plan.zoom, snapMetres: plan.snapMetres, tiles })
    })
  } finally {
    worker.terminate()
  }
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const travelLabel = (mode: TravelMode) => (mode === 'walk' ? 'on foot' : 'by car or motorbike')

/** Facts for the AI, so it explains the route the map found instead of inventing one. */
export function routeContext(route: Route, place: Place, originLabel: string) {
  return [
    `Route from ${originLabel} to ${place.name} (${place.kind.replace(/_/g, ' ')}) ${travelLabel(route.mode)}: ` +
      `${formatDistance(route.distance)}, about ${formatDuration(route.duration)}.`,
    'Steps:',
    ...route.steps.map((step, i) => `${i + 1}. ${step.text}${step.distance ? ` (${formatDistance(step.distance)})` : ''}`),
    `The destination is ${place.name}. Street and place names are only those written in these steps; ` +
      'words from the question (such as "on foot" or "nearest") are not names.',
    'Explain the way there in a few short sentences, using only these steps. Never invent roads, landmarks or turns.',
  ].join('\n')
}
