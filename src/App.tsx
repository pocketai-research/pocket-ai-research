import { useCallback, useEffect, useState } from 'react'
import { deleteModel, describeError, listDownloadedUrls, loadModel, type LoadedModel } from './ai/engine'
import { MODELS, type ModelOption } from './ai/models'
import ChatView, { type ChatEntry } from './ChatView'
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

export default function App() {
  const [downloaded, setDownloaded] = useState<Set<string> | null>(null)
  const [loading, setLoading] = useState<LoadingState | null>(null)
  const [active, setActive] = useState<LoadedModel | null>(null)
  const [view, setView] = useState<'setup' | 'chat'>('setup')
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [error, setError] = useState<string | null>(null)

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

  async function removeModel(model: ModelOption) {
    if (!confirm(`Delete ${model.name} from this device? You will need to download it again to use it.`)) return
    await deleteModel(model)
    if (active?.model.id === model.id) setActive(null)
    refreshDownloaded()
  }

  if (view === 'chat' && active) {
    return <ChatView loaded={active} messages={messages} setMessages={setMessages} onShowModels={() => setView('setup')} />
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
