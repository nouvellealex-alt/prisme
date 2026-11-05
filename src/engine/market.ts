import { BPS, INPUT_DECIMALS, parseDecimal } from './decimal';

export const BOOK_MAX_AGE_MS = 12_000;
export const CLOCK_SKEW_MS = 2_000;

const KRAKEN_API = 'https://api.kraken.com/0/public/';
const BINANCE_API = 'https://data-api.binance.vision/api/v3/';
const COINBASE_API = 'https://api.exchange.coinbase.com/products/';
const VERIFIED_CROSS_VENUE_ASSETS = new Set(['BTC', 'ETH', 'SOL']);
const COINBASE_QUOTES = new Set(['EUR', 'USD', 'GBP']);
const UNIT = 10n ** BigInt(INPUT_DECIMALS);
const KRAKEN_SPREAD_LIMIT = UNIT * 25n / 1000n;

export const REFERENCES = ['Kraken Pro', 'Binance Spot', 'Coinbase Exchange'] as const;
export type Reference = typeof REFERENCES[number];
export type MarketError = 'unsupported-pair' | 'market-unavailable' | 'order-size'
  | 'insufficient-depth' | 'stale-book' | 'network-error';

export class MarketFailure extends Error {
  constructor(readonly reason: MarketError) {
    super(reason);
  }
}

type JsonObject = Record<string, unknown>;
type Level = { price: bigint; size: bigint };
export type Market = {
  bids: Level[];
  asks: Level[];
  snapshotAt: number;
  minCost: bigint;
} & (
  { reference: 'Kraken Pro' }
  | { reference: 'Coinbase Exchange'; slippageLimit: bigint }
  | { reference: 'Binance Spot'; maxCost?: bigint }
);

type RequestContext = { fetch: typeof fetch; now: () => number };

function fail(reason: MarketError): never {
  throw new MarketFailure(reason);
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('market-unavailable');
  }
  return value as JsonObject;
}

export function normalizeAsset(value: string): string {
  if (value === 'XBT') return 'BTC';
  if (value === 'XDG') return 'DOGE';
  return value;
}

function krakenAsset(value: string): string {
  if (value === 'BTC') return 'XBT';
  if (value === 'DOGE') return 'XDG';
  return value;
}

async function request(context: RequestContext, url: string, missingIsUnsupported = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await context.fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if ((response.status === 400 || response.status === 404) && missingIsUnsupported) fail('unsupported-pair');
    if (!response.ok) fail('network-error');
    return { body: object(await response.json()), headers: response.headers };
  } catch (error) {
    if (error instanceof MarketFailure) throw error;
    fail('network-error');
  } finally {
    clearTimeout(timer);
  }
}

function krakenResult(body: JsonObject): JsonObject {
  if (!Array.isArray(body.error)) fail('market-unavailable');
  if (body.error.includes('EQuery:Unknown asset pair')) fail('unsupported-pair');
  if (body.error.length !== 0) fail('market-unavailable');
  return object(body.result);
}

function parseLevelSide(rows: unknown, ascending: boolean): Level[] {
  if (!Array.isArray(rows)) fail('market-unavailable');
  if (rows.length === 0) fail('insufficient-depth');
  if (rows.length > 50_000) fail('market-unavailable');

  const levels: Level[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) fail('market-unavailable');
    const price = parseDecimal(row[0]);
    const size = parseDecimal(row[1]);
    if (!price || !size) fail('market-unavailable');
    levels.push({ price, size });
  }
  levels.sort((a, b) => (a.price > b.price ? 1 : a.price < b.price ? -1 : 0) * (ascending ? 1 : -1));
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index - 1].price === levels[index].price) fail('market-unavailable');
  }
  return levels;
}

function parseBook(book: JsonObject, snapshotAt: number, context: RequestContext) {
  const age = context.now() - snapshotAt;
  if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS || age >= BOOK_MAX_AGE_MS) fail('stale-book');

  const bids = parseLevelSide(book.bids, false);
  const asks = parseLevelSide(book.asks, true);
  if (bids[0].price >= asks[0].price) fail('market-unavailable');
  return { bids, asks, snapshotAt };
}

async function krakenMarket(
  context: RequestContext,
  base: string,
  quote: string,
  quantity: bigint,
): Promise<Market> {
  const pair = krakenAsset(base) + krakenAsset(quote);
  const { body } = await request(context, KRAKEN_API + 'AssetPairs?' + new URLSearchParams({ pair }));
  const matchedPair = Object.entries(krakenResult(body)).find(([, candidate]) => {
    const { wsname } = object(candidate);
    return typeof wsname === 'string' && wsname.split('/').map(normalizeAsset).join('/') === base + '/' + quote;
  });
  if (!matchedPair) fail('unsupported-pair');

  const [pairId, candidate] = matchedPair;
  const info = object(candidate);
  if (info.status !== 'online' || info.aclass_base !== 'currency' || info.aclass_quote !== 'currency'
    || info.lot_multiplier !== 1) fail('market-unavailable');

  const minQuantity = parseDecimal(info.ordermin);
  const minCost = parseDecimal(info.costmin);
  const precision = info.lot_decimals;
  if (!minQuantity || minCost === undefined || typeof precision !== 'number'
    || !Number.isInteger(precision) || precision < 0 || precision > INPUT_DECIMALS) fail('market-unavailable');
  const increment = 10n ** BigInt(INPUT_DECIMALS - precision);
  if (quantity < minQuantity || quantity % increment !== 0n) fail('order-size');

  const depth = await request(context, KRAKEN_API + 'Depth?' + new URLSearchParams({ pair: pairId, count: '100' }));
  const serverDate = Date.parse(depth.headers.get('Date') ?? '');
  const ageHeader = depth.headers.get('Age');
  const cacheAge = ageHeader === null ? 0 : Number(ageHeader);
  if (!Number.isFinite(cacheAge) || cacheAge < 0 || cacheAge * 1000 >= BOOK_MAX_AGE_MS) fail('stale-book');
  const snapshotAt = Math.min(serverDate, context.now() - cacheAge * 1000);
  // Kraken's per-level timestamps describe resting levels, so the HTTP date is the snapshot freshness proxy.
  return {
    ...parseBook(object(krakenResult(depth.body)[pairId]), snapshotAt, context),
    reference: 'Kraken Pro',
    minCost,
  };
}

async function coinbaseMarket(
  context: RequestContext,
  base: string,
  quote: string,
  quantity: bigint,
): Promise<Market> {
  if (!VERIFIED_CROSS_VENUE_ASSETS.has(base) || !COINBASE_QUOTES.has(quote)) fail('unsupported-pair');

  const pair = base + '-' + quote;
  const url = COINBASE_API + pair;
  const { body: info } = await request(context, url, true);
  if (info.id !== pair || info.base_currency !== base || info.quote_currency !== quote) fail('unsupported-pair');
  if (info.status !== 'online' || info.post_only !== false || info.limit_only !== false || info.cancel_only !== false
    || info.auction_mode !== false || info.trading_disabled === true) fail('market-unavailable');

  const minCost = parseDecimal(info.min_market_funds);
  const increment = parseDecimal(info.base_increment);
  const slippageLimit = parseDecimal(info.max_slippage_percentage);
  if (minCost === undefined || !increment || !slippageLimit || slippageLimit >= UNIT) fail('market-unavailable');
  if (quantity % increment !== 0n) fail('order-size');

  const { body: book } = await request(context, url + '/book?level=2', true);
  if (book.auction_mode === true) fail('market-unavailable');
  const snapshotAt = typeof book.time === 'string' ? Date.parse(book.time) : NaN;
  return { ...parseBook(book, snapshotAt, context), reference: 'Coinbase Exchange', minCost, slippageLimit };
}

async function binanceMarket(
  context: RequestContext, base: string, quote: string, quantity: bigint,
): Promise<Market> {
  if (!VERIFIED_CROSS_VENUE_ASSETS.has(base)) fail('unsupported-pair');
  const symbol = base + quote;
  const { body } = await request(context, BINANCE_API + 'exchangeInfo?' + new URLSearchParams({ symbol }), true);
  if (!Array.isArray(body.symbols) || body.symbols.length !== 1) fail('unsupported-pair');
  const info = object(body.symbols[0]);
  if (info.symbol !== symbol || info.baseAsset !== base || info.quoteAsset !== quote) fail('unsupported-pair');
  if (info.status !== 'TRADING' || info.isSpotTradingAllowed !== true
    || !Array.isArray(info.orderTypes) || !info.orderTypes.includes('MARKET')
    || !Array.isArray(info.filters)) fail('market-unavailable');

  const filters = info.filters.map(object);
  for (const type of ['LOT_SIZE', 'MARKET_LOT_SIZE']) {
    const lot = filters.find(filter => filter.filterType === type);
    if (!lot) fail('market-unavailable');
    const min = parseDecimal(lot.minQty);
    const max = parseDecimal(lot.maxQty);
    const step = parseDecimal(lot.stepSize);
    if (min === undefined || max === undefined || step === undefined) fail('market-unavailable');
    if (quantity < min || (max > 0n && quantity > max) || (step > 0n && quantity % step !== 0n)) fail('order-size');
  }

  let minCost = 0n;
  let maxCost: bigint | undefined;
  for (const filter of filters) {
    if (filter.filterType !== 'MIN_NOTIONAL' && filter.filterType !== 'NOTIONAL') continue;
    if (filter.applyToMarket === true || filter.applyMinToMarket === true) {
      const value = parseDecimal(filter.minNotional);
      if (value === undefined) fail('market-unavailable');
      if (value > minCost) minCost = value;
    }
    if (filter.applyMaxToMarket === true) {
      const value = parseDecimal(filter.maxNotional);
      if (!value) fail('market-unavailable');
      if (maxCost === undefined || value < maxCost) maxCost = value;
    }
  }

  const { body: book, headers } = await request(
    context, BINANCE_API + 'depth?' + new URLSearchParams({ symbol, limit: '100' }), true,
  );
  const age = Number(headers.get('Age') ?? '0');
  if (!Number.isFinite(age) || age < 0) fail('stale-book');
  const snapshotAt = Math.min(Date.parse(headers.get('Date') ?? ''), context.now() - age * 1000);
  return { ...parseBook(book, snapshotAt, context), reference: 'Binance Spot', minCost, maxCost };
}

export function loadMarket(reference: Reference, context: RequestContext, base: string, quote: string, quantity: bigint) {
  switch (reference) {
    case 'Binance Spot': return binanceMarket(context, base, quote, quantity);
    case 'Coinbase Exchange': return coinbaseMarket(context, base, quote, quantity);
    case 'Kraken Pro': return krakenMarket(context, base, quote, quantity);
  }
}

function checkPriceProtection(market: Market, side: 'buy' | 'sell', worstPrice: bigint) {
  const bid = market.bids[0].price;
  const ask = market.asks[0].price;
  if (market.reference !== 'Coinbase Exchange') {
    const low = side === 'buy' ? bid : worstPrice;
    const high = side === 'buy' ? worstPrice : ask;
    // Conservative spread guard. Kraken documents this as its lowest spot protection.
    if ((high - low) * 2n * UNIT >= (high + low) * KRAKEN_SPREAD_LIMIT) fail('insufficient-depth');
  } else {
    // Coinbase Exchange measures price protection from the book's original midpoint.
    const doubledMidpoint = bid + ask;
    const distance = side === 'buy' ? worstPrice * 2n - doubledMidpoint : doubledMidpoint - worstPrice * 2n;
    if (distance * UNIT > doubledMidpoint * market.slippageLimit) fail('insufficient-depth');
  }
}

export function fillMarket(market: Market, side: 'buy' | 'sell', quantity: bigint, feeBps: number) {
  const levels = side === 'buy' ? market.asks : market.bids;
  let remaining = quantity;
  let gross = 0n;
  let lastPrice = levels[0].price;

  for (const { price, size } of levels) {
    const filled = remaining < size ? remaining : size;
    remaining -= filled;
    gross += filled * price;
    lastPrice = price;
    if (remaining === 0n) break;
  }
  if (remaining > 0n) fail('insufficient-depth');
  checkPriceProtection(market, side, lastPrice);
  if (gross < market.minCost * UNIT || (market.reference === 'Binance Spot'
    && market.maxCost !== undefined && gross > market.maxCost * UNIT)) fail('order-size');

  const fee = gross * BigInt(feeBps);
  const grossQuote = gross * BPS;
  const total = side === 'buy' ? grossQuote + fee : grossQuote - fee;
  return { gross: grossQuote, fee, total, topOfBook: quantity * levels[0].price };
}
