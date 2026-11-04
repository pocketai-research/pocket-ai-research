import { useEffect, useRef, useState } from 'react'
import { describeError, isAbortError } from './ai/engine'
import { getDocuments, type DocSummary } from './docs/store'
import { CloseIcon } from './icons'
import { makeQuiz, type QuizItem } from './quiz'

interface QuizPanelProps {
  documents: DocSummary[]
  onClose: () => void
}

const COUNT = 5
const LETTERS = ['A', 'B', 'C', 'D']

/** Practice questions from the chat's documents: a multiple-choice quiz, or the same as flashcards. */
export default function QuizPanel({ documents, onClose }: QuizPanelProps) {
  const [items, setItems] = useState<QuizItem[]>([])
  const [making, setMaking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'quiz' | 'cards'>('quiz')
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [round, setRound] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)

  // A new set of questions on open and for each "New questions".
  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    setItems([])
    setMaking(true)
    setError(null)
    restart()
    getDocuments(documents.map((d) => d.id))
      .then((docs) => makeQuiz(docs, COUNT, (item) => setItems((list) => [...list, item]), controller.signal))
      .catch((err) => {
        if (!isAbortError(err) && !controller.signal.aborted) setError(describeError(err))
      })
      .finally(() => {
        if (!controller.signal.aborted) setMaking(false)
      })
    return () => controller.abort()
  }, [round])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function restart() {
    setIndex(0)
    setPicked(null)
    setScore(0)
    setFlipped(false)
  }

  function pick(choice: number) {
    if (picked !== null) return
    setPicked(choice)
    if (choice === items[index].answer) setScore((s) => s + 1)
  }

  function next() {
    setIndex((i) => i + 1)
    setPicked(null)
    setFlipped(false)
  }

  const item = items[index]
  const finished = !making && index >= items.length && items.length > 0
  const waiting = !item && making

  return (
    <div className="drawer-backdrop quiz-backdrop" onClick={onClose}>
      <section className="quiz" role="dialog" aria-modal="true" aria-label="Quiz" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Practice</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <p className="muted small quiz-docs">From {documents.map((d) => d.name).join(', ')}</p>
        <div className="mode-switch" role="group" aria-label="Practice mode">
          <button aria-pressed={mode === 'quiz'} onClick={() => (setMode('quiz'), restart())}>
            Quiz
          </button>
          <button aria-pressed={mode === 'cards'} onClick={() => (setMode('cards'), restart())}>
            Flashcards
          </button>
        </div>

        {error && <p className="alert">{error}</p>}
        {waiting && (
          <p className="thinking">
            Writing question {items.length + 1} of {COUNT}… each takes a little while on a phone.
          </p>
        )}
        {!making && !items.length && !error && <p className="alert">No usable questions came out. Try again, or use a larger model.</p>}

        {item && mode === 'quiz' && (
          <div className="quiz-card">
            <p className="quiz-progress">
              Question {index + 1} of {making ? `${items.length}+` : items.length}
            </p>
            <h3 className="quiz-question">{item.question}</h3>
            <div className="quiz-choices">
              {item.choices.map((choice, i) => {
                const state = picked === null ? '' : i === item.answer ? ' correct' : i === picked ? ' wrong' : ''
                return (
                  <button key={i} className={`quiz-choice${state}`} disabled={picked !== null} onClick={() => pick(i)}>
                    <span className="quiz-letter">{LETTERS[i]}</span>
                    <span>{choice}</span>
                  </button>
                )
              })}
            </div>
            {picked !== null && (
              <div className="quiz-feedback" role="status">
                <strong>{picked === item.answer ? 'Correct.' : `Not quite: the answer is ${LETTERS[item.answer]}.`}</strong>{' '}
                {item.explanation}
                <small>Source: {item.source}</small>
              </div>
            )}
            {picked !== null && (
              <button className="btn primary" onClick={next}>
                {index + 1 < items.length || making ? 'Next question' : 'See my score'}
              </button>
            )}
          </div>
        )}

        {item && mode === 'cards' && (
          <div className="quiz-card">
            <p className="quiz-progress">
              Card {index + 1} of {making ? `${items.length}+` : items.length}
            </p>
            <button className="flashcard" aria-pressed={flipped} onClick={() => setFlipped((f) => !f)}>
              {flipped ? (
                <>
                  <span className="flashcard-label">Answer</span>
                  <strong>{item.choices[item.answer]}</strong>
                  <span>{item.explanation}</span>
                </>
              ) : (
                <>
                  <span className="flashcard-label">Question · tap to turn over</span>
                  <strong>{item.question}</strong>
                </>
              )}
            </button>
            <div className="quiz-nav">
              <button className="btn ghost" disabled={index === 0} onClick={() => (setIndex((i) => i - 1), setFlipped(false))}>
                Previous
              </button>
              <button className="btn primary" disabled={index + 1 >= items.length && !making} onClick={next}>
                Next card
              </button>
            </div>
          </div>
        )}

        {mode === 'quiz' && finished && (
          <div className="quiz-card">
            <h3 className="quiz-question">
              Score: {score} of {items.length}
            </h3>
            <div className="quiz-nav">
              <button className="btn ghost" onClick={restart}>
                Try again
              </button>
              <button className="btn primary" onClick={() => setRound((r) => r + 1)}>
                New questions
              </button>
            </div>
          </div>
        )}
        {mode === 'cards' && !item && !making && items.length > 0 && (
          <button className="btn primary" onClick={() => setRound((r) => r + 1)}>
            New cards
          </button>
        )}
      </section>
    </div>
  )
}
