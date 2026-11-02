import { useEffect, useRef, useState } from 'react'
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
  saveEngineSettings,
  saveLastModel,
  takeBusyMarker,
  type EngineSettings,
} from './settings'
import SetupView, { type LoadingState } from './SetupView'

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
  const [view, setView] = useState<'setup' | 'chat'>('setup')
  const [chatMeta, setChatMeta] = useState(newChatMeta)
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EngineSettings>(readEngineSettings)
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

  // Continue the most recent chat, so closing the app (or Android stopping it) loses nothing.
  useEffect(() => {
    listConversations().then((list) => {
      if (list[0]) showConversation(list[0])
    })
  }, [])

  function persist(meta: ChatMeta, entries: ChatEntry[]) {
    const saved = entries.filter((m) => m.content)
    const snapshot = JSON.stringify(saved)
    if (!saved.length || snapshot === savedSnapshot.current) return
    savedSnapshot.current = snapshot
    saveConversation({
      ...meta,
      title: titleFrom(saved),
      modelId: active?.model.id ?? '',
      messages: saved,
      updatedAt: Date.now(),
    })
  }

  // Debounced so a streaming reply is not written to storage on every token.
  useEffect(() => {
    const timer = setTimeout(() => persist(chatMeta, messages), 500)
    return () => clearTimeout(timer)
  })

  function showConversation(conversation: Conversation) {
    setChatMeta({ id: conversation.id, createdAt: conversation.createdAt })
    setMessages(conversation.messages)
    savedSnapshot.current = JSON.stringify(conversation.messages)
  }

  function resetChat() {
    setChatMeta(newChatMeta())
    setMessages([])
    savedSnapshot.current = '[]'
  }

  // Switching chats flushes the current one first, since its debounced save may still be pending.
  function startNewChat() {
    persist(chatMeta, messages)
    resetChat()
  }

  function openConversation(conversation: Conversation) {
    persist(chatMeta, messages)
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

  if (view === 'chat' && active) {
    return (
      <ChatView
        loaded={active}
        chatId={chatMeta.id}
        messages={messages}
        setMessages={setMessages}
        onShowModels={() => setView('setup')}
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
      onOpen={openModel}
      onDelete={removeModel}
      onBackToChat={active ? () => setView('chat') : undefined}
    />
  )
}
