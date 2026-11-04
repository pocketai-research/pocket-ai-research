import type { PlaceQuery } from '../map/places'
import { evaluate, expressionIn, formatNumber, plainNumbers, prettyExpression } from './calculator'
import { dateFacts } from './dates'
import { generateJson } from './engine'

/**
 * Tools the AI uses before it answers: a calculator, dates and nearby places from the map (notes
 * and documents are searched separately, in ChatView). The app picks the tools from the question
 * and works out the results exactly; the Smart model also writes the calculation for a word
 * problem (see ModelOption.plansCalculations).
 *
 * llama.cpp's own tool calling was tried first. The tool descriptions it adds to every prompt
 * made the first word of a reply take 25-35 s instead of 3-5 s with Qwen3 0.6B on a laptop (73-98 s
 * instead of 11-14 s with Qwen3 1.7B), Qwen3 did not call the date tool for "what day is it?",
 * and Gemma 3 does not call tools at all.
 */

export interface ToolResults {
  /** Facts for the AI, sent with the question (small models follow the last message best). */
  facts?: string
  /** What was used, shown under the reply, e.g. "calculator: 3 × 12500 × 0.9 = 33,750". */
  labels: string[]
}

export interface ToolOptions {
  /** Let the model write the calculation for a word problem (the Smart model). */
  planCalculations: boolean
  signal: AbortSignal
}

// A calculation is likely: a word that asks for one, and at least two numbers.
const MATH_WORDS =
  /\b(how much|how many|total|sum|price|discount|percent|cost|pay|change|average|each|per|interest|left|remaining|difference|profit|split)\b|%/
// "Nearest hospital", "ATM near me": a question about places around the user.
const NEAR_WORDS = /\b(nearest|closest|near me|nearby|near here|around here|close by)\b/

/** Runs the tools a question needs; any that fails is left out rather than stopping the reply. */
export async function runTools(question: string, options: ToolOptions): Promise<ToolResults> {
  const lower = question.toLowerCase()
  const facts: string[] = []
  const labels: string[] = []

  const dates = dateFacts(question)
  facts.push(...dates.facts)
  labels.push(...dates.labels.map((label) => `date: ${label}`))

  // Dates are numbers too (17-08-2027); a question about one is not a sum.
  if (!dates.facts.length) {
    const calculation = await calculate(question, options).catch(() => null)
    if (calculation) {
      facts.push(calculation.fact)
      labels.push(calculation.label)
    }
  }

  if (NEAR_WORDS.test(lower)) {
    // The map code (vector tiles) loads only when a question needs it.
    const places = await import('../map/places')
    const query = places.parseQuery(question)
    if (query.category) {
      const nearby = await findNearby(query).catch(() => null)
      if (nearby) {
        facts.push(nearby.fact)
        labels.push(nearby.label)
      }
    }
  }

  if (!facts.length) return { labels }
  return { facts: ["Results from the app's tools (exact, use them as they are):", ...facts].join('\n'), labels }
}

async function calculate(question: string, { planCalculations, signal }: ToolOptions) {
  // A question that is only a sum ("17 x 23 x 4") needs no model at all.
  let expression = expressionIn(question)
  if (!expression) {
    const numbers = plainNumbers(question).match(/\d+(\.\d+)?/g) ?? []
    if (!planCalculations || numbers.length < 2 || !MATH_WORDS.test(question.toLowerCase())) return null
    // A word problem: the model writes the calculation, held to JSON by a grammar, and the app works it out.
    // (A "needed" flag was tried: the models set it to false every time, then wrote the calculation anyway.)
    const plan = await generateJson<{ expression: string }>(
      'You turn a question into one arithmetic expression for a calculator. You never answer the question yourself.',
      [
        `Question: ${plainNumbers(question)}`,
        '',
        'Write one arithmetic expression whose value is the answer. Use every number the question needs, and only numbers, + - * / ( ).',
        'Example: 4 items at 2500 each with 20% off is 4 * 2500 * 0.8. Example: 30% of 900 spent, what is left, is 900 * 0.7.',
        'Write numbers without thousand separators (12500, not 12,500).',
      ].join('\n'),
      { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      signal,
      96,
    )
    if (!plan.expression.trim()) return null
    expression = plan.expression.replace(/[x×]/g, '*').replace(/÷/g, '/')
  }
  const value = evaluate(expression)
  const shown = `${prettyExpression(expression)} = ${formatNumber(value)}`
  return { fact: `Calculator: ${shown}. Use this number; do not work it out again.`, label: `calculator: ${shown}` }
}

function currentPosition(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no GPS'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      reject,
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    )
  })
}

async function findNearby(query: PlaceQuery) {
  const [{ describeQuery, placesContext, searchPlaces }, { listAreas }, { containsPoint }] = await Promise.all([
    import('../map/places'),
    import('../map/offlineStore'),
    import('../map/geo'),
  ])
  const what = describeQuery(query)
  let point: [number, number]
  try {
    point = await currentPosition()
  } catch {
    return {
      fact: `The user's location is not available (location is off or not allowed), so nearby ${what} cannot be found. Say so, and suggest allowing location or using the map. Do not name any place.`,
      label: 'map: location not available',
    }
  }
  const area = (await listAreas()).find((a) => containsPoint(a.bbox, point)) ?? null
  if (!area && !navigator.onLine) {
    return {
      fact: `There is no internet and no offline map area covers the user's location, so nearby ${what} cannot be found. Say so, and suggest downloading the area in the map. Do not name any place.`,
      label: 'map: no offline area here',
    }
  }
  const { places, radius } = await searchPlaces(query, point, area)
  return {
    // The same words as the map's own search, so a reply that repeats them reads naturally.
    fact: placesContext(query, places, 'your location'),
    label: places.length
      ? `map: ${places.length} ${what} within ${radius / 1000} km${area ? ` (offline area ${area.name})` : ''}`
      : `map: no ${what} within ${radius / 1000} km`,
  }
}
