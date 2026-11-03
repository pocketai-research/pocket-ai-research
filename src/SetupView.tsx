import { useEffect, useState } from 'react'
import type { ModelOption } from './ai/models'
import Brand, { REPO_URL } from './Brand'
import { hasWebGPU } from './deviceCheck'
import DeviceChecks from './DeviceChecks'
import type { EngineSettings } from './settings'

export interface LoadingState {
  modelId: string
  progress: number
}

interface SetupViewProps {
  models: ModelOption[]
  downloaded: Set<string> | null
  loading: LoadingState | null
  activeId: string | undefined
  error: string | null
  notice: string | null
  settings: EngineSettings
  onSettingsChange: (settings: EngineSettings) => void
  onOpen: (model: ModelOption) => void
  onDelete: (model: ModelOption) => void
  onBackToChat?: () => void
  onShowMap: () => void
}

function LoadingProgress({ progress, cached }: { progress: number; cached: boolean }) {
  const downloading = !cached && progress < 1
  const percent = Math.round(progress * 100)
  return (
    <div className="progress" role="status">
      <div className="progress-label">
        <span>{downloading ? 'Downloading…' : 'Loading model into memory…'}</span>
        {downloading && <span>{percent}%</span>}
      </div>
      <div className={`progress-track${downloading ? '' : ' indeterminate'}`}>
        <div className="progress-bar" style={downloading ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  )
}

export default function SetupView(props: SetupViewProps) {
  const { models, downloaded, loading, activeId, error, notice, settings, onSettingsChange, onOpen, onDelete } = props
  const { onBackToChat, onShowMap } = props
  const [gpuAvailable, setGpuAvailable] = useState(false)

  useEffect(() => {
    hasWebGPU().then(setGpuAvailable)
  }, [])

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          {onBackToChat ? (
            <button className="btn ghost" onClick={onBackToChat}>
              Back to chat
            </button>
          ) : (
            <span className="badge">Preview v0.4.1</span>
          )}
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <p className="eyebrow">Offline AI that runs on your device</p>
          <h1>An AI assistant that lives in your pocket.</h1>
          <p className="lead">
            Pick a model and download it once. After that, Pocket Ai Research works with no internet, no account, and nothing
            leaving your device.
          </p>
        </section>

        {notice && (
          <p className="alert warn" role="alert">
            {notice}
          </p>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <section className="section">
          <h2>Choose a model</h2>
          <p className="section-intro">Models are saved on this device. Use Wi-Fi for the first download.</p>
          <div className="grid">
            {models.map((m) => {
              const isDownloaded = downloaded?.has(m.url) ?? false
              const isLoading = loading?.modelId === m.id
              return (
                <article className="card model-card" key={m.id}>
                  <div className="model-head">
                    <span className="tier">{m.tier}</span>
                    <span className="size">{m.size}</span>
                  </div>
                  <h3>{m.name}</h3>
                  <p>{m.description}</p>
                  {isLoading && loading ? (
                    <LoadingProgress progress={loading.progress} cached={isDownloaded} />
                  ) : (
                    <div className="model-actions">
                      <button className="btn primary" disabled={loading !== null} onClick={() => onOpen(m)}>
                        {activeId === m.id ? 'Continue chatting' : isDownloaded ? 'Start chat' : `Download ${m.size}`}
                      </button>
                      {isDownloaded && (
                        <button className="btn ghost" disabled={loading !== null} onClick={() => onDelete(m)}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                  {isDownloaded && !isLoading && <p className="ready">✓ Ready offline</p>}
                </article>
              )
            })}
          </div>
        </section>

        <section className="section">
          <h2>Map</h2>
          <p className="section-intro">
            Browse any country by province, regency and district, and see where you are with GPS. In the Android app you
            can download areas to use the map without internet. No AI model needed.
          </p>
          <button className="btn primary" onClick={onShowMap}>
            Open map
          </button>
        </section>

        <section className="section">
          <h2>Performance</h2>
          <p className="section-intro">Changes apply the next time you open a model.</p>
          <div className="settings">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.gpu}
                disabled={!gpuAvailable && !settings.gpu}
                onChange={(e) => onSettingsChange({ ...settings, gpu: e.target.checked })}
              />
              <span>
                <strong>GPU acceleration (experimental)</strong>
                <small>{gpuAvailable ? 'Can be faster, but crashes on some phones.' : 'Not available on this device.'}</small>
              </span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.singleThread}
                onChange={(e) => onSettingsChange({ ...settings, singleThread: e.target.checked })}
              />
              <span>
                <strong>Compatibility mode</strong>
                <small>Uses one CPU core. Slower, but works on more devices.</small>
              </span>
            </label>
          </div>
        </section>

        <section className="section">
          <h2>Is my device ready?</h2>
          <p className="section-intro">This check runs locally. Nothing is uploaded.</p>
          <DeviceChecks />
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Pocket Ai Research, an on-device AI project. · <a href={REPO_URL}>Source on GitHub</a>
          </p>
        </div>
      </footer>
    </>
  )
}
