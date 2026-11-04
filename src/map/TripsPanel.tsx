import { useEffect, useState, useSyncExternalStore } from 'react'
import { TrashIcon } from '../icons'
import { deleteTrip, listTrips, type Trip } from './offlineStore'
import { formatDistance } from './places'
import { exportGpx, formatDuration, getRecorderState, startRecording, stopRecording, subscribeRecorder } from './tripRecorder'

interface TripsPanelProps {
  /** Draws a saved trip on the map and fits the view to it. */
  onShowTrip: (trip: Trip) => void
}

const speed = (trip: Trip) => {
  const hours = (trip.endedAt - trip.startedAt) / 3_600_000
  return hours > 0 ? `${(trip.distance / 1000 / hours).toFixed(1)} km/h` : '–'
}

export default function TripsPanel({ onShowTrip }: TripsPanelProps) {
  const recorder = useSyncExternalStore(subscribeRecorder, getRecorderState)
  const [trips, setTrips] = useState<Trip[]>([])
  const [now, setNow] = useState(Date.now())
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => listTrips().then(setTrips)
  useEffect(() => {
    refresh()
  }, [])

  // The clock ticks while recording, even when no new position arrives.
  useEffect(() => {
    if (!recorder.recording) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [recorder.recording])

  async function stop() {
    const trip = await stopRecording()
    setNotice(trip ? `Saved: ${trip.name}` : 'Nothing was recorded: no GPS position came in.')
    refresh()
  }

  async function remove(trip: Trip) {
    if (!confirm(`Delete ${trip.name}?`)) return
    await deleteTrip(trip.id)
    refresh()
  }

  async function exportTrip(trip: Trip) {
    try {
      await exportGpx(trip)
    } catch (err) {
      setNotice(`The GPX file could not be shared: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const live = recorder.trip
  return (
    <div className="trips">
      {live ? (
        <section className="trip-live" aria-label="Recording">
          <p className="trip-recording">
            <span className="trip-dot" aria-hidden="true" /> Recording {live.name}
          </p>
          <dl className="trip-stats">
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(now - live.startedAt)}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{formatDistance(live.distance)}</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{live.points.length > 1 ? speed({ ...live, endedAt: now }) : '–'}</dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>{Math.round(live.climb)} m</dd>
            </div>
          </dl>
          <p className="muted small">
            {recorder.error ??
              (recorder.accuracy !== null ? `GPS accurate to about ${Math.round(recorder.accuracy)} m · ${live.points.length} points` : 'Finding your position…')}
          </p>
          <button className="btn primary" onClick={stop}>
            Stop and save
          </button>
          <p className="muted small">Keep the app open: the screen stays on while recording. With the screen off, the phone stops sending positions.</p>
        </section>
      ) : (
        <section className="trip-start">
          <p className="muted">Record a walk, a hike or a ride with GPS: distance, time, speed and climb, drawn on the map and kept on this device. Works offline.</p>
          <button className="btn primary" onClick={() => (setNotice(null), startRecording())}>
            Start recording
          </button>
          {recorder.error && <p className="alert">{recorder.error}</p>}
        </section>
      )}
      {notice && <p className="muted small" role="status">{notice}</p>}

      <h3 className="list-title">Saved trips</h3>
      {trips.length === 0 ? (
        <p className="muted small">No trips yet.</p>
      ) : (
        <ul className="area-list">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button className="area-info note-open" onClick={() => onShowTrip(trip)}>
                <strong>{trip.name}</strong>
                <small>
                  {formatDistance(trip.distance)} · {formatDuration(trip.endedAt - trip.startedAt)} · {speed(trip)}
                  {trip.climb ? ` · climb ${Math.round(trip.climb)} m` : ''}
                </small>
              </button>
              <button className="btn ghost small-btn" onClick={() => exportTrip(trip)}>
                GPX
              </button>
              <button className="icon-btn" aria-label={`Delete ${trip.name}`} onClick={() => remove(trip)}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
