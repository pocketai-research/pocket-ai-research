import { useCallback, useEffect, useRef, useState } from 'react'
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
import SetupView, { type LoadingState } from './SetupView'

const LAST_MODEL_KEY = 'pocket-ai:last-model'

function readLastModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY)
  } catch {
    return null
  }
}

function saveLastModel(id: string) {
  try {
    localStorage.setItem(LAST_MODEL_KEY, id)
  } catch {
    // Storage can be unavailable (private mode); remembering the model is optional.
  }
}

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
  // JSON of the messages last written to (or read from) storage, to skip redundant saves.
  const savedSnapshot = useRef('[]')

  const refreshDownloaded = useCallback(() => listDownloadedUrls().then(setDownloaded), [])

  const openModel = useCallback(
    async (model: ModelOption) => {
      setError(null)
      setLoading({ modelId: model.id, progress: 0 })
      try {
        const result = await loadModel(model, (progress) => setLoading({ modelId: model.id, progress }))
        setActive(result)
        saveLastModel(model.id)
        setView('chat')
      } catch (err) {
        setError(describeError(err))
      } finally {
        setLoading(null)
        refreshDownloaded()
      }
    },
    [refreshDownloaded],
  )

  // Reopen the last used model straight into the chat when it is already on the device.
  useEffect(() => {
    listDownloadedUrls().then((urls) => {
      setDownloaded(urls)
      const last = MODELS.find((m) => m.id === readLastModel())
      if (last && urls.has(last.url)) openModel(last)
    })
  }, [openModel])

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
      onOpen={openModel}
      onDelete={removeModel}
      onBackToChat={active ? () => setView('chat') : undefined}
    />
  )
}
