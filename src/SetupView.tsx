import { useEffect, useState, type ReactNode } from 'react'
import { EMBEDDING_MODEL } from './ai/embeddings'
import type { ModelOption } from './ai/models'
import Brand, { REPO_URL } from './Brand'
import { useInstallPrompt } from './pwa'
import { engineThreads, estimateSpeed, hasWebGPU, recommendModel, speedScore } from './deviceCheck'
import DeviceChecks from './DeviceChecks'
import type { DocSummary, Note } from './docs/store'
import { TrashIcon } from './icons'
import { MAX_FACT_CHARS, MAX_MEMORY, withFact, type MemoryItem } from './memory'
import type { EngineSettings, ReplySettings } from './settings'

export interface LoadingState {
  modelId: string
  progress: number
}

interface SetupViewProps {
  models: ModelOption[]
  /** Shown at the top, e.g. that a new version of the app is available. */
  banner?: ReactNode
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
  /** Progress or a problem while search by meaning is prepared. */
  meaningStatus: { text: string; error?: boolean } | null
  memory: MemoryItem[]
  onMemoryChange: (memory: MemoryItem[]) => void
  notes: Note[]
  onSaveNote: (draft: { id?: string; title: string; text: string }) => Promise<void>
  onDeleteNote: (id: string) => void
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
  const { onBackToChat, onShowMap, replySettings, onReplySettingsChange, documents, onDeleteDocument, banner } = props
  const { meaningStatus, memory, onMemoryChange, notes, onSaveNote, onDeleteNote } = props
  // The note being written or edited (no id yet for a new one).
  const [noteDraft, setNoteDraft] = useState<{ id?: string; title: string; text: string } | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [newFact, setNewFact] = useState('')
  const [gpuAvailable, setGpuAvailable] = useState(false)
  // Measured after the first paint: the test keeps the CPU busy for about 0.75 s the first time.
  const [score, setScore] = useState<number | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setScore(speedScore()), 300)
    return () => clearTimeout(timer)
  }, [])
  const threads = engineThreads(settings)
  const recommended = score !== null ? recommendModel(models, score, threads) : undefined
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
            <span className="badge">Preview v{__APP_VERSION__.split('.').slice(0, 2).join('.')}</span>
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

        {banner}

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
            {/* Replaced models stay listed while downloaded, so they can be opened or deleted. */}
            {models.filter((m) => !m.replacedBy || downloaded?.has(m.url)).map((m) => {
              const isDownloaded = downloaded?.has(m.url) ?? false
              const isLoading = loading?.modelId === m.id
              const successor = m.replacedBy && models.find((other) => other.id === m.replacedBy)
              const speed = score !== null && !m.replacedBy ? estimateSpeed(m, score, threads) : null
              return (
                <article className="card model-card" key={m.id}>
                  <div className="model-head">
                    <span className="tier">{m.tier}</span>
                    {recommended === m && <span className="recommended">Recommended for this device</span>}
                    <span className="size">{m.size}</span>
                  </div>
                  <h3>{m.name}</h3>
                  <p>
                    {m.description}
                    {successor && ` Replaced by ${successor.name}, which answers better. Delete it to free ${m.size}.`}
                  </p>
                  {speed !== null && (
                    <small className="speed">
                      About {speed < 10 ? speed.toFixed(1) : Math.round(speed)} tokens a second on this device (estimate)
                    </small>
                  )}
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
            Changes apply to the next reply. Indonesian replies work best with the Balanced model; the Light model sometimes
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
          <h2>Memory</h2>
          <p className="section-intro">
            Facts the AI should know in every chat, such as your name, your job or how you like answers. Say "Remember
            that…" (or "Ingat bahwa…") in a chat, or add them here. They stay on this device, up to {MAX_MEMORY}.
          </p>
          <div className="settings">
            <Choice
              label="Use memory in chats"
              value={replySettings.memory}
              options={[
                ['on', 'On'],
                ['off', 'Off'],
              ]}
              onChange={(value) => onReplySettingsChange({ ...replySettings, memory: value })}
            />
          </div>
          {memory.length === 0 ? (
            <p className="muted">Nothing saved yet.</p>
          ) : (
            <ul className="area-list memory-list">
              {memory.map((item) => (
                <li key={item.id}>
                  <div className="area-info">
                    <strong>{item.text}</strong>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={`Forget: ${item.text}`}
                    onClick={() => onMemoryChange(memory.filter((m) => m.id !== item.id))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="memory-form"
            onSubmit={(e) => {
              e.preventDefault()
              onMemoryChange(withFact(memory, newFact))
              setNewFact('')
            }}
          >
            <input
              value={newFact}
              maxLength={MAX_FACT_CHARS}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="e.g. My name is Budi and I live in Yogyakarta"
              aria-label="A fact to remember"
            />
            <button className="btn primary" type="submit" disabled={!newFact.trim()}>
              Add
            </button>
          </form>
        </section>

        <section className="section">
          <h2>Notes</h2>
          <p className="section-intro">
            Write things down here (bills, plans, recipes, contacts) and ask about them in any chat, e.g. "When do I pay
            the electricity?". A note is only used when it matches the question; the sources under the reply name it.
          </p>
          {notes.length === 0 && !noteDraft && <p className="muted">No notes yet.</p>}
          {notes.length > 0 && (
            <ul className="area-list note-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button className="area-info note-open" onClick={() => setNoteDraft({ id: note.id, title: note.title, text: note.text })}>
                    <strong>{note.title}</strong>
                    <small>{note.text.replace(/\s+/g, ' ').slice(0, 80)}</small>
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete the note ${note.title}`}
                    onClick={() => confirm(`Delete the note "${note.title}"?`) && onDeleteNote(note.id)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {noteDraft ? (
            <form
              className="note-form"
              onSubmit={async (e) => {
                e.preventDefault()
                setSavingNote(true)
                await onSaveNote(noteDraft).finally(() => setSavingNote(false))
                setNoteDraft(null)
              }}
            >
              <input
                value={noteDraft.title}
                maxLength={80}
                onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })}
                placeholder="Title, e.g. Electricity"
                aria-label="Note title"
              />
              <textarea
                value={noteDraft.text}
                rows={5}
                maxLength={5000}
                onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
                placeholder="e.g. Pay on the 20th of every month in the BRImo app. Customer ID 1234567."
                aria-label="Note text"
              />
              <div className="instruction-actions">
                <button className="btn primary" type="submit" disabled={savingNote || !noteDraft.text.trim()}>
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setNoteDraft(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="btn ghost new-note" onClick={() => setNoteDraft({ title: '', text: '' })}>
              New note
            </button>
          )}
        </section>

        <section className="section">
          <h2>Documents</h2>
          <p className="section-intro">
            Attach a PDF or text file in a chat with the paperclip button, then ask about it. Files are read and kept on
            this device. Scanned PDFs (pictures of pages) are not supported yet.
          </p>
          <div className="settings">
            <Choice
              label="Find passages by"
              value={replySettings.docSearch}
              options={[
                ['words', 'Words'],
                ['meaning', 'Meaning'],
              ]}
              onChange={(docSearch) => onReplySettingsChange({ ...replySettings, docSearch })}
            />
          </div>
          <p className="muted small">
            Meaning also finds passages that say the same thing in other words or in another language, e.g. an Indonesian
            question about an English document. It downloads a {EMBEDDING_MODEL.size} search model once and indexes each
            document when it is attached.
          </p>
          {meaningStatus && (
            <p className={meaningStatus.error ? 'alert' : 'muted'} role="status">
              {meaningStatus.text}
            </p>
          )}
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
