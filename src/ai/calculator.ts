/**
 * Exact arithmetic for the AI, which small models get wrong (Gemma 3 1B answered 17 x 23 x 4 =
 * 1868). Numbers, + - * / ^, parentheses, sqrt() and percentages; nothing else is accepted.
 */

type Token = { type: 'number'; value: number } | { type: 'op'; value: string }

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|(sqrt|[-+*/^%()]))/y
  let at = 0
  while (at < expression.length) {
    if (!expression.slice(at).trim()) break
    pattern.lastIndex = at
    const m = pattern.exec(expression)
    if (!m) throw new Error(`Cannot read "${expression.slice(at).trim()}"`)
    tokens.push(m[1] !== undefined ? { type: 'number', value: Number(m[1]) } : { type: 'op', value: m[2] })
    at = pattern.lastIndex
  }
  return tokens
}

/**
 * Evaluates an arithmetic expression. A percentage is a hundredth (15% * 200 = 30), except after
 * + or -, where it is a share of what comes before, as on a calculator (200 - 15% = 170).
 */
export function evaluate(expression: string): number {
  const tokens = tokenize(expression)
  let i = 0
  const peek = () => tokens[i]
  const isOp = (value: string) => peek()?.type === 'op' && peek()!.value === value
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected "${value}"`)
    i++
  }

  // Returns the value, and whether it was written as a percentage (for "200 - 15%").
  function sum(): number {
    let value = product().value
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].value
      const right = product()
      const amount = right.percent ? value * right.value : right.value
      value = op === '+' ? value + amount : value - amount
    }
    return value
  }
  function product(): { value: number; percent: boolean } {
    let left = power()
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++].value
      const right = power().value
      left = { value: op === '*' ? left.value * right : left.value / right, percent: false }
    }
    return left
  }
  function power(): { value: number; percent: boolean } {
    const base = unary()
    if (isOp('^')) {
      i++
      return { value: base.value ** power().value, percent: false }
    }
    return base
  }
  function unary(): { value: number; percent: boolean } {
    if (isOp('-')) {
      i++
      const inner = unary()
      return { value: -inner.value, percent: inner.percent }
    }
    if (isOp('+')) {
      i++
      return unary()
    }
    let result = { value: primary(), percent: false }
    while (isOp('%')) {
      i++
      result = { value: result.value / 100, percent: true }
    }
    return result
  }
  function primary(): number {
    const token = peek()
    if (!token) throw new Error('The expression ends too early')
    if (token.type === 'number') {
      i++
      return token.value
    }
    if (token.value === '(') {
      i++
      const value = sum()
      expect(')')
      return value
    }
    if (token.value === 'sqrt') {
      i++
      expect('(')
      const value = sum()
      expect(')')
      return Math.sqrt(value)
    }
    throw new Error(`Unexpected "${token.value}"`)
  }

  const value = sum()
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i].value}"`)
  if (!Number.isFinite(value)) throw new Error('The result is not a number (division by zero?)')
  return value
}

/**
 * Numbers as written in Indonesian or English to plain digits: 12.500 and 12,500 become 12500;
 * 1,5 and 1.5 become 1.5. A separator followed by exactly three digits groups thousands.
 */
export function plainNumbers(text: string) {
  return text
    .replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?(?![\d.])/g, (n) => n.replace(/\./g, '').replace(',', '.'))
    .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/g, (n) => n.replace(/,/g, ''))
    .replace(/(\d),(\d)/g, '$1.$2')
}

const WORD_OPERATORS: [RegExp, string][] = [
  [/\b(akar kuadrat dari|akar kuadrat|akar dari|akar|square root of|square root|sqrt)\s*\(?\s*([\d.]+)\s*\)?/g, 'sqrt($2)'],
  [/\b(dikalikan dengan|dikalikan|dikali|kali|times|multiplied by)\b|[x×]/g, '*'],
  [/\b(dibagi dengan|dibagi|bagi|divided by)\b|[÷:]/g, '/'],
  [/\b(ditambah dengan|ditambah|tambah|plus)\b/g, '+'],
  [/\b(dikurangi dengan|dikurangi|kurang|minus)\b/g, '-'],
  [/\b(pangkat|to the power of)\b/g, '^'],
  [/\b(kuadrat|squared)\b/g, '^2'],
  [/\b(persen|percent)\b/g, '%'],
  [/%\s*(dari|of)\b/g, '% *'],
]

const FILLER =
  /\b(berapakah|berapa|hasilnya|hasil|hitunglah|hitung|tolong|coba|adalah|sama dengan|what is|what's|whats|how much is|calculate|compute|equals|is)\b|[?=!]/g

/**
 * The arithmetic in a question that is only a sum, such as "Berapa 17 x 23 x 4?" or "15% dari
 * 200.000", ready to evaluate; null when the question is about more than that.
 */
export function expressionIn(question: string): string | null {
  let text = plainNumbers(question.toLowerCase())
  for (const [pattern, operator] of WORD_OPERATORS) text = text.replace(pattern, ` ${operator} `)
  text = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().replace(/[.,]$/, '').trim()
  // Only numbers and operators left, with at least one operator between two numbers.
  if (!/^[\d\s.+\-*/^%()sqrt]+$/.test(text) || !/\d\s*[-+*/^%]\s*[\d(s]|sqrt|\d\s*%/.test(text)) return null
  try {
    evaluate(text)
    return text
  } catch {
    return null
  }
}

/** A result for people and the AI: 33750 as 33,750 (English) or 33.750 (Indonesian). */
export const formatNumber = (value: number, indonesian: boolean) =>
  new Intl.NumberFormat(indonesian ? 'id-ID' : 'en-US', { maximumFractionDigits: 6 }).format(value)

/** The expression as people write it: 3*12500*0.9 as 3 × 12500 × 0.9. */
export const prettyExpression = (expression: string) =>
  expression
    .replace(/\s+/g, '')
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/(?<=[\d)%])([+-])/g, ' $1 ')
