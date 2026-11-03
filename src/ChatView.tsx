import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Share } from '@capacitor/share'
import { describeError, generateReply, isAbortError, type ChatMessage, type LoadedModel } from './ai/engine'
import Brand from './Brand'
import ChatHistory from './ChatHistory'
import type { ChatEntry, Conversation } from './chatStore'
import { ACCEPTED_FILES } from './docs/extract'
import { retrieve } from './docs/retrieve'
import { getDocuments, type DocSummary } from './docs/store'
import {
  CopyIcon,
  FileIcon,
  MapIcon,
  MenuIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshIcon,
  ShareIcon,
  SlidersIcon,
  SpeakerIcon,
  StopIcon,
} from './icons'
import Markdown from './Markdown'
import type { ReplySettings } from './settings'
import { canListen, listen, speak, speechLanguage, stopListening, stopSpeaking } from './voice'

interface ChatViewProps {
  loaded: LoadedModel
  replySettings: ReplySettings
  chatId: string
  messages: ChatEntry[]
  setMessages: Dispatch<SetStateAction<ChatEntry[]>>
  /** Documents attached to this chat; questions are answered from them. */
  documents: DocSummary[]
  /** Name of a file being read, or an error from reading one. */
  attachStatus: { reading?: string; error?: string }
  onAttach: (file: File) => void
  onDetach: (id: string) => void
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

const DOCUMENT_SUGGESTIONS = ['Summarise this document.', 'What are the key points?']

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
  const { onDeleteChat, documents, attachStatus, onAttach, onDetach } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [micAvailable, setMicAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    canListen().then(setMicAvailable)
    return () => stopSpeaking()
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const updateLast = (patch: (m: ChatEntry) => ChatEntry) =>
    setMessages((prev) => [...prev.slice(0, -1), patch(prev[prev.length - 1])])

  function send(text: string) {
    const content = text.trim()
    if (!content || generating) return
    stopSpeaking()
    setMessages((prev) => [...prev, { role: 'user', content }, { role: 'assistant', content: '' }])
    setInput('')
    streamInto([...toHistory(messages), { role: 'user', content }], messages.length + 1)
  }

  /** Speech input: the transcript fills the box as it forms and is sent when the speaker pauses. */
  async function toggleListening() {
    if (listening) return stopListening()
    stopSpeaking()
    setVoiceError(null)
    setListening(true)
    try {
      const text = await listen(speechLanguage(replySettings.language), setInput)
      if (text.trim()) send(text)
      else setInput('')
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : String(err))
    } finally {
      setListening(false)
    }
  }

  async function readAloud(text: string, index: number) {
    setSpeakingIndex(index)
    try {
      await speak(text, replySettings.language)
    } catch (err) {
      setVoiceError(`Could not read the reply aloud: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSpeakingIndex((current) => (current === index ? null : current))
    }
  }

  function toggleReadAloud(text: string, index: number) {
    if (speakingIndex === index) {
      stopSpeaking()
      setSpeakingIndex(null)
    } else {
      readAloud(text, index)
    }
  }

  /** Replaces the last reply with a new one for the same question. */
  function regenerate() {
    let lastUser = messages.length - 1
    while (lastUser >= 0 && messages[lastUser].role !== 'user') lastUser--
    if (lastUser < 0 || generating) return
    stopSpeaking()
    setMessages((prev) => [...prev.slice(0, lastUser + 1), { role: 'assistant', content: '' }])
    streamInto(toHistory(messages.slice(0, lastUser + 1)), lastUser + 1)
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

  /** Streams a reply into the empty assistant message at the end of the list (at replyIndex). */
  async function streamInto(history: ChatMessage[], replyIndex: number) {
    let replyText = ''
    setGenerating(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      let context: string | undefined
      if (documents.length) {
        // Leave room for the reply and the chat: about 3,000 characters of excerpts in a 4,096 context.
        const budget = Math.max(1200, ((loaded.model.contextSize ?? 4096) - 2048) * 1.5)
        const found = retrieve(await getDocuments(documents.map((d) => d.id)), history.at(-1)?.content ?? '', budget)
        context = found.context
        updateLast((m) => ({ ...m, sources: found.sources }))
      }
      const { tokensPerSecond } = await generateReply(
        history,
        { reply: replySettings, context },
        (piece) => {
          replyText += piece
          updateLast((m) => ({ ...m, content: m.content + piece }))
        },
        controller.signal,
      )
      updateLast((m) => ({ ...m, tokensPerSecond }))
      if (replySettings.readAloud === 'on' && replyText.trim()) readAloud(replyText, replyIndex)
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
              <h2>{documents.length ? 'Ask about your document.' : 'Ask me anything.'}</h2>
              <p className="section-intro">
                {documents.length
                  ? 'Answers come from the attached document, read on this device.'
                  : 'I run entirely on this device, so this chat works offline. Tap the paperclip to ask about a PDF or text file.'}
              </p>
              <div className="suggestions">
                {(documents.length ? DOCUMENT_SUGGESTIONS : SUGGESTIONS).map((s) => (
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
                    {!m.error && (
                      <button
                        className="msg-action"
                        aria-label={speakingIndex === i ? 'Stop reading' : 'Read aloud'}
                        title={speakingIndex === i ? 'Stop reading' : 'Read aloud'}
                        onClick={() => toggleReadAloud(m.content, i)}
                      >
                        {speakingIndex === i ? <StopIcon /> : <SpeakerIcon />}
                      </button>
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
                {m.role === 'assistant' && !m.error && m.sources?.length ? (
                  <div className="sources">Sources: {m.sources.map((s, n) => `[${n + 1}] ${s}`).join(' · ')}</div>
                ) : null}
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
        {(listening || voiceError) && (
          <p className={`container voice-status${voiceError ? ' error' : ''}`} role="status">
            {voiceError ?? 'Listening… speak now, then pause to send.'}
          </p>
        )}
        {(documents.length > 0 || attachStatus.reading || attachStatus.error) && (
          <div className="container doc-chips">
            {documents.map((doc) => (
              <span className="doc-chip" key={doc.id}>
                <FileIcon />
                <span className="doc-name">{doc.name}</span>
                <button type="button" aria-label={`Remove ${doc.name} from this chat`} onClick={() => onDetach(doc.id)}>
                  ×
                </button>
              </span>
            ))}
            {attachStatus.reading && <span className="doc-chip muted">Reading {attachStatus.reading}…</span>}
            {attachStatus.error && <span className="doc-error">{attachStatus.error}</span>}
          </div>
        )}
        <div className="container composer-inner">
          <button
            type="button"
            className="icon-btn attach"
            aria-label="Attach a document"
            title="Attach a PDF or text file"
            onClick={() => fileRef.current?.click()}
            disabled={generating || Boolean(attachStatus.reading)}
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_FILES}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onAttach(file)
            }}
          />
          {micAvailable && (
            <button
              type="button"
              className={`icon-btn mic${listening ? ' listening' : ''}`}
              aria-label={listening ? 'Stop listening' : 'Speak a message'}
              title={listening ? 'Stop listening' : 'Speak a message'}
              onClick={toggleListening}
              disabled={generating}
            >
              <MicIcon />
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder={documents.length ? 'Ask about your document' : 'Message Pocket Ai Research'}
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
