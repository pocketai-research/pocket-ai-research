import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Share } from '@capacitor/share'
import { embedTexts } from './ai/embeddings'
import { describeError, generateReply, isAbortError, type ChatMessage, type LoadedModel } from './ai/engine'
import Brand from './Brand'
import ChatHistory from './ChatHistory'
import { copyText } from './clipboard'
import type { ChatEntry, Conversation } from './chatStore'
import { ACCEPTED_FILES } from './docs/extract'
import { retrieve } from './docs/retrieve'
import { getDocuments, type DocSummary } from './docs/store'
import {
  CameraIcon,
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
import { DETAIL_PHOTO_SIZE, PHOTO_SIZE, photoToDataUrl } from './photo'
import type { Shared } from './shareTarget'
import type { ReplySettings } from './settings'
import { canListen, listen, speak, speechLanguage, stopListening, stopSpeaking } from './voice'

interface ChatViewProps {
  loaded: LoadedModel
  replySettings: ReplySettings
  onReplySettingsChange: (settings: ReplySettings) => void
  /** The user's instructions for this chat, added to the system prompt. */
  instructions: string
  onInstructionsChange: (instructions: string) => void
  /** Shown above the messages, e.g. that a new version of the app is available. */
  banner?: ReactNode
  /** Text or a photo shared from another app, to put in the message box. */
  incoming: Shared | null
  onIncomingUsed: () => void
  chatId: string
  messages: ChatEntry[]
  setMessages: Dispatch<SetStateAction<ChatEntry[]>>
  /** Documents attached to this chat; questions are answered from them. */
  documents: DocSummary[]
  /** Name of a file being read, or an error from reading one. */
  attachStatus: { reading?: string; error?: string }
  onAttach: (file: File) => void
  onDetach: (id: string) => void
  /** Opens the vision model, for photos. */
  onUseVisionModel: () => void
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

interface Template {
  label: string
  prompt: string
  /** Translations need the reply in their target language, whatever the reply settings say. */
  language?: ReplySettings['language']
}

const TEMPLATES: Template[] = [
  { label: 'Summarise', prompt: 'Summarise the following text in a few short bullet points:' },
  { label: 'Translate to English', prompt: 'Translate the following text into English. Reply with the translation only:', language: 'english' },
  {
    label: 'Translate to Indonesian',
    prompt: 'Translate the following text into Indonesian. Reply with the translation only:',
    language: 'indonesian',
  },
  {
    label: 'Fix grammar',
    prompt: 'Fix the grammar and spelling of the following text, keeping its language and meaning. Reply with the corrected text only:',
    language: 'auto',
  },
  { label: 'Write an email', prompt: 'Write a short, polite email about the following:' },
  { label: 'Explain simply', prompt: 'Explain the following simply, as to a beginner:' },
]

/** The text without a template's prompt in front of it. */
const withoutTemplate = (text: string) => {
  const used = TEMPLATES.find((t) => text.startsWith(t.prompt))
  return used ? text.slice(used.prompt.length).replace(/^\s+/, '') : text
}

const INSTRUCTION_PRESETS = [
  'Answer briefly, in two or three sentences.',
  'You are a patient maths teacher. Explain step by step.',
  'Explain things simply, as if to a 12-year-old.',
  'Always reply in casual Indonesian.',
]

const toHistory = (entries: ChatEntry[]): ChatMessage[] =>
  entries.filter((m) => !m.error && m.content).map(({ role, content, image, detail }) => ({ role, content, image, detail }))

export default function ChatView(props: ChatViewProps) {
  const { loaded, replySettings, chatId, messages, setMessages, onShowModels, onShowMap, onNewChat, onOpenChat } = props
  const { onDeleteChat, documents, attachStatus, onAttach, onDetach, onUseVisionModel } = props
  const { onReplySettingsChange, instructions, onInstructionsChange, banner, incoming, onIncomingUsed } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  // A photo waiting to be sent with the next message (kept with its file so it can be redone in
  // detail), and whether to explain that it needs the vision model.
  const [photo, setPhoto] = useState<{ file: File; url: string; detail: boolean } | null>(null)
  const [photoNotice, setPhotoNotice] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [micAvailable, setMicAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [template, setTemplate] = useState<Template | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    canListen().then(setMicAvailable)
    return () => stopSpeaking()
  }, [])

  // A shared photo needs the Vision model: it waits (with the switch offered) until that is open.
  useEffect(() => {
    if (!incoming) return
    if (incoming.text) setInput(incoming.text)
    if (incoming.file?.type.startsWith('image/')) {
      if (!loaded.vision) return setPhotoNotice('Photos need the Vision model.')
      addPhoto(incoming.file)
    }
    onIncomingUsed()
    // Runs once per share, and again when the Vision model opens for a waiting photo.
  }, [incoming?.id, loaded.vision])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const updateLast = (patch: (m: ChatEntry) => ChatEntry) =>
    setMessages((prev) => [...prev.slice(0, -1), patch(prev[prev.length - 1])])

  function send(text: string) {
    const image = photo?.url
    const content = text.trim() || (image ? 'Describe this photo.' : '')
    if (!content || generating) return
    stopSpeaking()
    // A translation template sets the reply's language, as long as its prompt is still there.
    const replyLanguage = template?.language && content.startsWith(template.prompt) ? template.language : undefined
    const message: ChatEntry = {
      role: 'user',
      content,
      image,
      ...(photo?.detail ? { detail: true } : {}),
      ...(replyLanguage ? { replyLanguage } : {}),
    }
    setMessages((prev) => [...prev, message, { role: 'assistant', content: '' }])
    setInput('')
    setPhoto(null)
    setTemplate(null)
    streamInto([...toHistory(messages), message], messages.length + 1, replyLanguage)
  }

  function pickPhoto() {
    if (!loaded.vision) {
      setPhotoNotice('Photos need the Vision model.')
      return
    }
    setPhotoNotice(null)
    photoRef.current?.click()
  }

  async function addPhoto(file: File) {
    try {
      setPhoto({ file, url: await photoToDataUrl(file), detail: false })
    } catch {
      setPhotoNotice('This image could not be opened. Try a JPEG or PNG photo.')
    }
  }

  /** Redoes the waiting photo at the size for detail (several tiles) or back at one tile. */
  async function togglePhotoDetail() {
    if (!photo) return
    const detail = !photo.detail
    try {
      const url = await photoToDataUrl(photo.file, detail ? DETAIL_PHOTO_SIZE : PHOTO_SIZE)
      setPhoto((current) => (current?.file === photo.file ? { ...current, url, detail } : current))
    } catch {
      setPhotoNotice('This image could not be opened. Try a JPEG or PNG photo.')
    }
  }

  /** Puts the template's prompt in front of what is already typed, ready for the text to go after it. */
  function chooseTemplate(next: Template | null) {
    const text = withoutTemplate(input)
    setInput(next ? `${next.prompt}\n\n${text}` : text)
    setTemplate(next)
    setTemplatesOpen(false)
    requestAnimationFrame(() => {
      const box = inputRef.current
      box?.focus()
      box?.setSelectionRange(box.value.length, box.value.length)
    })
  }

  function saveInstructions(text: string) {
    onInstructionsChange(text.trim())
    setInstructionsOpen(false)
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
    streamInto(toHistory(messages.slice(0, lastUser + 1)), lastUser + 1, messages[lastUser].replyLanguage)
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
  async function streamInto(history: ChatMessage[], replyIndex: number, language?: ReplySettings['language']) {
    const reply = language ? { ...replySettings, language } : replySettings
    let replyText = ''
    let thoughtText = ''
    setGenerating(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      let context: string | undefined
      if (documents.length) {
        // Leave room for the reply and the chat: about 3,000 characters of excerpts in a 4,096 context.
        const budget = Math.max(1200, ((loaded.model.contextSize ?? 4096) - 2048) * 1.5)
        const docs = await getDocuments(documents.map((d) => d.id))
        const question = history.at(-1)?.content ?? ''
        let questionVector: Float32Array | undefined
        if (replySettings.docSearch === 'meaning' && docs.some((d) => d.vectors)) {
          // Without the embedding model (not downloaded yet, offline) word search still answers.
          questionVector = (await embedTexts([question], 'query').catch(() => []))[0]
        }
        const found = retrieve(docs, question, budget, questionVector)
        context = found.context
        updateLast((m) => ({ ...m, sources: found.sources }))
      }
      const { tokensPerSecond } = await generateReply(
        history,
        { reply, context, instructions },
        (piece) => {
          replyText += piece
          updateLast((m) => ({ ...m, content: m.content + piece }))
        },
        controller.signal,
        (piece) => {
          thoughtText += piece
          updateLast((m) => ({ ...m, thoughts: (m.thoughts ?? '') + piece }))
        },
      )
      if (!replyText.trim() && thoughtText) {
        const content = 'The model used up its room while thinking and did not answer. Ask a shorter question, or turn off Think first.'
        updateLast((m) => ({ ...m, content, error: true }))
      } else {
        updateLast((m) => ({ ...m, tokensPerSecond }))
      }
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
          {banner}
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
                  {m.image && <img className="msg-photo" src={m.image} alt="Photo sent with this message" />}
                  {m.thoughts &&
                    (!m.content && generating && i === messages.length - 1 ? (
                      <div className="thoughts live">
                        <span className="thinking">Thinking it through…</span>
                        <p>{m.thoughts.length > 400 ? `…${m.thoughts.slice(-400)}` : m.thoughts}</p>
                      </div>
                    ) : (
                      <details className="thoughts">
                        <summary>Show thinking</summary>
                        <p>{m.thoughts}</p>
                      </details>
                    ))}
                  {!m.content ? (
                    !m.thoughts && (
                      <span className="thinking">
                        {/* Encoding a photo takes far longer than reading text, so say so. */}
                        {messages[i - 1]?.image
                          ? messages[i - 1].detail
                            ? 'Looking at the photo in detail… this can take several minutes on a phone.'
                            : 'Looking at the photo… this can take a few minutes on a phone.'
                          : 'Thinking…'}
                      </span>
                    )
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
        {(photo || photoNotice) && (
          <div className="container doc-chips">
            {photo && (
              <span className="photo-chip">
                <img src={photo.url} alt="Photo to send" />
                <button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)}>
                  ×
                </button>
              </span>
            )}
            {photo && (
              <button
                type="button"
                className="tool-chip"
                aria-pressed={photo.detail}
                title="Send in more detail: small text is easier to read, but the photo takes about five times longer"
                onClick={togglePhotoDetail}
              >
                Detail
              </button>
            )}
            {photoNotice && (
              <span className="doc-error">
                {photoNotice}{' '}
                {!loaded.vision && (
                  <button type="button" className="link" onClick={onUseVisionModel}>
                    Switch to the Vision model
                  </button>
                )}
              </span>
            )}
          </div>
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
        {instructionsOpen && (
          <div className="container instructions-panel">
            <label htmlFor="chat-instructions">Instructions for this chat</label>
            <textarea
              id="chat-instructions"
              value={instructionsDraft}
              maxLength={500}
              rows={3}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              placeholder="For example: You are a maths teacher. Explain step by step."
            />
            <div className="instruction-presets">
              {INSTRUCTION_PRESETS.map((preset) => (
                <button type="button" key={preset} className="suggestion" onClick={() => setInstructionsDraft(preset)}>
                  {preset}
                </button>
              ))}
            </div>
            <div className="instruction-actions">
              <button type="button" className="btn primary" onClick={() => saveInstructions(instructionsDraft)}>
                Save
              </button>
              <button type="button" className="btn ghost" onClick={() => setInstructionsOpen(false)}>
                Cancel
              </button>
              {instructions && (
                <button type="button" className="link" onClick={() => saveInstructions('')}>
                  Remove instructions
                </button>
              )}
            </div>
          </div>
        )}
        {templatesOpen && (
          <div className="container template-menu" role="group" aria-label="Templates">
            {TEMPLATES.map((t) => (
              <button
                type="button"
                key={t.label}
                className="suggestion"
                aria-pressed={template === t}
                onClick={() => chooseTemplate(t)}
              >
                {t.label}
              </button>
            ))}
            {template && (
              <button type="button" className="link" onClick={() => chooseTemplate(null)}>
                No template
              </button>
            )}
          </div>
        )}
        <div className="container composer-tools">
          <button
            type="button"
            className="tool-chip"
            aria-pressed={Boolean(template)}
            aria-expanded={templatesOpen}
            title="Summarise, translate, fix grammar and more"
            onClick={() => setTemplatesOpen((open) => !open)}
            disabled={generating}
          >
            {template ? template.label : 'Templates'}
          </button>
          <button
            type="button"
            className="tool-chip"
            aria-pressed={Boolean(instructions)}
            aria-expanded={instructionsOpen}
            title={instructions ? `Instructions: ${instructions}` : 'Tell the AI how to answer in this chat'}
            onClick={() => {
              setInstructionsDraft(instructions)
              setInstructionsOpen((open) => !open)
            }}
            disabled={generating}
          >
            {instructions ? 'Instructions on' : 'Instructions'}
          </button>
          {loaded.model.canThink && (
            <button
              type="button"
              className="tool-chip"
              aria-pressed={replySettings.think}
              title="Think before answering: better at maths and logic, but slower"
              onClick={() => onReplySettingsChange({ ...replySettings, think: !replySettings.think })}
              disabled={generating}
            >
              Think first
            </button>
          )}
        </div>
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
          <button
            type="button"
            className="icon-btn attach"
            aria-label="Add a photo"
            title="Take or choose a photo"
            onClick={pickPhoto}
            disabled={generating}
          >
            <CameraIcon />
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) addPhoto(file)
            }}
          />
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
            ref={inputRef}
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
            <button type="submit" className="btn primary" disabled={!input.trim() && !photo}>
              Send
            </button>
          )}
        </div>
        <p className="container disclaimer">Runs on your device. Small models can make mistakes.</p>
      </form>
    </div>
  )
}
