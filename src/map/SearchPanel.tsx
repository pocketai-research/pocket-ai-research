import { useEffect, useRef, useState } from 'react'
import { describeError, generateReply, isAbortError } from '../ai/engine'
import { RouteIcon } from '../icons'
import Markdown from '../Markdown'
import type { ReplySettings } from '../settings'
import { findRoute, formatDuration, routeContext, travelLabel } from './directions'
import type { OfflineArea } from './offlineStore'
import { describeQuery, formatDistance, loadTile, parseQuery, placesContext, searchPlaces, type Place } from './places'
import type { Route, TravelMode } from './route'

export interface SearchOrigin {
  point: [number, number]
  /** "your location" or "the map centre". */
  label: string
}

interface SearchPanelProps {
  area: OfflineArea | null
  online: boolean
  ai: { ready: boolean; reply: ReplySettings }
  getOrigin: () => SearchOrigin | null
  onResults: (places: Place[], origin: SearchOrigin) => void
  onFocus: (place: Place) => void
  /** Draws the route on the map, or clears it. */
  onRoute: (route: Route | null) => void
  /** A search asked for from outside the panel (the emergency buttons); a new id runs it. */
  request: SearchRequest | null
}

export interface SearchRequest {
  id: number
  question: string
  /** Also write an AI answer (skipped for emergencies, where every second counts). */
  ai: boolean
}

const EXAMPLES = ['Nearest hospital', 'Masjid terdekat', 'Rute ke SPBU terdekat', 'ATM near me']

interface Results {
  title: string
  places: Place[]
  radius: number
  origin: SearchOrigin
  coarse: boolean
}

interface Directions {
  place: Place
  origin: SearchOrigin
  mode: TravelMode
  route?: Route
  error?: string
}

export default function SearchPanel({ area, online, ai, getOrigin, onResults, onFocus, onRoute, request }: SearchPanelProps) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [answer, setAnswer] = useState('')
  const [directions, setDirections] = useState<Directions | null>(null)
  const [travelMode, setTravelMode] = useState<TravelMode>('drive')
  const controllerRef = useRef<AbortController | null>(null)
  const routeControllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      routeControllerRef.current?.abort()
    },
    [],
  )

  /** Finds and shows the way to a place; resolves to the route, or null when there is none. */
  async function showDirections(place: Place, origin: SearchOrigin, mode: TravelMode): Promise<Route | null> {
    routeControllerRef.current?.abort()
    const controller = new AbortController()
    routeControllerRef.current = controller
    setTravelMode(mode)
    setDirections({ place, origin, mode })
    onRoute(null)
    try {
      const route = await findRoute(
        origin.point,
        [place.lon, place.lat],
        place.name,
        mode,
        (z, x, y) => loadTile(area, z, x, y),
        area ? area.maxzoom : 14,
        controller.signal,
      )
      if (controller.signal.aborted) return null
      setDirections({ place, origin, mode, route })
      onRoute(route)
      return route
    } catch (err) {
      if (!controller.signal.aborted) setDirections({ place, origin, mode, error: err instanceof Error ? err.message : String(err) })
      return null
    } finally {
      if (routeControllerRef.current === controller) routeControllerRef.current = null
    }
  }

  function closeDirections() {
    routeControllerRef.current?.abort()
    setDirections(null)
    onRoute(null)
  }

  useEffect(() => {
    if (!request) return
    setInput(request.question)
    run(request.question, request.ai)
    // Runs once per request; run itself changes on every render.
  }, [request?.id])

  async function run(question: string, withAi = true) {
    const query = parseQuery(question)
    if (!query.category && !query.text) return
    const origin = getOrigin()
    if (!origin) return
    if (!area && !online) {
      setError('You are offline. Open one of your offline areas first.')
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    closeDirections()
    setBusy(true)
    setError(null)
    setAnswer('')
    try {
      const { places, radius, zoom } = await searchPlaces(query, origin.point, area)
      if (controller.signal.aborted) return
      setResults({ title: describeQuery(query), places, radius, origin, coarse: zoom < 14 })
      onResults(places, origin)
      let context = placesContext(query, places, origin.label)
      // "Route to the nearest hospital": directions to the first place, and the AI explains them.
      if (query.route && places[0]) {
        const route = await showDirections(places[0], origin, query.walk ? 'walk' : travelMode)
        if (controller.signal.aborted) return
        if (route) context = routeContext(route, places[0], origin.label)
      }
      if (ai.ready && withAi) {
        await generateReply(
          [{ role: 'user', content: question }],
          { reply: ai.reply, context },
          (piece) => setAnswer((text) => text + piece),
          controller.signal,
        )
      }
    } catch (err) {
      if (!isAbortError(err) && !controller.signal.aborted) setError(describeError(err))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusy(false)
      }
    }
  }

  const directionsView = directions && (
    <div className="directions">
      <button className="link" onClick={closeDirections}>
        ← Back to the list
      </button>
      <h3 className="list-title">To {directions.place.name}</h3>
      <div className="mode-switch" role="group" aria-label="Travel mode">
        {(['drive', 'walk'] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={directions.mode === mode}
            onClick={() => directions.mode !== mode && showDirections(directions.place, directions.origin, mode)}
          >
            {mode === 'walk' ? 'Walk' : 'Car or motorbike'}
          </button>
        ))}
      </div>
      {!directions.route && !directions.error && <p className="muted">Finding a route…</p>}
      {directions.error && <p className="alert">{directions.error}</p>}
      {directions.route && (
        <>
          <p className="route-summary">
            <strong>About {formatDuration(directions.route.duration)}</strong> {travelLabel(directions.route.mode)} ·{' '}
            {formatDistance(directions.route.distance)} from {directions.origin.label}
          </p>
          {directions.route.mainRoadsOnly && (
            <p className="muted small">The map data here has only bigger roads, so this route is rough.</p>
          )}
          <ol className="route-steps">
            {directions.route.steps.map((step, i) => (
              <li key={i}>
                <span>{step.text}</span>
                {step.distance > 0 && <small>{formatDistance(step.distance)}</small>}
              </li>
            ))}
          </ol>
          <p className="muted small">
            Worked out on this device from the map data. It does not know about traffic, turn restrictions or closed
            roads, so follow road signs.
          </p>
        </>
      )}
    </div>
  )

  return (
    <>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault()
          run(input)
        }}
      >
        <input
          className="panel-search"
          type="search"
          placeholder="Search places or ask, e.g. nearest hospital"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Search places"
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Go'}
        </button>
      </form>

      {!results && !busy && (
        <div className="suggestions start">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="suggestion"
              onClick={() => {
                setInput(example)
                run(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {error && <p className="alert">{error}</p>}
      {busy && !results && <p className="muted">Searching the map…</p>}

      {results && (
        <>
          {(answer || (busy && ai.ready)) && (
            <div className="answer-card">
              <strong>AI answer</strong>
              {answer ? <Markdown text={answer} /> : <span className="thinking">Thinking…</span>}
            </div>
          )}
          {!ai.ready && (
            <p className="muted small">Open an AI model from the start page to also get a written answer.</p>
          )}
          {directionsView ?? (
            <>
              <h3 className="list-title">
                {results.places.length ? `${results.title} near ${results.origin.label}` : `No ${results.title} found`}
              </h3>
              {!results.places.length && (
                <p className="muted">
                  Nothing within {formatDistance(results.radius)} of {results.origin.label}.
                  {area ? ' The place may be outside this offline area.' : ''}
                </p>
              )}
              {results.coarse && (
                <p className="muted small">This offline area has less detail, so smaller places may be missing.</p>
              )}
              <ol className="place-list">
                {results.places.map((place, i) => (
                  <li key={`${place.name}-${i}`}>
                    <button className="place-main" onClick={() => onFocus(place)}>
                      <span className="place-rank">{i + 1}</span>
                      <span className="place-info">
                        <strong>{place.name}</strong>
                        <small>
                          {place.kind.replace(/_/g, ' ')} · {formatDistance(place.distance)} {place.direction}
                        </small>
                      </span>
                    </button>
                    <button
                      className="place-go"
                      aria-label={`Directions to ${place.name}`}
                      title="Directions"
                      onClick={() => showDirections(place, results.origin, travelMode)}
                    >
                      <RouteIcon />
                      Go
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </>
  )
}
