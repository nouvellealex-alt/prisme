import { BPS, INPUT_DECIMALS, parseDecimal } from './decimal';

export const BOOK_MAX_AGE_MS = 12_000;
export const CLOCK_SKEW_MS = 2_000;

const KRAKEN_API = 'https://api.kraken.com/0/public/';
const UNIT = 10n ** BigInt(INPUT_DECIMALS);
const KRAKEN_SPREAD_LIMIT = UNIT * 25n / 1000n;

export type Reference = 'Kraken Pro';
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
};

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
    if (response.status === 404 && missingIsUnsupported) fail('unsupported-pair');
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

export async function loadMarket(
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
    minCost,
  };
}

function checkPriceProtection(market: Market, side: 'buy' | 'sell', worstPrice: bigint) {
  const bid = market.bids[0].price;
  const ask = market.asks[0].price;
  const low = side === 'buy' ? bid : worstPrice;
  const high = side === 'buy' ? worstPrice : ask;
  // The venue's lowest published market protection across spot pairs is 2.5%.
  if ((high - low) * 2n * UNIT >= (high + low) * KRAKEN_SPREAD_LIMIT) fail('insufficient-depth');
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
  if (gross < market.minCost * UNIT) fail('order-size');

  const fee = gross * BigInt(feeBps);
  const grossQuote = gross * BPS;
  const total = side === 'buy' ? grossQuote + fee : grossQuote - fee;
  return { gross: grossQuote, fee, total, topOfBook: quantity * levels[0].price };
}
