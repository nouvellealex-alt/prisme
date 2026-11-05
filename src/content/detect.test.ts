// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { detectQuote } from './detect'

const buy = `
  <div role="dialog">
    <div><span>Amount</span><span>0.01200000 BTC</span></div>
    <div><span>Price</span><span>$100,000.00</span></div>
    <div><span>Total</span><div><span>$1,212.50</span><small>Incl. $12.50 fee</small></div></div>
    <div><span>Pay with</span><span>USD balance</span></div>
    <button>Confirm</button>
  </div>
`

const sell = `
  <div role="dialog">
    <dl>
      <dt>Quantité à vendre</dt><dd>0,01200000 BTC</dd>
      <dt>Prix</dt><dd>100 000,00 €</dd>
      <dt>Total</dt><dd>1 187,50 € <small>dont 12,50 € de frais</small></dd>
    </dl>
    <button>Confirmer</button>
  </div>
`

const pro = `
  <div role="region" aria-label="Order form">
    <button aria-pressed="true">Spot</button><button aria-pressed="false">Margin</button>
    <button aria-haspopup="listbox">Market</button>
    <div><span>Market price</span><span>≈ 100,000.00 USD</span></div>
    <div><label>Quantity</label><input type="text" value="0.012"><span>BTC</span></div>
    <div><span>Total</span><span>≈ 1,200.00 USD</span></div>
    <div><span>Estimated fee</span><span>4.80 USD</span></div>
    <div><span>Conditional sell order</span><span>OTO</span><span>No</span></div>
    <button>Buy BTC/USD</button>
  </div>
`

function page(html: string, lang = 'en') {
  document.documentElement.lang = lang
  document.body.innerHTML = `<main>${html}</main>`
  return document
}

afterEach(() => document.body.replaceChildren())

describe('explicit Kraken confirmation', () => {
  it('reads an all-in cash-balance buy with an unambiguous dollar currency', () => {
    const detected = detectQuote(page(buy), 'kraken')
    expect(detected?.surface.getAttribute('role')).toBe('dialog')
    expect(detected?.quote).toEqual({
      platform: 'kraken', side: 'buy', base: 'BTC', quote: 'USD', quantity: '0.012',
      total: '1212.5', fee: '12.5',
    })
  })

  it('reads localized amounts and a net sale', () => {
    expect(detectQuote(page(sell, 'fr'), 'kraken')?.quote).toEqual({
      platform: 'kraken', side: 'sell', base: 'BTC', quote: 'EUR', quantity: '0.012',
      total: '1187.5', fee: '12.5',
    })
  })

  it('finds a bounded custom dialog wrapper', () => {
    expect(detectQuote(page(buy.replace(' role="dialog"', '')), 'kraken')?.quote.total).toBe('1212.5')
  })

  it.each([
    ['unconfirmed form', buy.replace('Confirm', 'Buy BTC')],
    ['target price', buy.replace('>Price<', '>Custom price<')],
    ['card purchase', buy.replace('USD balance', 'Visa ending 0000')],
    ['hidden review', buy.replace('role="dialog"', 'role="dialog" hidden')],
    ['disabled confirmation', buy.replace('<button>', '<button disabled>')],
    ['unknown fee', buy.replace('Incl. $12.50 fee', '')],
    ['inconsistent quantity', buy.replace('0.01200000 BTC', '0.00400000 BTC')],
    ['two reviews', buy + buy],
  ])('returns no quote for %s', (_, html) => {
    expect(detectQuote(page(html), 'kraken')).toBeNull()
  })

  it('does not assume that a bare dollar symbol in a sale is USD', () => {
    expect(detectQuote(page(buy.replace('>Amount<', '>Sell amount<')
      .replace('<div><span>Pay with</span><span>USD balance</span></div>', '')), 'kraken')).toBeNull()
  })
})

describe('Kraken Pro immediate spot market order', () => {
  it('reconstructs an all-in total when the displayed gross, price and base quantity agree', () => {
    expect(detectQuote(page(pro), 'kraken-pro')?.quote).toEqual({
      platform: 'kraken-pro', side: 'buy', base: 'BTC', quote: 'USD', quantity: '0.012',
      total: '1204.8', fee: '4.8',
    })
  })

  it('uses the explicitly net sale total without subtracting the fee again', () => {
    const sale = pro.replace('Buy BTC/USD', 'Sell BTC/USD')
      .replace('>Total<', '>Net total<')
      .replace('≈ 1,200.00 USD', '1,195.20 USD')
    expect(detectQuote(page(sale), 'kraken-pro')?.quote).toMatchObject({ side: 'sell', total: '1195.2' })
  })

  it.each([
    ['limit', pro.replace('>Market<', '>Limit<')],
    ['margin', pro.replace('>Spot<', '>Margin<')],
    ['approximate quantity', pro.replace('value="0.012"', 'value="≈ 0.012"')],
    ['third currency fee', pro.replace('4.80 USD', '4.80 EUR')],
    ['conditional order', pro.replace('>No<', '>Yes<')],
    ['ambiguous gross total', pro.replace('≈ 1,200.00 USD', '≈ 1,250.00 USD')],
  ])('returns no quote for %s', (_, html) => {
    expect(detectQuote(page(html), 'kraken-pro')).toBeNull()
  })
})
