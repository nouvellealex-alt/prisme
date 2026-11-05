import type { Transaction } from '../engine'
import { BPS, formatQuote, INPUT_DECIMALS, INPUT_TO_QUOTE, parseDecimal } from '../engine/decimal'

const CASH = new Set(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'NZD'])
const LABELS = 'div, span, p, dt, th, label, small, strong'
const DIALOGS = 'dialog, [role="dialog"], [role="alertdialog"]'
const BUTTONS = 'button, [role="button"]'
const NUMBER = '[0-9][0-9., ]{0,31}'
const CURRENCY = '(?:US\\$|CA\\$|AU\\$|A\\$|NZ\\$|[$€£¥]|[A-Z0-9]{2,12})'
const MONEY = new RegExp(`^(?:(${CURRENCY}) *(${NUMBER})|(${NUMBER}) *(${CURRENCY}))$`, 'u')
const SYMBOLS: Record<string, string> = {
  'US$': 'USD', 'CA$': 'CAD', 'AU$': 'AUD', 'A$': 'AUD', 'NZ$': 'NZD', '€': 'EUR', '£': 'GBP',
}

type Platform = Transaction['platform']
type Quote = Omit<Transaction, 'observedAt'>

export type DetectedQuote = { quote: Quote; surface: Element }

function clean(value: string) {
  return value.replace(/[\s\u200e\u200f\u2066-\u2069]+/gu, ' ').trim()
}

function labelKey(value: string) {
  return clean(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/:$/, '').trim()
}

function ownText(element: Element) {
  return clean([...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' '))
}

function visibility() {
  const cache = new Map<Element, boolean>()
  function isVisible(element: Element): boolean {
    const cached = cache.get(element)
    if (cached !== undefined) return cached
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const visible = !element.matches('[hidden], [inert], [aria-hidden="true"], script, style, template, svg') &&
      style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse' &&
      style?.opacity !== '0' && (!element.parentElement || isVisible(element.parentElement))
    cache.set(element, visible)
    return visible
  }
  return isVisible
}

type IsVisible = ReturnType<typeof visibility>

function visibleAction(button: Element, isVisible: IsVisible) {
  if (button.matches('[disabled], [aria-disabled="true"]') || !isVisible(button)) return false
  const document = button.ownerDocument
  const { clientWidth, clientHeight } = document.documentElement
  // DOM-only test environments do not have a layout viewport.
  if (!clientWidth || !clientHeight) return true
  const rect = button.getBoundingClientRect()
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(clientWidth, rect.right)
  const bottom = Math.min(clientHeight, rect.bottom)
  if (right <= left || bottom <= top) return false
  return button.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2))
}

function textOf(element: Element, isVisible: IsVisible, readNumericInput = false) {
  const walker = element.ownerDocument.createTreeWalker(element, readNumericInput ? 5 : 4)
  const parts: string[] = []
  let size = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const field = node.nodeType === 1 ? node as HTMLInputElement : null
    const parent = node.parentElement
    if (!parent || !isVisible(parent)) continue
    // Input values are considered only inside an already identified numeric order row.
    const raw = field?.matches('input:not([type]), input[type="text"], input[type="number"]') && isVisible(field)
      ? field.value : node.nodeType === 3 ? node.textContent : ''
    const text = clean(raw ?? '')
    if (!text) continue
    size += text.length + 1
    if (size > 220) return ''
    parts.push(text)
  }
  return parts.join(' ')
}

function labeled(surface: Element, names: RegExp, isVisible: IsVisible) {
  return [...surface.querySelectorAll(LABELS)].filter(element => names.test(labelKey(ownText(element))) && isVisible(element))
}

function row<T>(
  surface: Element, names: RegExp, parse: (value: string) => T | null, isVisible: IsVisible,
  readNumericInput = false,
): T | null {
  const labels = labeled(surface, names, isVisible)
  if (labels.length !== 1) return null
  const [label] = labels
  const prefix = ownText(label)
  const sibling = label.nextElementSibling
  if (sibling?.matches('dd') && isVisible(sibling)) {
    return parse(textOf(sibling, isVisible, readNumericInput))
  }
  // Most previews place the label and value in separate cells within a row.
  for (const wrapper of [label, label.parentElement, label.parentElement?.parentElement]) {
    if (!wrapper || wrapper === surface) break
    const value = textOf(wrapper, isVisible, readNumericInput)
    if (value.startsWith(prefix + ' ')) {
      const result = parse(value.slice(prefix.length + 1))
      if (result !== null) return result
    }
  }
  return null
}

function decimal(value: string, lang: string) {
  const french = lang === 'fr'
  const point = french ? ',' : '.'
  const [integer, fraction, extra] = value.trim().split(point)
  const grouped = french ? /^\d{1,3}(?: \d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/
  if (extra !== undefined || (!/^\d+$/.test(integer) && !grouped.test(integer))) return null
  if (fraction !== undefined && !/^\d{1,18}$/.test(fraction)) return null
  const whole = integer.replace(/[ ,]/gu, '').replace(/^0+(?=\d)/u, '')
  const tail = fraction?.replace(/0+$/u, '') ?? ''
  return { amount: tail ? `${whole}.${tail}` : whole, fractionDigits: fraction?.length ?? 0 }
}

function monetary(value: string, lang: string, expected?: string) {
  const match = MONEY.exec(value)
  if (!match) return null
  const [, prefix, first, second, suffix] = match
  const currency = prefix ?? suffix
  const num = decimal(first ?? second, lang)
  if (!num || parseDecimal(num.amount) === undefined) return null
  const code = SYMBOLS[currency] ?? currency
  if (code === '$' && expected && ['USD', 'CAD', 'AUD', 'NZD'].includes(expected)) return { ...num, code: expected }
  if (code === '¥' && expected === 'JPY') return { ...num, code: expected }
  if (!/^[A-Z][A-Z0-9]{1,11}$/u.test(code) || (expected && code !== expected)) return null
  return { ...num, code }
}

type Money = NonNullable<ReturnType<typeof monetary>>

function displayUnit(value: Money) {
  return 10n ** BigInt(INPUT_DECIMALS - value.fractionDigits)
}

function consistentSubtotal(quantity: Money, price: Money, gross: bigint, rounding: bigint, roundedQuantity = true) {
  if (gross <= 0n || price.amount === '0') return false
  const units = parseDecimal(quantity.amount)!
  const rate = parseDecimal(price.amount)!
  const product = units * rate * BPS
  const delta = product >= gross ? product - gross : gross - product
  // Bound the effect of rounding on the amounts the UI displays, including a cross term.
  const priceStep = displayUnit(price)
  const quantityStep = roundedQuantity ? displayUnit(quantity) : 0n
  const roundingBound = rounding + (priceStep * units + quantityStep * rate + priceStep * quantityStep / 2n) * BPS
  return roundingBound * 50n <= gross && delta * 2n <= roundingBound
}

function balance(value: string) {
  const match = /^(?:Solde (?:en )?([A-Z]{3})|([A-Z]{3}) (?:cash )?balance)$/iu.exec(value)
  const code = (match?.[1] ?? match?.[2])?.toUpperCase()
  return code && CASH.has(code) ? code : null
}

const EXCLUDED = /^(?:convert(?:ir|ion)?|custom price|prix personnalise|limit(?: order| price)?|prix limite|target(?: price| order)?|prix cible|recurring(?: order| buy)?|(?:achat|ordre) recurrent|(?:order|ordre) twap|futures?|perpetual|contrat perpetuel)$/u
const SELL_AMOUNT = /^(?:sell amount|amount to sell|quantite a vendre|montant vendu|montant a vendre)$/u
const AMOUNT = /^(?:amount|buy amount|receive amount|montant|quantite|quantite a acheter)$/u
const ALL_IN_BUY = /^(?:total (?:including fees|incl\.? fees|to pay)|total (?:a payer|frais inclus))$/u
const ALL_IN_SELL = /^(?:net total|total (?:after fees|to receive)|total (?:net|a recevoir|apres frais))$/u
const FEE = /^(?:fee|fees|estimated fee|est\.? fee|trading fee|frais|frais estimes|frais de transaction)$/u

function splitInclusive(value: string) {
  const match = /^(.+?) (?:incl(?:udes?|uding)?\.? (.+?) fees?|(?:dont|frais inclus\s*:) (.+?)(?: de frais)?)$/iu.exec(value)
  if (!match) return null
  return { total: match[1], fee: match[2] ?? match[3] }
}

function parseConsumer(surface: Element, lang: string, isVisible: IsVisible): Quote | null {
  if (labeled(surface, EXCLUDED, isVisible).length) return null
  const sell = labeled(surface, SELL_AMOUNT, isVisible).length > 0
  const buyCurrency = row(surface, /^(?:pay with|payer avec|mode de paiement)$/u, balance, isVisible)
  if (!sell && !buyCurrency) return null
  const amount = row(surface, sell ? SELL_AMOUNT : AMOUNT, value => monetary(value, lang), isVisible)
  const full = row(surface, /^total$/u, splitInclusive, isVisible)
  if (!amount || !full || CASH.has(amount.code) || amount.amount === '0') return null

  // Bare "$" and "¥" are accepted only when the same review identifies the ISO currency.
  const receivingCurrency = sell
    ? row(surface, /^(?:receive in|deposit to|recevoir sur|crediter sur)$/u, balance, isVisible)
    : null
  const expected = buyCurrency ?? receivingCurrency ?? undefined
  const total = monetary(full.total, lang, expected)
  if (!total || !CASH.has(total.code) || total.amount === '0') return null
  const fee = monetary(full.fee, lang, total.code)
  const price = row(surface, /^(?:price|prix)$/u, value => monetary(value, lang, total.code), isVisible)
  if (!fee || !price || price.amount === '0') return null
  const gross = parseDecimal(total.amount)! + (sell ? 1n : -1n) * parseDecimal(fee.amount)!
  const rounding = (displayUnit(total) + displayUnit(fee)) * INPUT_TO_QUOTE
  if (!consistentSubtotal(amount, price, gross * INPUT_TO_QUOTE, rounding)) return null
  return {
    platform: 'kraken', side: sell ? 'sell' : 'buy', base: amount.code,
    quote: total.code, quantity: amount.amount, total: total.amount, fee: fee.amount,
  }
}

const PRO_ACTION = /^(buy|sell|acheter|vendre) ([A-Z][A-Z0-9]{1,11})\s*\/\s*([A-Z][A-Z0-9]{1,11})$/iu
const MARKET = /^(?:market(?: order)?|marche|(?:ordre )?au marche)$/u
const SPOT = /^(?:spot|au comptant|comptant)$/u

function selected(surface: Element, names: RegExp, isVisible: IsVisible) {
  return [...surface.querySelectorAll('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], [data-state="active"], [data-selected="true"], button[aria-haspopup]:not([aria-haspopup="false"]), [role="combobox"]')]
    .some(element => isVisible(element) && names.test(labelKey(textOf(element, isVisible))))
}

function parsePro(surface: Element, action: RegExpExecArray, lang: string, isVisible: IsVisible): Quote | null {
  if (labeled(surface, EXCLUDED, isVisible).length) return null
  const market = selected(surface, MARKET, isVisible) ||
    row(surface, /^(?:order type|type d['’]ordre)$/u, value => MARKET.test(labelKey(value)) ? true : null, isVisible)
  const spot = selected(surface, SPOT, isVisible) ||
    row(surface, /^(?:trading type|market type|type de marche)$/u, value => SPOT.test(labelKey(value)) ? true : null, isVisible)
  const excluded = selected(surface, /^(?:margin(?: \d+x)?|marge(?: \d+x)?|futures?|perpetual)$/u, isVisible)
  if (!market || !spot || excluded) return null
  const conditional = /^(?:conditional (?:buy |sell )?order|ordre conditionnel)$/u
  if (labeled(surface, conditional, isVisible).length &&
      !row(surface, conditional, value => /^(?:oto )?(?:no|none|non|aucun)$/u.test(labelKey(value)) ? true : null, isVisible)) return null
  const [, verb, rawBase, rawQuote] = action
  const base = rawBase.toUpperCase()
  const quote = rawQuote.toUpperCase()
  const side = /^(?:buy|acheter)$/iu.test(verb) ? 'buy' : 'sell'
  const amount = row(surface, /^(?:quantity|amount|quantite|montant)$/u, value => monetary(value, lang, base), isVisible, true)
  const total = row(surface, side === 'buy' ? ALL_IN_BUY : ALL_IN_SELL, value => monetary(value, lang, quote), isVisible)
  const fee = row(surface, FEE, value => monetary(value, lang, quote), isVisible)
  if (!amount || !fee || amount.amount === '0') return null
  const feeValue = parseDecimal(fee.amount)!
  let allIn: bigint
  if (total) {
    allIn = parseDecimal(total.amount)!
  } else {
    const gross = row(surface, /^total$/u, value => monetary(value.replace(/^[≈~] */u, ''), lang, quote), isVisible, true)
    const price = row(surface, /^(?:market price|prix du marche)$/u, value => monetary(value.replace(/^[≈~] */u, ''), lang, quote), isVisible, true)
    if (!gross || !price) return null
    const subtotal = parseDecimal(gross.amount)!
    if (!consistentSubtotal(amount, price, subtotal * INPUT_TO_QUOTE, displayUnit(gross) * INPUT_TO_QUOTE, false)) return null
    allIn = subtotal + (side === 'buy' ? feeValue : -feeValue)
  }
  if (allIn <= 0n || (side === 'buy' && allIn <= feeValue)) return null
  return {
    platform: 'kraken-pro', side, base, quote, quantity: amount.amount,
    total: formatQuote(allIn * INPUT_TO_QUOTE), fee: fee.amount,
  }
}

export function detectQuote(document: Document, platform: Platform): DetectedQuote | null {
  const lang = document.documentElement.lang.toLowerCase().split('-')[0] || 'en'
  if (lang !== 'fr' && lang !== 'en') return null
  const isVisible = visibility()
  let candidate: DetectedQuote | null = null
  for (const button of document.querySelectorAll(BUTTONS)) {
    const actionText = clean(button.textContent ?? '')
    const action = platform === 'kraken-pro' ? PRO_ACTION.exec(actionText) : null
    if (platform === 'kraken' ? !/^(?:Confirm|Confirmer)$/u.test(actionText) : !action) continue
    if (!visibleAction(button, isVisible)) continue
    const dialog = button.closest(DIALOGS)
    let current = button.parentElement
    // Bounded fallback for custom widgets without a semantic dialog container.
    for (let depth = 0; current && depth < 8 && !current.matches('main, body, html, [role="main"]'); depth += 1) {
      if (current.querySelectorAll(LABELS).length > 140) break
      const quote = action ? parsePro(current, action, lang, isVisible) : parseConsumer(current, lang, isVisible)
      if (quote) {
        const surface = dialog ?? current
        if (candidate) return null
        candidate = { quote, surface }
        break
      }
      if (current === dialog) break
      current = current.parentElement
    }
  }
  return candidate
}
