import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { describeError, generateReply, isAbortError, type ChatMessage, type LoadedModel } from './ai/engine'
import Brand from './Brand'

export interface ChatEntry extends ChatMessage {
  tokensPerSecond?: number
  error?: boolean
}

interface ChatViewProps {
  loaded: LoadedModel
  messages: ChatEntry[]
  setMessages: Dispatch<SetStateAction<ChatEntry[]>>
  onShowModels: () => void
}

const SUGGESTIONS = [
  'Explain how rainbows form in simple terms.',
  'Write a short poem about the ocean.',
  'Give me three tips to focus while studying.',
]

export default function ChatView({ loaded, messages, setMessages, onShowModels }: ChatViewProps) {
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const updateLast = (patch: (m: ChatEntry) => ChatEntry) =>
    setMessages((prev) => [...prev.slice(0, -1), patch(prev[prev.length - 1])])

  async function send(text: string) {
    const content = text.trim()
    if (!content || generating) return

    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content })),
      { role: 'user', content },
    ]
    setMessages((prev) => [...prev, { role: 'user', content }, { role: 'assistant', content: '' }])
    setInput('')
    setGenerating(true)

    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const { tokensPerSecond } = await generateReply(
        history,
        (piece) => updateLast((m) => ({ ...m, content: m.content + piece })),
        controller.signal,
      )
      updateLast((m) => ({ ...m, tokensPerSecond }))
    } catch (err) {
      if (isAbortError(err)) {
        updateLast((m) => (m.content ? m : { ...m, content: 'Stopped.', error: true }))
      } else {
        updateLast((m) => ({ ...m, content: describeError(err), error: true }))
      }
    } finally {
      controllerRef.current = null
      setGenerating(false)
    }
  }

  return (
    <div className="chat-layout">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <div className="topbar-actions">
            <span
              className="badge"
              title={`${loaded.model.name}, running on ${loaded.backend} with ${loaded.threads} thread(s)`}
            >
              {loaded.model.tier} · {loaded.backend}
            </span>
            <button className="btn ghost" onClick={() => setMessages([])} disabled={generating || !messages.length}>
              New chat
            </button>
            <button className="btn ghost" onClick={onShowModels} disabled={generating}>
              Models
            </button>
          </div>
        </div>
      </header>

      <div className="messages" ref={listRef}>
        <div className="container messages-inner">
          {messages.length === 0 ? (
            <div className="empty">
              <h2>Ask me anything.</h2>
              <p className="section-intro">I run entirely on this device, so this chat works offline.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button className="suggestion" key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}${m.error ? ' error' : ''}`}>
                <div className="bubble">{m.content || <span className="thinking">Thinking…</span>}</div>
                {m.tokensPerSecond !== undefined && (
                  <span className="meta">{m.tokensPerSecond.toFixed(1)} tokens/s</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <div className="container composer-inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Message Pocket AI"
            rows={1}
            aria-label="Message"
          />
          {generating ? (
            <button type="button" className="btn stop" onClick={() => controllerRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
        <p className="container disclaimer">Runs on your device. Small models can make mistakes.</p>
      </form>
    </div>
  )
}
