import type { DocChunk } from './store'

export const ACCEPTED_FILES = '.pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown'

const CHUNK_CHARS = 700

/** Text of each PDF page. PDF.js is loaded only when a PDF is opened. */
async function pdfPages(file: File): Promise<string[]> {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerUrl
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const pdf = await task.promise
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''))
    }
    return pages
  } finally {
    await task.destroy()
  }
}

/** Splits text into passages of about CHUNK_CHARS characters, at sentence boundaries. */
export function chunk(text: string, page: number | null): DocChunk[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?;:])\s+/)
  const chunks: DocChunk[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHARS) {
      chunks.push({ text: current, page })
      current = ''
    }
    // A very long "sentence" (tables, lists without punctuation) is cut hard.
    for (let start = 0; start < sentence.length; start += CHUNK_CHARS) {
      const piece = sentence.slice(start, start + CHUNK_CHARS)
      if (current && current.length + piece.length > CHUNK_CHARS) {
        chunks.push({ text: current, page })
        current = ''
      }
      current = current ? `${current} ${piece}` : piece
    }
  }
  if (current) chunks.push({ text: current, page })
  return chunks
}

export async function extractChunks(file: File): Promise<DocChunk[]> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (isPdf) return (await pdfPages(file)).flatMap((text, i) => chunk(text, i + 1))
  return chunk(await file.text(), null)
}
