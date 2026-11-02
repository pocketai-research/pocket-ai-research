import { useEffect, useState } from 'react'
import { checkNetwork, runDeviceChecks, type DeviceCheck } from './deviceCheck'

const REPO_URL = 'https://github.com/sanadaryuki10-lgtm/pocket-ai-research'

const features = [
  { title: 'Works offline', text: 'Download a model once. After that, chat anywhere, even in airplane mode.' },
  { title: 'Private by design', text: 'The AI runs on your device. Your messages are never sent to a server.' },
  { title: 'Free to use', text: 'No account, no subscription, no API key.' },
  { title: 'Installable', text: 'Add it to your desktop or home screen and open it like an app.' },
]

const roadmap = [
  { phase: 'Phase 1', title: 'Project setup and automatic deployment', done: true },
  { phase: 'Phase 2', title: 'On-device AI chat with a model picker', done: false },
  { phase: 'Phase 3', title: 'Offline mode and saved conversations', done: false },
  { phase: 'Phase 4', title: 'Custom domain and mobile polish', done: false },
  { phase: 'Phase 5', title: 'Ask your documents, task templates, voice input', done: false },
]

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

export default function App() {
  const [checks, setChecks] = useState<DeviceCheck[] | null>(null)
  const online = useOnline()

  useEffect(() => {
    runDeviceChecks().then(setChecks)
  }, [])

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
            <span>Pocket AI Research</span>
          </div>
          <span className="badge">Preview v0.1</span>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <p className="eyebrow">Offline AI that runs in your browser</p>
          <h1>An AI assistant that lives in your pocket.</h1>
          <p className="lead">
            Pocket AI Research runs a language model directly in your browser. Download it once, then chat any
            time with no internet, no account, and no data leaving your device.
          </p>
          <p className="notice">The chat is in development and arrives in Phase 2.</p>
        </section>

        <section className="section">
          <h2>Why on-device?</h2>
          <p className="section-intro">Everything happens on your own laptop or phone.</p>
          <div className="grid">
            {features.map((f) => (
              <article className="card" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>Is my device ready?</h2>
          <p className="section-intro">This check runs locally in your browser. Nothing is uploaded.</p>
          {checks ? (
            <ul className="checks">
              {[...checks, checkNetwork(online)].map((c) => (
                <CheckItem check={c} key={c.id} />
              ))}
            </ul>
          ) : (
            <p className="section-intro">Checking your device…</p>
          )}
        </section>

        <section className="section">
          <h2>Roadmap</h2>
          <ol className="roadmap">
            {roadmap.map((r) => (
              <li className={r.done ? 'done' : undefined} key={r.phase}>
                <span className="phase">{r.phase}</span>
                <span>{r.title}</span>
                <span className="state">{r.done ? 'Done' : 'Planned'}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Pocket AI Research, an on-device AI project. · <a href={REPO_URL}>Source on GitHub</a>
          </p>
        </div>
      </footer>
    </>
  )
}
