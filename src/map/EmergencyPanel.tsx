import { useEffect, useState } from 'react'
import { Share } from '@capacitor/share'
import { copyText } from '../clipboard'

export interface Position {
  lon: number
  lat: number
  /** Metres, as the device reports it. */
  accuracy: number
  altitude: number | null
}

export type HelpKind = 'hospital' | 'police' | 'fire'

interface EmergencyPanelProps {
  position: Position | null
  onLocate: () => void
  onFindNearest: (kind: HelpKind) => void
  onClose: () => void
}

// The international emergency number: phone networks in most countries connect 112 from a mobile
// phone to the local emergency services. Calls are free and need mobile signal, not internet.
const EMERGENCY_NUMBER = '112'

const HELP: [HelpKind, string][] = [
  ['hospital', 'Hospital'],
  ['police', 'Police'],
  ['fire', 'Fire station'],
]

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Compass heading in degrees from the phone's sensors, or null where there are none (most computers). */
function useHeading() {
  const [heading, setHeading] = useState<number | null>(null)
  useEffect(() => {
    const onTurn = (event: Event) => {
      const { absolute, alpha } = event as DeviceOrientationEvent
      if (!absolute || alpha === null) return
      // Rounded, so the panel redraws a few times a second instead of on every sensor reading.
      const next = Math.round((360 - alpha) / 5) * 5 % 360
      setHeading((current) => (current === next ? current : next))
    }
    window.addEventListener('deviceorientationabsolute', onTurn)
    return () => window.removeEventListener('deviceorientationabsolute', onTurn)
  }, [])
  return heading
}

function locationMessage(p: Position) {
  const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
  const link = `https://www.google.com/maps?q=${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
  return `My location: ${coords} (accurate to about ${Math.round(p.accuracy)} m)\n${link}`
}

export default function EmergencyPanel({ position, onLocate, onFindNearest, onClose }: EmergencyPanelProps) {
  const heading = useHeading()
  const [copied, setCopied] = useState(false)
  const message = position && locationMessage(position)

  async function share() {
    if (!message) return
    try {
      if ((await Share.canShare()).value) return void (await Share.share({ text: message }))
    } catch {
      // Dismissed or unavailable; copying is the fallback.
    }
    copy()
  }

  async function copy() {
    if (message && (await copyText(message))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="emergency">
      <div className="emergency-head">
        <h3>Emergency</h3>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>

      <section aria-labelledby="emergency-numbers">
        <h4 id="emergency-numbers">Call for help</h4>
        <a className="sos-call" href={`tel:${EMERGENCY_NUMBER}`}>
          <strong>{EMERGENCY_NUMBER}</strong>
          <span>Emergency: police, ambulance, fire</span>
        </a>
        <p className="muted small">
          From a mobile phone, 112 reaches the emergency services in most countries. The call is free and needs mobile
          signal, not internet. If it does not connect, call your country's own emergency number.
        </p>
      </section>

      <section aria-labelledby="emergency-nearest">
        <h4 id="emergency-nearest">Nearest help, with directions</h4>
        <div className="sos-help">
          {HELP.map(([kind, label]) => (
            <button key={kind} className="btn ghost" onClick={() => onFindNearest(kind)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="emergency-location">
        <h4 id="emergency-location">My location</h4>
        {position ? (
          <>
            <p className="sos-coords">
              <strong>
                {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
              </strong>
              <span>
                Accurate to about {Math.round(position.accuracy)} m
                {position.altitude !== null && ` · altitude about ${Math.round(position.altitude)} m`}
              </span>
            </p>
            {heading !== null && (
              <p className="sos-compass">
                <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" style={{ transform: `rotate(${-heading}deg)` }}>
                  <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                  <path d="M20 5 L25 20 L15 20 Z" fill="var(--danger)" />
                  <path d="M20 35 L25 20 L15 20 Z" fill="currentColor" fillOpacity="0.35" />
                </svg>
                <span>
                  Facing {COMPASS[Math.round(heading / 45) % 8]} ({heading}°). The red tip points north.
                </span>
              </p>
            )}
            <div className="sos-share">
              <button className="btn primary" onClick={share}>
                Share location
              </button>
              <a className="btn ghost" href={`sms:?body=${encodeURIComponent(message!)}`}>
                Send by SMS
              </a>
              <button className="btn ghost" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="muted small">An SMS works without internet. The link opens the spot in a map app.</p>
          </>
        ) : (
          <>
            <p className="muted">Finding your location… Allow location access and turn on GPS.</p>
            <button className="btn ghost" onClick={onLocate}>
              Locate me
            </button>
          </>
        )}
      </section>
    </div>
  )
}
