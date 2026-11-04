/**
 * Dates for the AI. Small models do not know today's date and cannot count days or find a
 * weekday reliably, so the app works these out and gives them to the model as facts.
 */

const DAY_MS = 86_400_000

const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
}
const DAY_NAMES = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
}

// Month words in English and Indonesian, full and short, to their index.
const MONTH_WORDS: Record<string, number> = {}
MONTH_NAMES.en.forEach((name, i) => {
  MONTH_WORDS[name.toLowerCase()] = i
  MONTH_WORDS[name.slice(0, 3).toLowerCase()] = i
})
MONTH_NAMES.id.forEach((name, i) => {
  MONTH_WORDS[name.toLowerCase()] = i
  MONTH_WORDS[name.slice(0, 3).toLowerCase()] = i
})
Object.assign(MONTH_WORDS, { sept: 8, nopember: 10, pebruari: 1 })
const MONTH_PATTERN = Object.keys(MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|')

export function formatDate(date: Date, indonesian: boolean) {
  const lang = indonesian ? 'id' : 'en'
  return `${DAY_NAMES[lang][date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[lang][date.getMonth()]} ${date.getFullYear()}`
}

/**
 * Today's date for the system prompt. The time is left out so the prompt stays the same all day
 * and the engine can reuse its work on it from one message to the next. "Only when it matters":
 * told plainly that today is a date, Gemma 3 1B began unrelated answers with it.
 */
export const todayLine = (indonesian: boolean, now = new Date()) =>
  indonesian
    ? `Tanggal hari ini, sebutkan hanya bila perlu: ${formatDate(now, true)}.`
    : `Today's date, to mention only when it matters: ${formatDate(now, false)}.`

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
// Rounded, so a day with a daylight-saving change still counts as one.
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)

/** A real calendar date, or null (e.g. 31 February). */
function makeDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null
}

/** A day and month without a year: the next time it comes, today included. */
function nextOccurrence(month: number, day: number, now: Date): Date | null {
  const thisYear = makeDate(now.getFullYear(), month, day)
  if (thisYear && daysBetween(now, thisYear) >= 0) return thisYear
  return makeDate(now.getFullYear() + 1, month, day)
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

export interface DateFacts {
  /** Sentences for the AI. */
  facts: string[]
  /** Short notes shown under the reply. */
  labels: string[]
}

/**
 * Dates a question names ("17 Agustus 2027", "2027-08-17", "besok", "in 30 days") with their
 * weekday and distance from today, and the time when the question asks for it.
 */
export function dateFacts(question: string, indonesian: boolean, now = new Date()): DateFacts {
  // Punctuation becomes spaces, except what dates are written with (17/8, 17.8, 17-8, August 17, 2027).
  const text = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}/.,:-]+/gu, ' ').replace(/\s+/g, ' ')} `
  const found: Date[] = []
  const add = (date: Date | null) => {
    if (date && !found.some((d) => d.getTime() === date.getTime())) found.push(date)
  }

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(makeDate(+m[1], +m[2] - 1, +m[3]))
  // Day first, as written in Indonesia and Europe: 17/8/2027, 17-08-2027, 17.8.2027.
  for (const m of text.matchAll(/\b(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})\b/g)) add(makeDate(fullYear(m[4]), +m[3] - 1, +m[1]))
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2}) (${MONTH_PATTERN})\\b(?: (\\d{4}))?`, 'g'))) {
    const month = MONTH_WORDS[m[2]]
    add(m[3] ? makeDate(+m[3], month, +m[1]) : nextOccurrence(month, +m[1], now))
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?`, 'g'))) {
    const month = MONTH_WORDS[m[1]]
    add(m[3] ? makeDate(+m[3], month, +m[2]) : nextOccurrence(month, +m[2], now))
  }

  const relative: [RegExp, number][] = [
    [/\b(lusa|day after tomorrow)\b/, 2],
    [/\b(besok|tomorrow)\b/, 1],
    [/\b(kemarin|yesterday)\b/, -1],
  ]
  for (const [pattern, days] of relative) if (pattern.test(text)) add(addDays(now, days))
  const counted: [RegExp, number][] = [
    [/\b(\d+) ?(hari|days?) ?(lagi|dari sekarang|from now|later|kemudian)\b/g, 1],
    [/\bin (\d+) ?(days?)\b/g, 1],
    [/\b(\d+) ?(hari|days?) ?(yang lalu|lalu|ago|sebelumnya)\b/g, -1],
    [/\b(\d+) ?(minggu|weeks?) ?(lagi|dari sekarang|from now|later)\b/g, 7],
    [/\bin (\d+) ?(weeks?)\b/g, 7],
  ]
  for (const [pattern, unit] of counted) for (const m of text.matchAll(pattern)) add(addDays(now, +m[1] * unit))

  const facts: string[] = []
  const labels: string[] = []
  for (const date of found.slice(0, 4)) {
    const days = daysBetween(now, date)
    const name = formatDate(date, indonesian)
    const when = indonesian
      ? days === 0 ? 'adalah hari ini' : days > 0 ? `adalah ${days} hari dari hari ini` : `adalah ${-days} hari yang lalu`
      : days === 0 ? 'is today' : days > 0 ? `is ${days} days from today` : `was ${-days} days ago`
    facts.push(`${name} ${when}.`)
    labels.push(`${formatDate(date, false)}: ${days === 0 ? 'today' : days > 0 ? `in ${days} days` : `${-days} days ago`}`)
  }
  if (/\b(jam berapa|pukul berapa|what time|the time|waktu sekarang|jam sekarang)\b/.test(text)) {
    const time = now.toLocaleTimeString(indonesian ? 'id-ID' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
    facts.push(indonesian ? `Sekarang pukul ${time}.` : `The time now is ${time}.`)
    labels.push(`time: ${time}`)
  }
  return { facts, labels }
}
