import { QUOTE_DECIMALS, BPS, formatQuote, INPUT_TO_QUOTE, parseDecimal, percent } from './decimal';
import {
  BOOK_MAX_AGE_MS,
  CLOCK_SKEW_MS,
  fillMarket,
  loadMarket,
  MarketFailure,
  normalizeAsset,
  type MarketError,
  REFERENCES,
  type Reference,
} from './market';

export { normalizeAsset, REFERENCES, type Reference } from './market';

export const TRANSACTION_MAX_AGE_MS = 20_000;
export const COMPARISON_THRESHOLD_BPS = 25;
export const MAX_FEE_BPS = 1000;

export type Transaction = {
  platform: 'kraken' | 'kraken-pro' | 'binance' | 'coinbase' | 'other';
  side: 'buy' | 'sell';
  base: string;
  quote: string;
  /** Exact amount of the base asset received or sold. */
  quantity: string;
  /** Full amount paid or received, with fees included, denominated in quote. */
  total: string;
  /** Optional known fee component of total, denominated in quote. */
  fee?: string;
  observedAt: number;
};

export type ComparisonSettings = {
  krakenTakerBps?: number;
  binanceTakerBps?: number;
  coinbaseTakerBps?: number;
  reference?: Reference;
};

export type UnavailableReason = MarketError | 'invalid-transaction' | 'stale-transaction' | 'fee-not-configured';

export const AVERAGE = 'Moyenne des marchés';
export const MARKET_SELECTIONS = [AVERAGE, ...REFERENCES] as const;
export type MarketSelection = typeof MARKET_SELECTIONS[number];

export type Comparison = {
  status: 'unavailable';
  reason: UnavailableReason;
  checkedAt: number;
} | {
  status: 'good' | 'better';
  checkedAt: number;
  validUntil: number;
  reference: MarketSelection;
  marketCount?: number;
  referenceGross: string;
  referenceFee: string;
  referenceTotal: string;
  feeBps: number;
  feeEstimated: boolean;
  savings: string;
  /** Signed percentage improvement over the current all-in total. */
  gapPct: number;
  spreadPct: number;
  slippagePct: number;
};

const ASSET_CODE = /^[A-Z0-9]{2,12}$/;
const STABLE_QUOTES = new Set(['USDT', 'USDC']);
const FIAT = new Set(['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD']);

export function isFeeBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_FEE_BPS;
}

function parseTransaction(transaction: Transaction) {
  if (typeof transaction !== 'object' || transaction === null) return;
  const { platform, side, base, quote, fee, observedAt } = transaction;
  if (!['kraken', 'kraken-pro', 'binance', 'coinbase', 'other'].includes(platform)) return;
  if (side !== 'buy' && side !== 'sell') return;
  if (typeof base !== 'string' || typeof quote !== 'string' || !ASSET_CODE.test(base) || !ASSET_CODE.test(quote)) return;
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) return;

  const normalizedBase = normalizeAsset(base);
  const normalizedQuote = normalizeAsset(quote);
  if (normalizedBase === normalizedQuote) return;

  const quantity = parseDecimal(transaction.quantity);
  const total = parseDecimal(transaction.total);
  if (!quantity || !total) return;
  if (fee !== undefined) {
    const value = parseDecimal(fee);
    if (value === undefined || (side === 'buy' && value >= total)) return;
  }

  return { platform, side, base: normalizedBase, quote: normalizedQuote, observedAt, quantity, total: total * INPUT_TO_QUOTE };
}

export function isTransaction(value: unknown): value is Transaction {
  return parseTransaction(value as Transaction) !== undefined;
}

type Dependencies = { fetch?: typeof fetch; now?: () => number };

export async function compareTransaction(
  transaction: Transaction,
  settings: ComparisonSettings = {},
  dependencies: Dependencies = {},
): Promise<Comparison> {
  const now = dependencies.now ?? Date.now;
  const unavailable = (reason: UnavailableReason): Comparison => ({ status: 'unavailable', reason, checkedAt: now() });
  const order = parseTransaction(transaction);
  if (!order) return unavailable('invalid-transaction');
  const { side, base, quote, quantity, total, observedAt } = order;
  const expiresAt = observedAt + TRANSACTION_MAX_AGE_MS;
  if (now() >= expiresAt || observedAt > now() + CLOCK_SKEW_MS) return unavailable('stale-transaction');
  if (FIAT.has(base) || !(FIAT.has(quote) || STABLE_QUOTES.has(quote))) return unavailable('unsupported-pair');

  const reference = settings.reference ?? 'Kraken Pro';
  const feeBps = {
    'Kraken Pro': settings.krakenTakerBps,
    'Binance Spot': settings.binanceTakerBps,
    'Coinbase Exchange': settings.coinbaseTakerBps,
  }[reference];
  if (!isFeeBps(feeBps)) return unavailable('fee-not-configured');

  try {
    const fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    const market = await loadMarket(reference, { fetch, now }, base, quote, quantity);
    const fill = fillMarket(market, side, quantity, feeBps);
    const checkedAt = now();
    if (checkedAt >= expiresAt) return unavailable('stale-transaction');
    const validUntil = Math.min(expiresAt, market.snapshotAt + BOOK_MAX_AGE_MS);
    if (checkedAt >= validUntil) return unavailable('stale-book');

    const improvement = side === 'buy' ? total - fill.total : fill.total - total;
    const savings = improvement > 0n ? improvement : 0n;
    const better = savings * BPS > total * BigInt(COMPARISON_THRESHOLD_BPS);
    const topOfBook = fill.topOfBook * BPS;
    const slippage = side === 'buy' ? fill.gross - topOfBook : topOfBook - fill.gross;
    const bestBid = market.bids[0].price;
    const bestAsk = market.asks[0].price;

    return {
      status: better ? 'better' : 'good',
      checkedAt,
      validUntil,
      reference,
      referenceGross: formatQuote(fill.gross),
      referenceFee: formatQuote(fill.fee),
      referenceTotal: formatQuote(fill.total),
      feeBps,
      feeEstimated: true,
      savings: formatQuote(savings),
      gapPct: percent(improvement, total),
      spreadPct: percent((bestAsk - bestBid) * 2n, bestAsk + bestBid),
      slippagePct: percent(slippage, topOfBook),
    };
  } catch (error) {
    return unavailable(error instanceof MarketFailure ? error.reason : 'network-error');
  }
}

export async function compareAverage(
  transaction: Transaction, settings: ComparisonSettings, dependencies: Dependencies = {},
): Promise<Comparison> {
  const now = dependencies.now ?? Date.now;
  const results = await Promise.all(REFERENCES.map(reference =>
    compareTransaction(transaction, { ...settings, reference }, dependencies)));
  const valid = results.filter(result => result.status !== 'unavailable').filter(result => result.validUntil > now());
  if (valid.length < 2) {
    const failed = results.find(result => result.status === 'unavailable');
    return { status: 'unavailable', reason: failed?.reason ?? 'market-unavailable', checkedAt: now() };
  }
  const total = parseDecimal(transaction.total)! * INPUT_TO_QUOTE;
  const count = BigInt(valid.length);
  function mean(key: 'referenceGross' | 'referenceFee' | 'referenceTotal') {
    return valid.reduce((sum, market) => {
      const [whole, fraction = ''] = market[key].split('.');
      return sum + BigInt(whole + fraction.padEnd(QUOTE_DECIMALS, '0'));
    }, 0n) / count;
  }
  const reference = mean('referenceTotal');
  const delta = transaction.side === 'buy' ? total - reference : reference - total;
  const savings = delta > 0n ? delta : 0n;
  return {
    status: savings * BPS > total * BigInt(COMPARISON_THRESHOLD_BPS) ? 'better' : 'good',
    checkedAt: now(), validUntil: Math.min(...valid.map(result => result.validUntil)),
    reference: AVERAGE, marketCount: valid.length, referenceGross: formatQuote(mean('referenceGross')),
    referenceFee: formatQuote(mean('referenceFee')), referenceTotal: formatQuote(reference),
    feeBps: 0, feeEstimated: true, savings: formatQuote(savings), gapPct: percent(delta, total),
    spreadPct: 0, slippagePct: 0,
  };
}
