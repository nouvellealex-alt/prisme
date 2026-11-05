import { MARKET_SELECTIONS, type MarketSelection, type Comparison, type Transaction } from '../engine'
import type { Theme } from '../shared'

const ACTIONS = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
const EDGE = 14

const style = `
  :host {
    all: initial; display: block; position: fixed; z-index: 2147483600;
    pointer-events: none; font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #1d1d1f; --surface: #fff; --border: #dbdbe0; --secondary: #59595f; --tint: #24813b;
    --shadow: 0 4px 24px #0d10201a;
  }
  :host([data-theme="dark"]) {
    color: #f5f5f7; --surface: #1c1c1e; --border: #45454b; --secondary: #b6b6bb; --tint: #8cda9d;
    --shadow: 0 4px 24px #0005;
  }
  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) {
      color: #f5f5f7; --surface: #1c1c1e; --border: #45454b; --secondary: #b6b6bb; --tint: #8cda9d;
      --shadow: 0 4px 24px #0005;
    }
  }
  .card {
    display: flex; align-items: center; gap: 9px; padding: 5px 5px 5px 12px; box-sizing: border-box;
    max-width: min(290px, calc(100vw - 28px)); border: 1px solid var(--border); border-radius: 15px;
    background: var(--surface); box-shadow: var(--shadow); white-space: normal;
    animation: enter 180ms ease-out;
  }
  .label { display: grid; gap: 1px; overflow-wrap: anywhere; }
  .title { font-weight: 650; }
  .caption { font-size: 11px; color: var(--secondary); }
  :host([data-verdict="better"]) .title, :host([data-verdict="better"]) .mark { color: #b42437; }
  :host([data-verdict="good"]) .title { color: var(--tint); }
  :host([data-verdict="unavailable"]) .mark { color: var(--secondary); }
  :host([data-theme="dark"][data-verdict="better"]) .title, :host([data-theme="dark"][data-verdict="better"]) .mark { color: #ff9bab; }
  @media (prefers-color-scheme: dark) { :host([data-theme="auto"][data-verdict="better"]) .title, :host([data-theme="auto"][data-verdict="better"]) .mark { color: #ff9bab; } }
  select { pointer-events: auto; color: inherit; background: var(--surface); font: inherit; max-width: 100%; }
  .mark { color: var(--tint); font-size: 16px; }
  button {
    flex: none; pointer-events: auto; display: grid; place-items: center; inline-size: 44px;
    block-size: 44px; padding: 0; border: 0; border-radius: 10px; font: 20px/1 system-ui;
    background: transparent; color: var(--secondary); cursor: pointer;
  }
  button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  button:focus-visible { outline: 2px solid #007aff; outline-offset: -2px; }
  @keyframes enter { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
`

function amount(value: string, currency: string) {
  const digits = Math.max(2, Math.min(8, value.split('.')[1]?.length ?? 0))
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: /^[A-Z]{3}$/u.test(currency) ? currency : 'XXX',
    maximumFractionDigits: digits,
  }).format(Number(value)).replace('¤', currency)
}

function overlaps(x: number, y: number, width: number, height: number, rect: DOMRect) {
  return rect.width > 0 && rect.height > 0 &&
    x < rect.right + 5 && x + width > rect.left - 5 &&
    y < rect.bottom + 5 && y + height > rect.top - 5
}

export function createBadge(
  comparison: Comparison, transaction: Transaction, theme: Theme, dismiss: () => void,
  selected: MarketSelection, onSelect: (reference: MarketSelection) => void,
) {
  const host = document.createElement('prisme-price-badge')
  host.dataset.theme = theme
  host.dataset.verdict = comparison.status
  host.style.visibility = 'hidden'
  const shadow = host.attachShadow({ mode: 'closed' })
  const css = document.createElement('style')
  css.textContent = style
  const card = document.createElement('div')
  card.className = 'card'
  const mark = document.createElement('span')
  mark.className = 'mark'
  mark.setAttribute('aria-hidden', 'true')
  mark.textContent = comparison.status === 'good' ? '✓' : comparison.status === 'better' ? '!' : '–'
  const label = document.createElement('span')
  label.className = 'label'
  label.setAttribute('role', 'status')
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = comparison.status === 'unavailable' ? 'Comparaison indisponible' : comparison.status === 'good' ? 'Devis compétitif' :
    transaction.side === 'buy' ? `Économie estimée · ${amount(comparison.savings, transaction.quote)}` :
      `Gain estimé · ${amount(comparison.savings, transaction.quote)}`
  const caption = document.createElement('span')
  caption.className = 'caption'
  caption.textContent = comparison.status === 'unavailable' ? 'Vérifiez la paire et les frais dans Prisme.' :
    `Devis ${amount(transaction.total, transaction.quote)} · ${comparison.marketCount ? `Moy. (${comparison.marketCount})` : 'Réf.'} ${amount(comparison.referenceTotal, transaction.quote)}`
  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Marché de référence Prisme')
  for (const name of MARKET_SELECTIONS) select.add(new Option(name, name))
  select.value = selected
  select.addEventListener('change', () => {
    const next = MARKET_SELECTIONS.find(name => name === select.value)
    if (next) onSelect(next)
  })
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Fermer la notification Prisme')
  close.addEventListener('click', dismiss)
  label.append(title, caption, select)
  card.append(mark, label, close)
  shadow.append(css, card)
  document.body.append(host)

  return {
    remove: () => host.remove(),
    position(surface: Element) {
      // Do not cover review surfaces, controls or links. Hide when the viewport has no room.
      const width = card.offsetWidth
      const height = card.offsetHeight
      const viewport = document.documentElement
      const right = viewport.clientWidth - EDGE - width
      const bottom = viewport.clientHeight - EDGE - height
      const occupied = [
        surface.getBoundingClientRect(),
        ...Array.from(document.querySelectorAll(ACTIONS), element => element.getBoundingClientRect()),
      ]
      const safe = [[EDGE, EDGE], [right, EDGE], [EDGE, bottom], [right, bottom]].find(
        ([x, y]) => x >= EDGE && y >= EDGE && x <= right && y <= bottom &&
          !occupied.some(rect => overlaps(x, y, width, height, rect)),
      )
      host.style.visibility = safe ? 'visible' : 'hidden'
      if (safe) {
        host.style.left = `${safe[0]}px`
        host.style.top = `${safe[1]}px`
      }
    },
  }
}
