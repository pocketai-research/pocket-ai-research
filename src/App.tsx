import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { deleteModel, describeError, listDownloadedUrls, loadModel, type LoadedModel } from './ai/engine'
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
import { extractChunks } from './docs/extract'
import { deleteDocument, getDocuments, listDocuments, saveDocument, summarize, type DocSummary } from './docs/store'

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

  const name = MODELS.find((m) => m.id === marker.modelId)?.name ?? 'the model'
  const when = marker.phase === 'loading' ? `while loading ${name}` : `while ${name} was replying`
  return `Pocket Ai Research closed unexpectedly ${when}, usually because the device ran out of memory. ${change} If you closed the app yourself, you can change this under Performance.`
}

const crashNotice = recoverFromCrash()

type ChatMeta = Pick<Conversation, 'id' | 'createdAt'>

const newChatMeta = (): ChatMeta => ({ id: crypto.randomUUID(), createdAt: Date.now() })

export default function App() {
  const [downloaded, setDownloaded] = useState<Set<string> | null>(null)
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

  const refreshDocuments = () => listDocuments().then(setAllDocs)
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
      const last = MODELS.find((m) => m.id === readLastModel())
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
  }

  // Continue the most recent chat, so closing the app (or Android stopping it) loses nothing.
  useEffect(() => {
    listConversations().then((list) => {
      if (list[0]) showConversation(list[0])
    })
  }, [])

  const snapshotOf = (entries: ChatEntry[], docs: DocSummary[]) => JSON.stringify([entries, docs.map((d) => d.id)])

  function persist(meta: ChatMeta, entries: ChatEntry[], docs: DocSummary[]) {
    const saved = entries.filter((m) => m.content)
    const snapshot = snapshotOf(saved, docs)
    if (!saved.length || snapshot === savedSnapshot.current) return
    savedSnapshot.current = snapshot
    saveConversation({
      ...meta,
      title: titleFrom(saved),
      modelId: active?.model.id ?? '',
      messages: saved,
      documentIds: docs.map((d) => d.id),
      updatedAt: Date.now(),
    })
  }

  // Debounced so a streaming reply is not written to storage on every token.
  useEffect(() => {
    const timer = setTimeout(() => persist(chatMeta, messages, chatDocs), 500)
    return () => clearTimeout(timer)
  })

  function showConversation(conversation: Conversation) {
    setChatMeta({ id: conversation.id, createdAt: conversation.createdAt })
    setMessages(conversation.messages)
    setAttachStatus({})
    getDocuments(conversation.documentIds ?? []).then((docs) => {
      const summaries = docs.map(summarize)
      setChatDocs(summaries)
      savedSnapshot.current = snapshotOf(conversation.messages, summaries)
    })
  }

  function resetChat() {
    setChatMeta(newChatMeta())
    setMessages([])
    setChatDocs([])
    setAttachStatus({})
    savedSnapshot.current = snapshotOf([], [])
  }

  async function attachDocument(file: File) {
    setAttachStatus({ reading: file.name })
    try {
      const chunks = await extractChunks(file)
      if (!chunks.length) {
        throw new Error('No text found in this file. Scanned PDFs (pictures of pages) are not supported yet.')
      }
      const doc = {
        id: crypto.randomUUID(),
        name: file.name,
        chars: chunks.reduce((sum, c) => sum + c.text.length, 0),
        addedAt: Date.now(),
        chunks,
      }
      await saveDocument(doc)
      setChatDocs((docs) => [...docs, summarize(doc)])
      setAttachStatus({})
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
    persist(chatMeta, messages, chatDocs)
    resetChat()
  }

  function openConversation(conversation: Conversation) {
    persist(chatMeta, messages, chatDocs)
    showConversation(conversation)
  }

  async function removeConversation(id: string) {
    await deleteConversation(id)
    if (id === chatMeta.id) resetChat()
  }

  async function removeModel(model: ModelOption) {
    if (!confirm(`Delete ${model.name} from this device? You will need to download it again to use it.`)) return
    await deleteModel(model)
    if (active?.model.id === model.id) setActive(null)
    refreshDownloaded()
  }

  function showMap() {
    setViewBeforeMap(view === 'chat' ? 'chat' : 'setup')
    setView('map')
  }

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
        chatId={chatMeta.id}
        messages={messages}
        setMessages={setMessages}
        documents={chatDocs}
        attachStatus={attachStatus}
        onAttach={attachDocument}
        onDetach={(id) => setChatDocs((docs) => docs.filter((d) => d.id !== id))}
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
      models={MODELS}
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
      onDeleteDocument={removeDocument}
      onOpen={openModel}
      onDelete={removeModel}
      onBackToChat={active ? () => setView('chat') : undefined}
      onShowMap={showMap}
    />
  )
}
