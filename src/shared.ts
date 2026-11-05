import { isFeeBps, type Comparison, type Transaction } from './engine';

export type Platform = Transaction['platform'];
export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  krakenTakerBps?: number;
  coinbaseTakerBps?: number;
  theme: Theme;
  inlineEnabled: boolean;
}

export const STORAGE_KEY = 'preferences';
export const DEFAULT_SETTINGS: Readonly<Settings> = { theme: 'auto', inlineEnabled: true };

export interface PopupState {
  transaction: Transaction | null;
  comparison: Comparison | null;
  platform: Platform | null;
}

export type PopupRequest =
  | { type: 'PRISME_GET_STATE' }
  | { type: 'PRISME_COMPARE_MANUAL'; transaction: Transaction }
  | { type: 'PRISME_GET_SETTINGS' }
  | { type: 'PRISME_SAVE_SETTINGS'; settings: Settings };

export const SITE_PLATFORMS: Readonly<Record<string, Platform>> = {
  'https://app.kraken.com': 'kraken',
  'https://pro.kraken.com': 'kraken-pro',
};

export function platformFromUrl(url: string | undefined): Platform | null {
  if (!url) return null;
  try {
    return SITE_PLATFORMS[new URL(url).origin] ?? null;
  } catch {
    return null;
  }
}

export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const input = value as Partial<Settings>;
  const settings: Settings = {
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'auto',
    inlineEnabled: typeof input.inlineEnabled === 'boolean' ? input.inlineEnabled : DEFAULT_SETTINGS.inlineEnabled,
  };
  for (const key of ['krakenTakerBps', 'coinbaseTakerBps'] as const) {
    const bps = input[key];
    if (isFeeBps(bps)) settings[key] = bps;
  }
  return settings;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return parseSettings(stored[STORAGE_KEY]);
}

export async function request<T>(message: PopupRequest): Promise<T> {
  const response: T | undefined = await chrome.runtime.sendMessage(message);
  if (response === undefined || response === null) throw new Error('Prisme did not respond');
  return response;
}
