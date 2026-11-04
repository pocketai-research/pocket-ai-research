import { useEffect, useState } from 'react'
import { listConversations, type Conversation } from './chatStore'
import { CloseIcon, TrashIcon } from './icons'

interface ChatHistoryProps {
  currentId: string
  onClose: () => void
  onNew: () => void
  onOpen: (conversation: Conversation) => void
  onDelete: (id: string) => Promise<void>
}

function formatDate(time: number) {
  const date = new Date(time)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/** Where the words occur in a chat: its title, or a few words around them in a message. */
function findIn(conversation: Conversation, query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return ''
  if (conversation.title.toLowerCase().includes(q)) return ''
  for (const message of conversation.messages) {
    const at = message.content.toLowerCase().indexOf(q)
    if (at < 0) continue
    const start = Math.max(0, at - 40)
    const end = Math.min(message.content.length, at + q.length + 60)
    return `${start ? '…' : ''}${message.content.slice(start, end).replace(/\s+/g, ' ')}${end < message.content.length ? '…' : ''}`
  }
  return null
}

export default function ChatHistory({ currentId, onClose, onNew, onOpen, onDelete }: ChatHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [query, setQuery] = useState('')
  const found = (conversations ?? [])
    .map((conversation) => ({ conversation, snippet: findIn(conversation, query) }))
    .filter((r) => r.snippet !== null)

  useEffect(() => {
    listConversations().then(setConversations)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function remove(conversation: Conversation) {
    if (!confirm(`Delete "${conversation.title}"?`)) return
    await onDelete(conversation.id)
    setConversations((list) => list?.filter((c) => c.id !== conversation.id) ?? null)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" aria-label="Saved chats" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Chats</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            onNew()
            onClose()
          }}
        >
          New chat
        </button>
        {conversations?.length === 0 && <p className="section-intro">No saved chats yet.</p>}
        {Boolean(conversations?.length) && (
          <input
            className="panel-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        )}
        {query.trim() && found.length === 0 && <p className="muted small">No chat contains “{query.trim()}”.</p>}
        <ul className="chat-list">
          {found.map(({ conversation: c, snippet }) => (
            <li key={c.id} className={c.id === currentId ? 'active' : undefined}>
              <button
                className="chat-item"
                onClick={() => {
                  onOpen(c)
                  onClose()
                }}
              >
                <span className="chat-title">{c.title}</span>
                {snippet && <span className="chat-snippet">{snippet}</span>}
                <span className="chat-date">{formatDate(c.updatedAt)}</span>
              </button>
              <button className="icon-btn" aria-label={`Delete ${c.title}`} onClick={() => remove(c)}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
