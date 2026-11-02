import { useEffect, useState } from 'react'
import { checkNetwork, runDeviceChecks, type DeviceCheck } from './deviceCheck'

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

function CheckItem({ check }: { check: DeviceCheck }) {
  return (
    <li className="check">
      <span className={`dot ${check.status}`} aria-hidden="true" />
      <div className="check-head">
        <span className="check-label">{check.label}</span>
        <span className="check-value">{check.value}</span>
      </div>
      <p className="check-note">{check.note}</p>
    </li>
  )
}

export default function DeviceChecks() {
  const [checks, setChecks] = useState<DeviceCheck[] | null>(null)
  const online = useOnline()

  useEffect(() => {
    runDeviceChecks().then(setChecks)
  }, [])

  if (!checks) return <p className="section-intro">Checking your device…</p>
  return (
    <ul className="checks">
      {[...checks, checkNetwork(online)].map((c) => (
        <CheckItem check={c} key={c.id} />
      ))}
    </ul>
  )
}
