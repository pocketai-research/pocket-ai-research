import { useEffect, useRef, useState } from 'react'
import { describeError, generateReply, isAbortError } from '../ai/engine'
import Markdown from '../Markdown'
import type { ReplySettings } from '../settings'
import type { OfflineArea } from './offlineStore'
import { describeQuery, formatDistance, parseQuery, placesContext, searchPlaces, type Place } from './places'

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
}

const EXAMPLES = ['Nearest hospital', 'Masjid terdekat', 'Where can I get petrol?', 'ATM near me']

interface Results {
  title: string
  places: Place[]
  radius: number
  origin: SearchOrigin
  coarse: boolean
}

export default function SearchPanel({ area, online, ai, getOrigin, onResults, onFocus }: SearchPanelProps) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [answer, setAnswer] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  async function run(question: string) {
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
    setBusy(true)
    setError(null)
    setAnswer('')
    try {
      const { places, radius, zoom } = await searchPlaces(query, origin.point, area)
      if (controller.signal.aborted) return
      setResults({ title: describeQuery(query), places, radius, origin, coarse: zoom < 14 })
      onResults(places, origin)
      if (ai.ready) {
        await generateReply(
          [{ role: 'user', content: question }],
          { reply: ai.reply, context: placesContext(query, places, origin.label) },
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
                <button onClick={() => onFocus(place)}>
                  <span className="place-rank">{i + 1}</span>
                  <span className="place-info">
                    <strong>{place.name}</strong>
                    <small>
                      {place.kind.replace(/_/g, ' ')} · {formatDistance(place.distance)} {place.direction}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}
