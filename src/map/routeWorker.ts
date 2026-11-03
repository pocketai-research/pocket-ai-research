// Builds the road network and searches it off the main thread, so the map stays responsive.
import { computeRoute, RouteError, type RouteRequest } from './route'

self.onmessage = (event: MessageEvent<RouteRequest>) => {
  try {
    self.postMessage({ route: computeRoute(event.data) })
  } catch (err) {
    const message = err instanceof RouteError ? err.message : `Directions failed: ${err instanceof Error ? err.message : String(err)}`
    self.postMessage({ error: message })
  }
}
