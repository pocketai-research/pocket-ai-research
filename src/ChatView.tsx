import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Share } from '@capacitor/share'
import { describeError, generateReply, isAbortError, type ChatMessage, type LoadedModel } from './ai/engine'
import Brand from './Brand'
import ChatHistory from './ChatHistory'
import type { ChatEntry, Conversation } from './chatStore'
import { CopyIcon, MapIcon, MenuIcon, PlusIcon, RefreshIcon, ShareIcon, SlidersIcon } from './icons'
import Markdown from './Markdown'
import type { ReplySettings } from './settings'

interface ChatViewProps {
  loaded: LoadedModel
  replySettings: ReplySettings
  chatId: string
  messages: ChatEntry[]
  setMessages: Dispatch<SetStateAction<ChatEntry[]>>
  onShowModels: () => void
  onShowMap: () => void
  onNewChat: () => void
  onOpenChat: (conversation: Conversation) => void
  onDeleteChat: (id: string) => Promise<void>
}

const SUGGESTIONS = [
  'Explain how rainbows form in simple terms.',
  'Write a short poem about the ocean.',
  'Give me three tips to focus while studying.',
]

/** Clipboard API first; the textarea fallback covers WebViews that refuse it. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

const toHistory = (entries: ChatEntry[]): ChatMessage[] =>
  entries.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content }))

export default function ChatView(props: ChatViewProps) {
  const { loaded, replySettings, chatId, messages, setMessages, onShowModels, onShowMap, onNewChat, onOpenChat } = props
  const { onDeleteChat } = props
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const updateLast = (patch: (m: ChatEntry) => ChatEntry) =>
    setMessages((prev) => [...prev.slice(0, -1), patch(prev[prev.length - 1])])

  function send(text: string) {
    const content = text.trim()
    if (!content || generating) return
    setMessages((prev) => [...prev, { role: 'user', content }, { role: 'assistant', content: '' }])
    setInput('')
    streamInto([...toHistory(messages), { role: 'user', content }])
  }

  /** Replaces the last reply with a new one for the same question. */
  function regenerate() {
    let lastUser = messages.length - 1
    while (lastUser >= 0 && messages[lastUser].role !== 'user') lastUser--
    if (lastUser < 0 || generating) return
    setMessages((prev) => [...prev.slice(0, lastUser + 1), { role: 'assistant', content: '' }])
    streamInto(toHistory(messages.slice(0, lastUser + 1)))
  }

  async function copyReply(text: string, index: number) {
    if (await copyText(text)) {
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500)
    }
  }

  async function shareReply(text: string, index: number) {
    try {
      if ((await Share.canShare()).value) return void (await Share.share({ text }))
    } catch {
      // The share sheet was dismissed or is unavailable; copying is the fallback below.
    }
    copyReply(text, index)
  }

  /** Streams a reply into the empty assistant message at the end of the list. */
  async function streamInto(history: ChatMessage[]) {
    setGenerating(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const { tokensPerSecond } = await generateReply(
        history,
        { reply: replySettings },
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
          <div className="topbar-start">
            <button
              className="icon-btn"
              aria-label="Saved chats"
              title="Saved chats"
              onClick={() => setHistoryOpen(true)}
              disabled={generating}
            >
              <MenuIcon />
            </button>
            <Brand />
          </div>
          <div className="topbar-actions">
            <span
              className="badge"
              title={`${loaded.model.name}, running on ${loaded.backend} with ${loaded.threads} thread(s)`}
            >
              {loaded.model.tier} · {loaded.backend}
            </span>
            <button
              className="icon-btn"
              aria-label="New chat"
              title="New chat"
              onClick={onNewChat}
              disabled={generating || !messages.length}
            >
              <PlusIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Offline map"
              title="Offline map"
              onClick={onShowMap}
              disabled={generating}
            >
              <MapIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Models and settings"
              title="Models and settings"
              onClick={onShowModels}
              disabled={generating}
            >
              <SlidersIcon />
            </button>
          </div>
        </div>
      </header>

      {historyOpen && (
        <ChatHistory
          currentId={chatId}
          onClose={() => setHistoryOpen(false)}
          onNew={onNewChat}
          onOpen={onOpenChat}
          onDelete={onDeleteChat}
        />
      )}

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
                <div className="bubble">
                  {!m.content ? (
                    <span className="thinking">Thinking…</span>
                  ) : m.role === 'assistant' && !m.error ? (
                    <Markdown text={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === 'assistant' && m.content && !(generating && i === messages.length - 1) && (
                  <div className="msg-actions">
                    {!m.error && (
                      <>
                        <button className="msg-action" aria-label="Copy" title="Copy" onClick={() => copyReply(m.content, i)}>
                          {copiedIndex === i ? <span>Copied</span> : <CopyIcon />}
                        </button>
                        <button className="msg-action" aria-label="Share" title="Share" onClick={() => shareReply(m.content, i)}>
                          <ShareIcon />
                        </button>
                      </>
                    )}
                    {i === messages.length - 1 && (
                      <button
                        className="msg-action"
                        aria-label="Regenerate reply"
                        title="Regenerate reply"
                        onClick={regenerate}
                      >
                        <RefreshIcon />
                      </button>
                    )}
                    {m.tokensPerSecond !== undefined && (
                      <span className="meta">{m.tokensPerSecond.toFixed(1)} tokens/s</span>
                    )}
                  </div>
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
            placeholder="Message Pocket Ai Research"
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
