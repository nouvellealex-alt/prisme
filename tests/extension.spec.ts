import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const test = base.extend<{ extension: { context: BrowserContext; url: string } }>({
  extension: async ({}, use) => {
    const dist = path.resolve('dist');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.PRISME_TEST_CHROMIUM,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      viewport: { width: 380, height: 520 },
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      await use({ context, url: `chrome-extension://${new URL(worker.url()).host}/popup.html` });
    } finally {
      await context.close();
    }
  },
});

// These fixtures are never loaded by the production extension.
async function mockKraken(context: BrowserContext, mode: 'normal' | 'network-error' = 'normal') {
  const requests: string[] = [];
  await context.route('https://api.kraken.com/0/public/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (mode === 'network-error') return route.fulfill({ status: 503, body: 'Fixture unavailable' });
    if (url.pathname.endsWith('/AssetPairs')) {
      return route.fulfill({ json: { error: [], result: { XXBTZEUR: {
        wsname: 'XBT/EUR', status: 'online', aclass_base: 'currency', aclass_quote: 'currency',
        lot_multiplier: 1, ordermin: '0.0001', costmin: '5', lot_decimals: 8,
      } } } });
    }
    if (url.pathname.endsWith('/Depth')) {
      return route.fulfill({ headers: { date: new Date().toUTCString() }, json: { error: [], result: { XXBTZEUR: {
        asks: [['50000', '0.006', 0], ['51000', '0.02', 0]],
        bids: [['49900', '0.02', 0]],
      } } } });
    }
    return route.abort();
  });
  return requests;
}

async function openPopup(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Comparaison indisponible' })).toBeVisible();
  return page;
}

async function settings(page: Page, theme: 'auto' | 'dark' = 'auto') {
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await page.getByLabel(/Kraken Pro \(%\)/).fill('0,40');
  await page.getByLabel('Apparence').selectOption(theme);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

async function enterQuote(page: Page, total: string, side: 'buy' | 'sell' = 'buy') {
  await page.getByRole('button', { name: 'Saisir un devis' }).click();
  await page.getByLabel('Opération').selectOption(side);
  await page.getByLabel('Crypto', { exact: true }).fill('BTC');
  await page.getByLabel('Devise du total').fill('EUR');
  await page.getByLabel('Quantité de crypto').fill('0,01');
  await page.getByLabel(side === 'buy' ? 'Total à payer' : 'Total à recevoir').fill(total);
  await page.getByRole('button', { name: 'Comparer ce devis' }).click();
}

test('refuses a verdict and makes no market request when the fee is unknown', async ({ extension }) => {
  const requests = await mockKraken(extension.context);
  const page = await openPopup(extension.context, extension.url);
  await enterQuote(page, '520');
  await expect(page.getByRole('button', { name: 'Configurer les frais' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comparaison indisponible' })).toBeVisible();
  expect(requests).toEqual([]);
});

test('shows the estimate, details and persisted dark theme in the built extension', async ({ extension }, testInfo) => {
  const requests = await mockKraken(extension.context);
  const page = await openPopup(extension.context, extension.url);
  await settings(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await enterQuote(page, '520');
  await expect(page.getByRole('heading', { name: /Économie possible de 13,98/ })).toBeVisible();
  await expect(page.getByText('BTC / EUR', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(520);
  expect(requests).toEqual(['/0/public/AssetPairs?pair=XBTEUR', '/0/public/Depth?pair=XXBTZEUR&count=100']);
  await page.screenshot({ path: testInfo.outputPath('popup-savings-dark.png') });

  await page.getByRole('button', { name: 'Voir la comparaison' }).click();
  await expect(page.getByRole('heading', { name: 'Détail de la comparaison' })).toBeVisible();
  await expect(page.getByText('Montant inconnu', { exact: true })).toBeVisible();
  await expect(page.getByText(/506,02/)).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await expect(page.getByLabel(/Kraken Pro \(%\)/)).toHaveValue('0,4');
});

test('shows a competitive sale and explains the calculation', async ({ extension }, testInfo) => {
  await mockKraken(extension.context);
  const page = await openPopup(extension.context, extension.url);
  await settings(page);
  await enterQuote(page, '498', 'sell');
  await expect(page.getByRole('heading', { name: 'Bon prix' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('popup-good-light.png') });
  await page.getByRole('button', { name: 'Comment est-ce calculé ?' }).click();
  await expect(page.getByRole('heading', { name: 'Sources de référence' })).toBeVisible();
});

test('degrades cleanly when the public market is unavailable', async ({ extension }, testInfo) => {
  await mockKraken(extension.context, 'network-error');
  const page = await openPopup(extension.context, extension.url);
  await settings(page);
  await enterQuote(page, '520');
  await expect(page.getByRole('heading', { name: 'Comparaison indisponible' })).toBeVisible();
  await expect(page.getByText(/n’a pas répondu/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('popup-unavailable-light.png') });
});

test('detects a visible Kraken review and removes the badge when the review disappears', async ({ extension }) => {
  await mockKraken(extension.context);
  await extension.context.route('https://app.kraken.com/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="en"><head><title>Kraken test fixture</title></head><body>
      <div role="dialog" aria-label="Test review" style="position:absolute;inset:130px 20px auto;">
        <dl>
          <dt>Amount</dt><dd>0.010000 BTC</dd>
          <dt>Price</dt><dd>€51,000.00</dd>
          <dt>Pay with</dt><dd>EUR balance</dd>
          <dt>Total</dt><dd>€520.00 Incl. €10.00 fee</dd>
        </dl>
        <button type="button">Confirm</button>
      </div>
    </body></html>`,
  }));
  const popup = await openPopup(extension.context, extension.url);
  await settings(popup);
  const site = await extension.context.newPage();
  await site.goto('https://app.kraken.com/fixture');
  const badge = site.locator('prisme-price-badge');
  await expect(badge).toBeVisible();
  await expect(site.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await site.bringToFront();
  await popup.reload();
  await expect(popup.getByRole('heading', { name: /Économie possible de 13,98/ })).toBeVisible();
  await site.getByRole('dialog').evaluate(node => node.remove());
  await expect(badge).toHaveCount(0);
});
test('switches the same Binance quote between spot references and applies the selected fee', async ({ extension }) => {
  await mockKraken(extension.context);
  const calls: string[] = [];
  await extension.context.route('https://data-api.binance.vision/api/v3/**', async route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/exchangeInfo')) {
      return route.fulfill({ json: { symbols: [{
        symbol: 'BTCEUR', baseAsset: 'BTC', quoteAsset: 'EUR', status: 'TRADING',
        isSpotTradingAllowed: true, orderTypes: ['MARKET'],
        filters: [
          { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '100', stepSize: '0.00001' },
          { filterType: 'MARKET_LOT_SIZE', minQty: '0', maxQty: '100', stepSize: '0' },
          { filterType: 'NOTIONAL', applyMinToMarket: true, minNotional: '5' },
        ],
      }] } });
    }
    return route.fulfill({ headers: { date: new Date().toUTCString() }, json: {
      bids: [['48950', '1']], asks: [['49000', '1']],
    } });
  });
  const page = await openPopup(extension.context, extension.url);
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await page.getByLabel(/Kraken Pro \(%\)/).fill('0,40');
  await page.getByLabel(/Binance Spot \(%\)/).fill('0,10');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('button', { name: 'Saisir un devis' }).click();
  await page.getByLabel('Plateforme').selectOption('binance');
  await page.getByLabel('Crypto', { exact: true }).fill('BTC');
  await page.getByLabel('Devise du total').fill('EUR');
  await page.getByLabel('Quantité de crypto').fill('0,01');
  await page.getByLabel('Total à payer').fill('520');
  await page.getByRole('button', { name: 'Comparer ce devis' }).click();
  await expect(page.getByRole('heading', { name: /Économie possible de 13,98/ })).toBeVisible();
  await page.getByLabel('Comparer avec').selectOption('Binance Spot');
  await expect(page.getByRole('heading', { name: /Économie possible de 29,51/ })).toBeVisible();
  expect(calls).toEqual(['/api/v3/exchangeInfo?symbol=BTCEUR', '/api/v3/depth?symbol=BTCEUR&limit=100']);
});
