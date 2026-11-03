import { useEffect, useState } from 'react'
import type { ModelOption } from './ai/models'
import Brand, { REPO_URL } from './Brand'
import { useInstallPrompt } from './pwa'
import { hasWebGPU } from './deviceCheck'
import DeviceChecks from './DeviceChecks'
import type { DocSummary } from './docs/store'
import { TrashIcon } from './icons'
import type { EngineSettings, ReplySettings } from './settings'

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
  replySettings: ReplySettings
  onReplySettingsChange: (settings: ReplySettings) => void
  documents: DocSummary[]
  onDeleteDocument: (doc: DocSummary) => void
  onOpen: (model: ModelOption) => void
  onDelete: (model: ModelOption) => void
  onBackToChat?: () => void
  onShowMap: () => void
}

function Choice<T extends string>(props: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="choice">
      <span className="choice-label">{props.label}</span>
      <div className="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map(([value, text]) => (
          <button key={value} role="radio" aria-checked={props.value === value} onClick={() => props.onChange(value)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
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
  const { onBackToChat, onShowMap, replySettings, onReplySettingsChange, documents, onDeleteDocument } = props
  const [gpuAvailable, setGpuAvailable] = useState(false)
  const install = useInstallPrompt()

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
            <span className="badge">Preview v0.12</span>
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
          {install && (
            <button className="btn primary install" onClick={install}>
              Install app
            </button>
          )}
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
                  {m.attribution && <small className="attribution">{m.attribution}</small>}
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
          <h2>AI replies</h2>
          <p className="section-intro">
            Changes apply to the next reply. Indonesian replies work best with the Balanced or Smart model; the Light model often
            answers in English anyway. Voice uses the device's own speech services; on Android, speaking to the app
            works offline once the language's offline speech pack is installed (Settings, Google, Voice).
          </p>
          <div className="settings">
            <Choice
              label="Language"
              value={replySettings.language}
              options={[
                ['english', 'English'],
                ['indonesian', 'Indonesian'],
                ['auto', 'Match my message'],
              ]}
              onChange={(language) => onReplySettingsChange({ ...replySettings, language })}
            />
            <Choice
              label="Length"
              value={replySettings.length}
              options={[
                ['short', 'Short'],
                ['normal', 'Normal'],
                ['detailed', 'Detailed'],
              ]}
              onChange={(length) => onReplySettingsChange({ ...replySettings, length })}
            />
            <Choice
              label="Style"
              value={replySettings.creativity}
              options={[
                ['precise', 'Precise'],
                ['balanced', 'Balanced'],
                ['creative', 'Creative'],
              ]}
              onChange={(creativity) => onReplySettingsChange({ ...replySettings, creativity })}
            />
            <Choice
              label="Read replies aloud"
              value={replySettings.readAloud}
              options={[
                ['off', 'Off'],
                ['on', 'On'],
              ]}
              onChange={(readAloud) => onReplySettingsChange({ ...replySettings, readAloud })}
            />
          </div>
        </section>

        <section className="section">
          <h2>Documents</h2>
          <p className="section-intro">
            Attach a PDF or text file in a chat with the paperclip button, then ask about it. Files are read and kept on
            this device. Scanned PDFs (pictures of pages) are not supported yet.
          </p>
          {documents.length === 0 ? (
            <p className="muted">No documents yet.</p>
          ) : (
            <ul className="area-list">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <div className="area-info">
                    <strong>{doc.name}</strong>
                    <small>
                      {Math.max(1, Math.round(doc.chars / 1000))}k characters · added{' '}
                      {new Date(doc.addedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                    </small>
                  </div>
                  <button className="icon-btn" aria-label={`Delete ${doc.name}`} onClick={() => onDeleteDocument(doc)}>
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
