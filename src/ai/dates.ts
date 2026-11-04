/**
 * Dates for the AI. Small models do not know today's date and cannot count days or find a
 * weekday reliably, so the app works these out and gives them to the model as facts.
 */

const DAY_MS = 86_400_000

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Month words, full and short, to their index.
const MONTH_WORDS: Record<string, number> = { sept: 8 }
MONTH_NAMES.forEach((name, i) => {
  MONTH_WORDS[name.toLowerCase()] = i
  MONTH_WORDS[name.slice(0, 3).toLowerCase()] = i
})
const MONTH_PATTERN = Object.keys(MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|')

export const formatDate = (date: Date) =>
  `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`

/**
 * Today's date for the system prompt. The time is left out so the prompt stays the same all day
 * and the engine can reuse its work on it from one message to the next. "Only when it matters":
 * told plainly that today is a date, Gemma 3 1B began unrelated answers with it.
 */
export const todayLine = (now = new Date()) => `Today's date, to mention only when it matters: ${formatDate(now)}.`

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
 * Dates a question names ("17 August 2027", "August 17", "2027-08-17", "tomorrow", "in 30 days")
 * with their weekday and distance from today, and the time when the question asks for it.
 */
export function dateFacts(question: string, now = new Date()): DateFacts {
  // Punctuation becomes spaces, except what dates are written with (17/8, 17.8, 17-8, August 17, 2027).
  const text = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}/.,:-]+/gu, ' ').replace(/\s+/g, ' ')} `
  const found: Date[] = []
  const add = (date: Date | null) => {
    if (date && !found.some((d) => d.getTime() === date.getTime())) found.push(date)
  }

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(makeDate(+m[1], +m[2] - 1, +m[3]))
  // Day first, as in most of the world: 17/8/2027, 17-08-2027, 17.8.2027.
  for (const m of text.matchAll(/\b(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})\b/g)) add(makeDate(fullYear(m[4]), +m[3] - 1, +m[1]))
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_PATTERN})\\b(?:,? (\\d{4}))?`, 'g'))) {
    const month = MONTH_WORDS[m[2]]
    add(m[3] ? makeDate(+m[3], month, +m[1]) : nextOccurrence(month, +m[1], now))
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?`, 'g'))) {
    const month = MONTH_WORDS[m[1]]
    add(m[3] ? makeDate(+m[3], month, +m[2]) : nextOccurrence(month, +m[2], now))
  }

  const relative: [RegExp, number][] = [
    [/\bday after tomorrow\b/, 2],
    [/\btomorrow\b/, 1],
    [/\byesterday\b/, -1],
  ]
  for (const [pattern, days] of relative) if (pattern.test(text)) add(addDays(now, days))
  const counted: [RegExp, number][] = [
    [/\b(\d+) ?days? ?(from now|from today|later)\b/g, 1],
    [/\bin (\d+) ?days?\b/g, 1],
    [/\b(\d+) ?days? ?ago\b/g, -1],
    [/\b(\d+) ?weeks? ?(from now|from today|later)\b/g, 7],
    [/\bin (\d+) ?weeks?\b/g, 7],
    [/\b(\d+) ?weeks? ?ago\b/g, -7],
  ]
  for (const [pattern, unit] of counted) for (const m of text.matchAll(pattern)) add(addDays(now, +m[1] * unit))

  const facts: string[] = []
  const labels: string[] = []
  for (const date of found.slice(0, 4)) {
    const days = daysBetween(now, date)
    const name = formatDate(date)
    const count = `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`
    facts.push(`${name} ${days === 0 ? 'is today' : days > 0 ? `is ${count} from today` : `was ${count} ago`}.`)
    labels.push(`${name}: ${days === 0 ? 'today' : days > 0 ? `in ${count}` : `${count} ago`}`)
  }
  if (/\b(what time|the time|time is it|time now)\b/.test(text)) {
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    facts.push(`The time now is ${time}.`)
    labels.push(`time: ${time}`)
  }
  return { facts, labels }
}
