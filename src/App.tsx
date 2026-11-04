import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { deleteModel, describeError, listDownloadedUrls, loadModel, type LoadedModel } from './ai/engine'
import { forgetCustomModel, readCustomModels } from './ai/customModels'
import { MODELS, type ModelOption } from './ai/models'
import ChatView from './ChatView'
import {
  deleteConversation,
  listConversations,
  saveConversation,
  titleFrom,
  type ChatEntry,
  type Conversation,
} from './chatStore'
import {
  readEngineSettings,
  readLastModel,
  readReplySettings,
  saveEngineSettings,
  saveLastModel,
  saveReplySettings,
  takeBusyMarker,
  type EngineSettings,
  type ReplySettings,
} from './settings'
import SetupView, { type LoadingState } from './SetupView'
import { embedTexts, prepareEmbeddings } from './ai/embeddings'
import { chunk, extractChunks } from './docs/extract'
import { readMemory, withFact, writeMemory, type MemoryItem } from './memory'
import { onShared, type Shared } from './shareTarget'
import { checkForUpdate, dismissUpdate, type AppUpdate } from './updates'
import {
  deleteDocument,
  deleteNote,
  getDocuments,
  listDocuments,
  listNotes,
  saveDocument,
  saveNote,
  summarize,
  type DocSummary,
  type Note,
} from './docs/store'

// MapLibre is large, so the map only loads when it is opened.
const MapView = lazy(() => import('./map/MapView'))

/**
 * If the app died last time while a model was loading or replying (usually out of memory, or a
 * GPU driver crash), step the engine settings down one level and explain what happened.
 * Runs once per launch, at module load, so React StrictMode cannot consume it twice.
 */
function recoverFromCrash(): string | null {
  const marker = takeBusyMarker()
  if (!marker) return null

  const settings = readEngineSettings()
  let change: string
  if (marker.settings.gpu) {
    settings.gpu = false
    change = 'GPU acceleration has been turned off.'
  } else if (!marker.settings.singleThread) {
    settings.singleThread = true
    change = 'Compatibility mode has been turned on (slower, but more reliable).'
  } else {
    change = 'Try the Light model, close other apps, or restart your device.'
  }
  saveEngineSettings(settings)

  const name = [...MODELS, ...readCustomModels()].find((m) => m.id === marker.modelId)?.name ?? 'the model'
  const when = marker.phase === 'loading' ? `while loading ${name}` : `while ${name} was replying`
  return `Pocket Ai Research closed unexpectedly ${when}, usually because the device ran out of memory. ${change} If you closed the app yourself, you can change this under Performance.`
}

const crashNotice = recoverFromCrash()

type ChatMeta = Pick<Conversation, 'id' | 'createdAt'>

const newChatMeta = (): ChatMeta => ({ id: crypto.randomUUID(), createdAt: Date.now() })

export default function App() {
  const [downloaded, setDownloaded] = useState<Set<string> | null>(null)
  // Models the user added (src/ai/customModels.ts) come after the built-in ones.
  const [customModels, setCustomModels] = useState(readCustomModels)
  const models = useMemo(() => [...MODELS, ...customModels], [customModels])
  const [loading, setLoading] = useState<LoadingState | null>(null)
  const [active, setActive] = useState<LoadedModel | null>(null)
  const [view, setView] = useState<'setup' | 'chat' | 'map'>('setup')
  const [viewBeforeMap, setViewBeforeMap] = useState<'setup' | 'chat'>('setup')
  const [chatMeta, setChatMeta] = useState(newChatMeta)
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EngineSettings>(readEngineSettings)
  const [replySettings, setReplySettings] = useState<ReplySettings>(readReplySettings)
  // Documents attached to the open chat, and every document stored on the device.
  const [chatDocs, setChatDocs] = useState<DocSummary[]>([])
  const [allDocs, setAllDocs] = useState<DocSummary[]>([])
  const [attachStatus, setAttachStatus] = useState<{ reading?: string; error?: string }>({})
  // Preparing search by meaning: downloading the model, then indexing the stored documents.
  const [meaningStatus, setMeaningStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [instructions, setInstructions] = useState('')
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [memory, setMemory] = useState<MemoryItem[]>(readMemory)

  function changeMemory(next: MemoryItem[]) {
    setMemory(next)
    writeMemory(next)
  }
  // Text or a photo shared from another app, waiting for the chat to take it.
  const [shared, setShared] = useState<Shared | null>(null)
  // A share opens a new chat, so the last chat must not be restored over it.
  const sharedArrived = useRef(false)

  useEffect(() => {
    checkForUpdate().then(setUpdate)
  }, [])

  const refreshDocuments = () => listDocuments().then(setAllDocs)
  const [notes, setNotes] = useState<Note[]>([])
  useEffect(() => {
    listNotes().then(setNotes)
  }, [])

  /** Saves a new or edited note, indexed for search by meaning when that is on. */
  async function storeNote(draft: { id?: string; title: string; text: string }) {
    const text = draft.text.trim()
    const title = draft.title.trim() || text.split('\n')[0].slice(0, 60)
    const chunks = chunk(`${title}. ${text}`, null)
    let vectors: Float32Array[] | undefined
    if (replySettings.docSearch === 'meaning') {
      vectors = await embedTexts(
        chunks.map((c) => c.text),
        'passage',
      ).catch(() => undefined)
    }
    await saveNote({ id: draft.id ?? crypto.randomUUID(), title, text, updatedAt: Date.now(), chunks, ...(vectors ? { vectors } : {}) })
    setNotes(await listNotes())
  }

  async function removeNote(id: string) {
    await deleteNote(id)
    setNotes(await listNotes())
  }
  useEffect(() => {
    refreshDocuments()
  }, [])
  const [notice, setNotice] = useState(crashNotice)
  // JSON of the messages last written to (or read from) storage, to skip redundant saves.
  const savedSnapshot = useRef('[]')

  const refreshDownloaded = () => listDownloadedUrls().then(setDownloaded)

  async function openModel(model: ModelOption) {
    setError(null)
    setLoading({ modelId: model.id, progress: 0 })
    try {
      const result = await loadModel(model, settings, (progress) => setLoading({ modelId: model.id, progress }))
      setActive(result)
      setNotice(null)
      saveLastModel(model.id)
      setView('chat')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setLoading(null)
      refreshDownloaded()
    }
  }

  // Reopen the last used model straight into the chat when it is already on the device,
  // unless the previous launch crashed (reopening could crash again in a loop).
  useEffect(() => {
    listDownloadedUrls().then((urls) => {
      setDownloaded(urls)
      const last = [...MODELS, ...readCustomModels()].find((m) => m.id === readLastModel())
      if (!crashNotice && last && urls.has(last.url)) openModel(last)
    })
  }, [])

  function changeSettings(next: EngineSettings) {
    setSettings(next)
    saveEngineSettings(next)
  }

  function changeReplySettings(next: ReplySettings) {
    setReplySettings(next)
    saveReplySettings(next)
    if (next.docSearch === 'meaning' && replySettings.docSearch !== 'meaning') prepareMeaningSearch()
  }

  /** Downloads the embedding model if needed and indexes every stored document that is not yet. */
  async function prepareMeaningSearch() {
    try {
      setMeaningStatus({ text: 'Getting the search model ready…' })
      await prepareEmbeddings((fraction) =>
        setMeaningStatus({ text: `Downloading the search model… ${Math.round(fraction * 100)}%` }),
      )
      const pending = (await getDocuments((await listDocuments()).map((d) => d.id))).filter((d) => !d.vectors)
      for (const [i, doc] of pending.entries()) {
        setMeaningStatus({ text: `Indexing ${doc.name} (${i + 1} of ${pending.length})…` })
        await saveDocument({ ...doc, vectors: await embedTexts(doc.chunks.map((c) => c.text), 'passage') })
      }
      for (const note of (await listNotes()).filter((n) => !n.vectors)) {
        setMeaningStatus({ text: `Indexing your note "${note.title}"…` })
        await saveNote({ ...note, vectors: await embedTexts(note.chunks.map((c) => c.text), 'passage') })
      }
      setMeaningStatus({ text: 'Search by meaning is ready.' })
    } catch {
      setMeaningStatus({
        text: 'The search model could not be downloaded. Connect to the internet and choose Meaning again.',
        error: true,
      })
    }
  }

  // Continue the most recent chat, so closing the app (or Android stopping it) loses nothing.
  useEffect(() => {
    listConversations().then((list) => {
      if (list[0] && !sharedArrived.current) showConversation(list[0])
    })
  }, [])

  // Shared from another app: a new chat with the document attached, or the text or photo ready to send.
  useEffect(
    () =>
      onShared((item) => {
        sharedArrived.current = true
        setShared(item)
      }),
    [],
  )

  useEffect(() => {
    if (!shared) return
    startNewChat()
    if (shared.error) setAttachStatus({ error: shared.error })
    const document = shared.file && !shared.file.type.startsWith('image/') ? shared.file : null
    if (document) attachDocument(document)
    if (!shared.text && !shared.file?.type.startsWith('image/')) setShared(null)
    if (active) setView('chat')
    else if (document) setNotice(`${document.name} is attached to a new chat. Open a model to ask about it.`)
    // Runs once per share.
  }, [shared?.id])

  const snapshotOf = (entries: ChatEntry[], docs: DocSummary[], text: string) =>
    JSON.stringify([entries, docs.map((d) => d.id), text])

  function persist(meta: ChatMeta, entries: ChatEntry[], docs: DocSummary[], text: string) {
    const saved = entries.filter((m) => m.content)
    const snapshot = snapshotOf(saved, docs, text)
    if (!saved.length || snapshot === savedSnapshot.current) return
    savedSnapshot.current = snapshot
    saveConversation({
      ...meta,
      title: titleFrom(saved),
      modelId: active?.model.id ?? '',
      messages: saved,
      documentIds: docs.map((d) => d.id),
      ...(text ? { instructions: text } : {}),
      updatedAt: Date.now(),
    })
  }

  // Debounced so a streaming reply is not written to storage on every token.
  useEffect(() => {
    const timer = setTimeout(() => persist(chatMeta, messages, chatDocs, instructions), 500)
    return () => clearTimeout(timer)
  })

  function showConversation(conversation: Conversation) {
    setChatMeta({ id: conversation.id, createdAt: conversation.createdAt })
    setMessages(conversation.messages)
    setInstructions(conversation.instructions ?? '')
    setAttachStatus({})
    getDocuments(conversation.documentIds ?? []).then((docs) => {
      const summaries = docs.map(summarize)
      setChatDocs(summaries)
      savedSnapshot.current = snapshotOf(conversation.messages, summaries, conversation.instructions ?? '')
    })
  }

  function resetChat() {
    setChatMeta(newChatMeta())
    setMessages([])
    setChatDocs([])
    setInstructions('')
    setAttachStatus({})
    savedSnapshot.current = snapshotOf([], [], '')
  }

  async function attachDocument(file: File) {
    setAttachStatus({ reading: file.name })
    try {
      const chunks = await extractChunks(file)
      if (!chunks.length) {
        throw new Error('No text found in this file. Scanned PDFs (pictures of pages) are not supported yet.')
      }
      let vectors: Float32Array[] | undefined
      let notice: string | undefined
      if (replySettings.docSearch === 'meaning') {
        try {
          vectors = await embedTexts(
            chunks.map((c) => c.text),
            'passage',
            (done) => setAttachStatus({ reading: `${file.name}: indexing ${Math.round((done / chunks.length) * 100)}%` }),
          )
        } catch {
          notice = `${file.name} is attached, but search by meaning is unavailable right now, so it is searched by words.`
        }
      }
      const doc = {
        id: crypto.randomUUID(),
        name: file.name,
        chars: chunks.reduce((sum, c) => sum + c.text.length, 0),
        addedAt: Date.now(),
        chunks,
        ...(vectors ? { vectors } : {}),
      }
      await saveDocument(doc)
      setChatDocs((docs) => [...docs, summarize(doc)])
      setAttachStatus(notice ? { error: notice } : {})
      refreshDocuments()
    } catch (err) {
      setAttachStatus({ error: `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  async function removeDocument(doc: DocSummary) {
    if (!confirm(`Delete ${doc.name} from this device? Chats that used it will no longer see it.`)) return
    await deleteDocument(doc.id)
    setChatDocs((docs) => docs.filter((d) => d.id !== doc.id))
    refreshDocuments()
  }

  // Switching chats flushes the current one first, since its debounced save may still be pending.
  function startNewChat() {
    persist(chatMeta, messages, chatDocs, instructions)
    resetChat()
  }

  function openConversation(conversation: Conversation) {
    persist(chatMeta, messages, chatDocs, instructions)
    showConversation(conversation)
  }

  async function removeConversation(id: string) {
    await deleteConversation(id)
    if (id === chatMeta.id) resetChat()
  }

  async function removeModel(model: ModelOption) {
    const question = model.custom
      ? `Remove ${model.name} from this device?${model.custom === 'file' ? ' To use it again, add its file again.' : ''}`
      : `Delete ${model.name} from this device? You will need to download it again to use it.`
    if (!confirm(question)) return
    await deleteModel(model)
    if (model.custom) {
      forgetCustomModel(model.id)
      setCustomModels(readCustomModels())
    }
    if (active?.model.id === model.id) setActive(null)
    refreshDownloaded()
  }

  function showMap() {
    setViewBeforeMap(view === 'chat' ? 'chat' : 'setup')
    setView('map')
  }

  // The Android app does not update itself, so it says when a new release is out (src/updates.ts).
  const banner = update && (
    <div className="update-banner" role="status">
      <span>Version {update.version} of the app is available.</span>
      <a className="btn primary" href={update.url} target="_blank" rel="noreferrer">
        Download
      </a>
      <button
        className="link"
        onClick={() => {
          dismissUpdate(update)
          setUpdate(null)
        }}
      >
        Later
      </button>
    </div>
  )

  if (view === 'map') {
    return (
      <Suspense fallback={<p className="container section-intro">Loading map…</p>}>
        <MapView onBack={() => setView(viewBeforeMap)} ai={{ ready: active !== null, reply: replySettings }} />
      </Suspense>
    )
  }

  if (view === 'chat' && active) {
    return (
      <ChatView
        loaded={active}
        replySettings={replySettings}
        onReplySettingsChange={changeReplySettings}
        instructions={instructions}
        onInstructionsChange={setInstructions}
        banner={banner}
        memory={memory.map((item) => item.text)}
        onRemember={(fact) => changeMemory(withFact(readMemory(), fact))}
        incoming={shared}
        onIncomingUsed={() => setShared(null)}
        chatId={chatMeta.id}
        messages={messages}
        setMessages={setMessages}
        documents={chatDocs}
        attachStatus={attachStatus}
        onAttach={attachDocument}
        onDetach={(id) => setChatDocs((docs) => docs.filter((d) => d.id !== id))}
        onUseVisionModel={() => {
          setView('setup')
          const vision = MODELS.find((m) => m.mmprojUrl)
          if (vision) openModel(vision)
        }}
        onShowModels={() => setView('setup')}
        onShowMap={showMap}
        onNewChat={startNewChat}
        onOpenChat={openConversation}
        onDeleteChat={removeConversation}
      />
    )
  }

  return (
    <SetupView
      models={models}
      onModelAdded={() => {
        setCustomModels(readCustomModels())
        refreshDownloaded()
      }}
      banner={banner}
      downloaded={downloaded}
      loading={loading}
      activeId={active?.model.id}
      error={error}
      notice={notice}
      settings={settings}
      onSettingsChange={changeSettings}
      replySettings={replySettings}
      onReplySettingsChange={changeReplySettings}
      documents={allDocs}
      meaningStatus={meaningStatus}
      memory={memory}
      onMemoryChange={changeMemory}
      notes={notes}
      onSaveNote={storeNote}
      onDeleteNote={removeNote}
      onDataImported={() => {
        refreshDocuments()
        listNotes().then(setNotes)
        setMemory(readMemory())
        // Imported documents and notes come without vectors: index them again for search by meaning.
        if (replySettings.docSearch === 'meaning') prepareMeaningSearch()
      }}
      onDeleteDocument={removeDocument}
      onOpen={openModel}
      onDelete={removeModel}
      onBackToChat={active ? () => setView('chat') : undefined}
      onShowMap={showMap}
    />
  )
}
