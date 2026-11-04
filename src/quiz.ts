import { generateJson } from './ai/engine'
import type { DocRecord } from './docs/store'
import type { ReplySettings } from './settings'

/** One multiple-choice question about a passage of the user's documents. */
export interface QuizItem {
  question: string
  choices: string[]
  /** Index of the correct choice. */
  answer: number
  explanation: string
  /** Where the passage comes from, e.g. "notes.pdf p. 4". */
  source: string
}

interface RawItem {
  question: string
  choices: string[]
  answer: number
  explanation: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    answer: { type: 'integer', minimum: 0, maximum: 3 },
    explanation: { type: 'string' },
  },
  required: ['question', 'choices', 'answer', 'explanation'],
  additionalProperties: false,
}

// Written in the target language: small models follow that far better than an English rule.
const PROMPTS = {
  indonesian: {
    system: 'Kamu membuat soal latihan untuk pelajar dari teks dokumen mereka sendiri. Setiap soal harus bisa dijawab dari teks itu saja.',
    task: (passage: string) =>
      `Teks:\n"""\n${passage}\n"""\n\nBuat satu soal pilihan ganda dalam Bahasa Indonesia yang menguji pemahaman fakta penting dari teks ini. ` +
      'Beri 4 pilihan jawaban singkat: tepat satu benar (tertulis di teks) dan tiga salah tetapi masuk akal. ' +
      '"answer" adalah nomor urut (0 sampai 3) pilihan yang benar. "explanation" menjelaskan dalam satu kalimat mengapa jawaban itu benar, berdasarkan teks.',
  },
  english: {
    system: "You write practice questions for students from a passage of their own document. Every question must be answerable from the passage alone.",
    task: (passage: string) =>
      `Passage:\n"""\n${passage}\n"""\n\nWrite one multiple-choice question in English that checks understanding of an important fact in this passage. ` +
      'Give 4 short answer choices: exactly one correct (stated in the passage) and three plausible but wrong. ' +
      '"answer" is the index (0 to 3) of the correct choice. "explanation" says in one sentence why it is correct, based on the passage.',
  },
}

/** Passages spread evenly through the documents, skipping scraps such as titles and page numbers. */
function pickPassages(docs: DocRecord[], count: number) {
  const passages = docs
    .flatMap((doc) =>
      doc.chunks.map((chunk, i) => ({
        text: chunk.text,
        source: `${doc.name} ${chunk.page !== null ? `p. ${chunk.page}` : `part ${i + 1}`}`,
      })),
    )
    .filter((p) => p.text.length >= 250)
  if (passages.length <= count) return passages
  const step = passages.length / count
  return Array.from({ length: count }, (_, i) => passages[Math.floor(i * step + step / 2)])
}

/** A usable question: four different, non-empty choices and an answer among them. */
function check(raw: RawItem): RawItem | null {
  const choices = raw.choices?.map((c) => String(c).trim())
  const distinct = new Set(choices?.map((c) => c.toLowerCase()))
  if (!raw.question?.trim() || choices?.length !== 4 || distinct.size !== 4 || choices.some((c) => !c)) return null
  if (!Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer > 3) return null
  return { ...raw, question: raw.question.trim(), choices, explanation: raw.explanation?.trim() ?? '' }
}

/** Small models tend to put the right answer first, so the choices are shuffled. */
function shuffled(item: RawItem): RawItem {
  const order = [0, 1, 2, 3]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return { ...item, choices: order.map((i) => item.choices[i]), answer: order.indexOf(item.answer) }
}

/**
 * Writes up to count questions, one per passage, handing each over as soon as it is ready.
 * A passage whose question comes out unusable is skipped.
 */
export async function makeQuiz(
  docs: DocRecord[],
  count: number,
  language: ReplySettings['language'],
  onItem: (item: QuizItem) => void,
  signal: AbortSignal,
) {
  const passages = pickPassages(docs, count)
  if (!passages.length) throw new Error('The document has too little text to make a quiz.')
  const prompts = language === 'indonesian' ? PROMPTS.indonesian : PROMPTS.english
  for (const passage of passages) {
    signal.throwIfAborted()
    const raw = await generateJson<RawItem>(prompts.system, prompts.task(passage.text), SCHEMA, signal, 400).catch((err) => {
      if (signal.aborted) throw err
      return null
    })
    const item = raw && check(raw)
    if (item) onItem({ ...shuffled(item), source: passage.source })
  }
}
