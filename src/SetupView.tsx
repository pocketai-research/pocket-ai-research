import type { ModelOption } from './ai/models'
import Brand, { REPO_URL } from './Brand'
import DeviceChecks from './DeviceChecks'

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
  onOpen: (model: ModelOption) => void
  onDelete: (model: ModelOption) => void
  onBackToChat?: () => void
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
  const { models, downloaded, loading, activeId, error, onOpen, onDelete, onBackToChat } = props

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
            <span className="badge">Preview v0.2</span>
          )}
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <p className="eyebrow">Offline AI that runs on your device</p>
          <h1>An AI assistant that lives in your pocket.</h1>
          <p className="lead">
            Pick a model and download it once. After that, Pocket AI works with no internet, no account, and nothing
            leaving your device.
          </p>
        </section>

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
          <h2>Is my device ready?</h2>
          <p className="section-intro">This check runs locally. Nothing is uploaded.</p>
          <DeviceChecks />
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
