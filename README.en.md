# Prisme

[Français](README.md) · [Calculation and official sources](docs/method.md) · [Design proposals](docs/design.md)

Prisme is a Chrome extension that checks whether a crypto buy or sell quote is competitive for the same quantity. Its French-language popup shows one verdict, the time of the check, and the difference after estimated trading fees when the data supports a comparison.

## Install in Chrome

1. Extract `prisme-chrome-v1.2.1.zip`, or build from source as shown below.
2. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
3. Select the folder containing `manifest.json`. Select `dist/` when using a local build.
4. Open Prisme and enter the applicable market-order fee for the reference venue under **Paramètres**. Enter the percentage for your account and pair.

## Compare a quote

Open Prisme on a spot buy or sell review screen. It attempts to read the exact quantity and total from recognized summaries. If the layout is unsupported, choose **Saisir un devis** and copy a quote you have just received. Enter the all-in amount payable for buys or the net amount receivable for sells. You may enter the source fee separately when it is already included in that total.

| Quote source | Input |
| --- | --- |
| Kraken and Kraken Pro | Recognized quote review layouts or manual entry |
| Binance, Coinbase and other platforms | Manual all-in quote entry |

Choose Kraken Pro, Binance Spot or Coinbase Exchange under **Comparer avec**. The external references support BTC, ETH and SOL as base assets, subject to exact pair availability. Configure your applicable taker fee for each reference under **Paramètres**.

**Bon prix** means the quoted amount is close to or more favorable than the reference after fees. Any potential saving is an estimate from a snapshot of the order book and can change before execution. It describes one reference market and assumes that you can access it and have the necessary funds in the quoted currency.

## Build and test

Use Node.js 24 and pnpm 11.25.0 (`npm install --global pnpm@11.25.0`).

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The React popup is in `src/popup/`. The read-only DOM adapter and Shadow DOM badge are in `src/content/`. `src/engine/` contains the comparison and public market clients. The MV3 background worker validates messages and runs the calculations. GitHub Actions runs TypeScript, Vitest and the Chromium extension tests.

## Privacy and limitations

Prisme stores preferences locally. Quotes remain in memory for the comparison. Public HTTPS market requests send the pair, without the user's amount, side or account identifier. Prisme has no order or wallet access.

The detector supports recognized, explicit review layouts. Authenticated Kraken and Kraken Pro layouts can change, and not every variant has been verified on a live account. Manual entry covers unreadable quotes. Conversions between volatile crypto assets, limit orders, leverage and derivatives are outside the MVP. The comparison excludes funding, transfer, withdrawal and currency conversion costs. See the [calculation and limits](docs/method.md) for the safeguards and source documentation.

## Roadmap

1. Expand Kraken and Kraken Pro detection using anonymized review fixtures in multiple languages and layouts.
2. Evaluate automatic quote detection for Binance and Coinbase.
3. Evaluate Uniswap separately with on-chain quotes, gas and liquidity checks.

Independent project. No affiliation with Kraken or Google.
