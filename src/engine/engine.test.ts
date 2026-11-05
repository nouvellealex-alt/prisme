import { describe, expect, it, vi } from 'vitest';
import { compareTransaction, TRANSACTION_MAX_AGE_MS, type Transaction } from './index';

const now = Date.UTC(2026, 10, 5, 20, 30, 0);
const source: Transaction = {
  platform: 'kraken',
  side: 'buy',
  base: 'BTC',
  quote: 'EUR',
  quantity: '1',
  total: '109.20',
  fee: '1.09',
  observedAt: now - 1_000,
};

const krakenPair = {
  wsname: 'XBT/EUR',
  status: 'online',
  aclass_base: 'currency',
  aclass_quote: 'currency',
  lot_multiplier: 1,
  ordermin: '0.0001',
  costmin: '0.5',
  lot_decimals: 8,
};
const krakenBook = {
  asks: [['101', '4', 1], ['99', '0.5', 1]],
  bids: [['95.4', '4', 1], ['98.6', '0.5', 1]],
};

function krakenResponses(options: {
  pair?: Partial<typeof krakenPair>;
  book?: Partial<typeof krakenBook>;
  date?: number;
  age?: string;
} = {}) {
  const { pair, book, date = now, age = '0' } = options;
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ error: [], result: { XXBTZEUR: { ...krakenPair, ...pair } } }))
    .mockResolvedValueOnce(Response.json(
      { error: [], result: { XXBTZEUR: { ...krakenBook, ...book } } },
      { headers: { Date: new Date(date).toUTCString(), Age: age } },
    ));
}

const coinbasePair = {
  id: 'BTC-EUR',
  base_currency: 'BTC',
  quote_currency: 'EUR',
  status: 'online',
  post_only: false,
  limit_only: false,
  cancel_only: false,
  auction_mode: false,
  min_market_funds: '1',
  base_increment: '0.00000001',
  max_slippage_percentage: '0.05',
};

function coinbaseResponses(
  pair: Partial<typeof coinbasePair> = {},
  book: Partial<typeof krakenBook & { time: string; auction_mode: boolean }> = {},
) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...coinbasePair, ...pair }))
    .mockResolvedValueOnce(Response.json({ ...krakenBook, time: new Date(now).toISOString(), ...book }));
}

describe('compareTransaction', () => {
  it('uses exact quantities across buy levels and adds the configured fee', async () => {
    const fetch = krakenResponses();
    const result = await compareTransaction(source, { krakenTakerBps: 80 }, { fetch, now: () => now });
    expect(result).toMatchObject({
      status: 'better',
      reference: 'Kraken Pro',
      referenceGross: '100',
      referenceFee: '0.8',
      referenceTotal: '100.8',
      savings: '8.4',
      checkedAt: now,
      validUntil: now + 12_000,
      slippagePct: 1.010101,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1, 'https://api.kraken.com/0/public/AssetPairs?pair=XBTEUR',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2, 'https://api.kraken.com/0/public/Depth?pair=XXBTZEUR&count=100',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('uses bids and subtracts fees when selling on the reference market', async () => {
    const fetch = coinbaseResponses();
    const order: Transaction = { ...source, platform: 'kraken-pro', side: 'sell', total: '95' };
    const result = await compareTransaction(order, { coinbaseTakerBps: 100 }, { fetch, now: () => now });
    expect(result).toMatchObject({
      status: 'better',
      reference: 'Coinbase Exchange',
      referenceGross: '97',
      referenceFee: '0.97',
      referenceTotal: '96.03',
      savings: '1.03',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2, 'https://api.exchange.coinbase.com/products/BTC-EUR/book?level=2', expect.any(Object),
    );
  });

  it('treats a lower current buy price or a small estimated improvement as good', async () => {
    const options = { krakenTakerBps: 80 };
    const betterCurrent = await compareTransaction(
      { ...source, total: '100' }, options, { fetch: krakenResponses(), now: () => now },
    );
    const smallImprovement = await compareTransaction(
      { ...source, total: '101' }, options, { fetch: krakenResponses(), now: () => now },
    );
    expect(betterCurrent).toMatchObject({ status: 'good', savings: '0', gapPct: -0.8 });
    expect(smallImprovement).toMatchObject({ status: 'good', savings: '0.2' });
  });

  it('allows an exact zero fee override, and never derives missing fees from price alone', async () => {
    const fetch = krakenResponses();
    const missing = await compareTransaction(source, {}, { fetch, now: () => now });
    expect(missing).toMatchObject({ status: 'unavailable', reason: 'fee-not-configured' });
    expect(fetch).not.toHaveBeenCalled();
    const knownTotal = { ...source };
    delete knownTotal.fee;
    const free = await compareTransaction(knownTotal, { krakenTakerBps: 0 }, { fetch, now: () => now });
    expect(free).toMatchObject({ status: 'better', referenceTotal: '100', referenceFee: '0' });
  });

  it('rejects malformed, stale, or future-dated quote inputs before using network data', async () => {
    const fetch = krakenResponses();
    const check = (order: Transaction) => compareTransaction(order, { krakenTakerBps: 0 }, { fetch, now: () => now });
    await expect(check({ ...source, quantity: '1e-8' })).resolves.toMatchObject({ reason: 'invalid-transaction' });
    await expect(check({ ...source, fee: '120' })).resolves.toMatchObject({ reason: 'invalid-transaction' });
    await expect(check({ ...source, observedAt: now - TRANSACTION_MAX_AGE_MS })).resolves.toMatchObject({
      reason: 'stale-transaction',
    });
    await expect(check({ ...source, observedAt: now + 5_000 })).resolves.toMatchObject({ reason: 'stale-transaction' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses expired market snapshots and cached Kraken quotes', async () => {
    const staleDate = krakenResponses({ date: now - 12_000 });
    const aged = krakenResponses({ age: '13' });
    for (const fetch of [staleDate, aged]) {
      await expect(compareTransaction(source, { krakenTakerBps: 80 }, { fetch, now: () => now }))
        .resolves.toMatchObject({ reason: 'stale-book' });
    }
    const oldCoinbase = coinbaseResponses({}, { time: new Date(now - 60_000).toISOString() });
    await expect(compareTransaction(
      { ...source, platform: 'kraken-pro' }, { coinbaseTakerBps: 60 }, { fetch: oldCoinbase, now: () => now },
    )).resolves.toMatchObject({ reason: 'stale-book' });
  });

  it('excludes crypto conversions and FX pairs before fetching a reference', async () => {
    const fetch = krakenResponses();
    for (const order of [{ ...source, quote: 'USDT' }, { ...source, base: 'USD' }]) {
      await expect(compareTransaction(order, { krakenTakerBps: 80 }, { fetch, now: () => now }))
        .resolves.toMatchObject({ reason: 'unsupported-pair' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechecks quote expiry after the market request finishes', async () => {
    const fetch = krakenResponses();
    const almostExpired = { ...source, observedAt: now - TRANSACTION_MAX_AGE_MS + 1 };
    let reads = 0;
    const result = await compareTransaction(almostExpired, { krakenTakerBps: 80 }, {
      fetch, now: () => (reads++ < 2 ? now : now + 2),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'stale-transaction' });
  });

  it('refuses inexact quantity increments, minimums, thin books and crossed quotes', async () => {
    const cases = [
      [krakenResponses({ pair: { lot_decimals: 0 } }), { ...source, quantity: '1.5' }, 'order-size'],
      [krakenResponses({ pair: { ordermin: '2' } }), source, 'order-size'],
      [krakenResponses({ pair: { costmin: '150' } }), source, 'order-size'],
      [krakenResponses({ book: { asks: [['101', '0.001', 1]] } }), source, 'insufficient-depth'],
      [krakenResponses({ book: { asks: [['110', '3', 1]] } }), source, 'insufficient-depth'],
      [krakenResponses({ book: { asks: [['95', '3', 1]] } }), source, 'market-unavailable'],
    ] as const;
    for (const [fetch, order, reason] of cases) {
      await expect(compareTransaction(order, { krakenTakerBps: 80 }, { fetch, now: () => now }))
        .resolves.toMatchObject({ status: 'unavailable', reason });
    }
  });

  it('refuses unknown cross-venue token identity, auction markets and excessive slippage', async () => {
    const order: Transaction = { ...source, platform: 'kraken-pro' };
    const noPair = coinbaseResponses();
    const check = (fetch: typeof globalThis.fetch, tx = order) =>
      compareTransaction(tx, { coinbaseTakerBps: 60 }, { fetch, now: () => now });
    await expect(check(noPair, { ...order, base: 'DOGE' })).resolves.toMatchObject({ reason: 'unsupported-pair' });
    expect(noPair).not.toHaveBeenCalled();
    await expect(check(coinbaseResponses({ auction_mode: true }))).resolves.toMatchObject({ reason: 'market-unavailable' });
    await expect(check(coinbaseResponses({ min_market_funds: '150' }))).resolves.toMatchObject({ reason: 'order-size' });
    await expect(check(coinbaseResponses({ max_slippage_percentage: '0.01' }))).resolves.toMatchObject({
      reason: 'insufficient-depth',
    });
  });

  it('reports network errors without falling back to estimated or fabricated prices', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Offline'));
    await expect(compareTransaction(source, { krakenTakerBps: 80 }, { fetch, now: () => now }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'network-error' });
  });
});
