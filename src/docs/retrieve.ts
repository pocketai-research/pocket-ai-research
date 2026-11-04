import type { DocRecord } from './store'

// Common English and Indonesian words that say nothing about a passage's topic.
const STOP_WORDS = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its ' +
    'what which who whom when where why how do does did can could should would will shall may might must about into than ' +
    'then there their they them we you your i me my our not no yes so such all any some please tell explain give summary summarize ' +
    'yang dan atau di ke dari ini itu untuk dengan pada adalah dalam tidak akan juga ada oleh sebagai karena saya aku kami kita ' +
    'apa bagaimana mengapa kenapa siapa kapan berapa apakah tolong jelaskan sebutkan ringkas ringkasan dokumen bab'
  ).split(' '),
)

const tokenize = (text: string) =>
  (text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((word) => word.length > 1 && !STOP_WORDS.has(word))

interface Passage {
  docName: string
  text: string
  page: number | null
  part: number
  vector?: Float32Array
}

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// Reciprocal rank fusion: a passage near the top of either ranking rises; k damps the top ranks.
const FUSION_K = 60

export interface Retrieval {
  /** Facts for the AI's system prompt. */
  context: string
  /** Short labels for the passages used, e.g. "report.pdf p. 3". */
  sources: string[]
}

const label = (p: Passage) => `${p.docName} ${p.page !== null ? `p. ${p.page}` : `part ${p.part}`}`

/**
 * Picks the passages that best match the question, up to maxChars: by words (BM25), fused with
 * the ranking by meaning when there is a question vector and the documents are indexed. A
 * question with no topic words, e.g. "summarise this", gets the start of each document instead.
 */
export function retrieve(docs: DocRecord[], question: string, maxChars: number, questionVector?: Float32Array): Retrieval {
  const passages: Passage[] = docs.flatMap((doc) =>
    doc.chunks.map((chunk, i) => ({
      docName: doc.name,
      text: chunk.text,
      page: chunk.page,
      part: i + 1,
      vector: doc.vectors?.[i],
    })),
  )
  const tokens = passages.map((p) => tokenize(p.text))
  const avgLength = tokens.reduce((sum, t) => sum + t.length, 0) / Math.max(1, tokens.length)
  const terms = [...new Set(tokenize(question))]
  const docFreq = new Map(terms.map((term) => [term, tokens.filter((t) => t.includes(term)).length]))

  const k1 = 1.2
  const b = 0.75
  const scored = passages.map((passage, i) => {
    let score = 0
    for (const term of terms) {
      const tf = tokens[i].filter((t) => t === term).length
      if (!tf) continue
      const df = docFreq.get(term)!
      const idf = Math.log(1 + (passages.length - df + 0.5) / (df + 0.5))
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens[i].length) / avgLength))
    }
    return { passage, score, order: i }
  })

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  const byMeaning = questionVector
    ? scored
        .filter((s) => s.passage.vector)
        .map((s) => ({ ...s, similarity: dot(questionVector, s.passage.vector!) }))
        .sort((a, b) => b.similarity - a.similarity)
    : []
  let ranked = matched.length ? matched : scored // nothing matched: keep document order
  if (terms.length && byMeaning.length) {
    const fused = new Map<number, number>()
    for (const list of [matched, byMeaning]) {
      list.forEach((s, rank) => fused.set(s.order, (fused.get(s.order) ?? 0) + 1 / (FUSION_K + rank)))
    }
    ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([order]) => scored[order])
  }
  const picked: Passage[] = []
  let used = 0
  for (const { passage } of ranked) {
    if (used + passage.text.length > maxChars && picked.length) break
    picked.push(passage)
    used += passage.text.length
  }

  const lines = picked.map((p, i) => `[${i + 1}] ${label(p)}: ${p.text}`)
  return {
    context: [
      "Excerpts from the user's documents:",
      ...lines,
      'Answer using only these excerpts and cite them like [1]. If they do not contain the answer, say so.',
    ].join('\n'),
    sources: picked.map(label),
  }
}
