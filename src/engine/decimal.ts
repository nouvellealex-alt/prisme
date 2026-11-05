export const INPUT_DECIMALS = 18;
export const BPS = 10_000n;
export const QUOTE_DECIMALS = INPUT_DECIMALS * 2 + 4;
export const INPUT_TO_QUOTE = 10n ** BigInt(QUOTE_DECIMALS - INPUT_DECIMALS);

export function parseDecimal(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d{1,20}(?:\.\d{1,18})?$/.test(value)) {
    return undefined;
  }

  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(INPUT_DECIMALS, '0'));
}

export function formatQuote(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(QUOTE_DECIMALS + 1, '0');
  const whole = digits.slice(0, -QUOTE_DECIMALS);
  const fraction = digits.slice(-QUOTE_DECIMALS).replace(/0+$/, '');
  return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}

export function percent(numerator: bigint, denominator: bigint): number {
  // Keep comparisons in integer space. Only the display percentage uses floating point.
  return Number(numerator * 100_000_000n / denominator) / 1_000_000;
}
