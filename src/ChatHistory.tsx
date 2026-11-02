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

export default function ChatHistory({ currentId, onClose, onNew, onOpen, onDelete }: ChatHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)

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
        <ul className="chat-list">
          {conversations?.map((c) => (
            <li key={c.id} className={c.id === currentId ? 'active' : undefined}>
              <button
                className="chat-item"
                onClick={() => {
                  onOpen(c)
                  onClose()
                }}
              >
                <span className="chat-title">{c.title}</span>
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
