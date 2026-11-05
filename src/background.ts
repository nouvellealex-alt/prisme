import { compareTransaction, isTransaction, REFERENCES, type Reference, type Comparison, type Transaction } from './engine';
import { getSettings, parseSettings, platformFromUrl, STORAGE_KEY, type PopupRequest, type PopupState } from './shared';

type ComparePageRequest = { type: 'PRISME_COMPARE_TRANSACTION'; transaction: Transaction };

async function compare(transaction: Transaction, reference?: Reference): Promise<Comparison> {
  const settings = await getSettings();
  if (reference && REFERENCES.includes(reference)) settings.reference = reference;
  return compareTransaction(transaction, settings);
}

async function currentState(reference?: Reference): Promise<PopupState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = platformFromUrl(tab?.url);
  if (tab?.id === undefined) return { platform, transaction: null, comparison: null };

  let transaction: Transaction | null;
  try {
    transaction = await chrome.tabs.sendMessage(tab.id, { type: 'PRISME_GET_TRANSACTION' }, { frameId: 0 });
  } catch {
    return { platform, transaction: null, comparison: null };
  }
  if (!isTransaction(transaction) || (platform && transaction.platform !== platform)) {
    return { platform, transaction: null, comparison: null };
  }
  const comparison = await compare(transaction, reference);
  if (comparison.status === 'unavailable') return { platform: transaction.platform, transaction, comparison };

  // The tab may have navigated or updated the quote while the public book was loading.
  const latest: Transaction | null = await chrome.tabs.sendMessage(
    tab.id, { type: 'PRISME_GET_TRANSACTION' }, { frameId: 0 },
  ).catch(() => null);
  if (JSON.stringify(latest) !== JSON.stringify(transaction)) {
    return { platform, transaction: null, comparison: null };
  }
  return { platform: transaction.platform, transaction, comparison };
}

async function handlePopup(message: PopupRequest): Promise<unknown> {
  switch (message.type) {
    case 'PRISME_GET_STATE': return currentState(message.reference);
    case 'PRISME_COMPARE_MANUAL': return compare(message.transaction, message.reference);
    case 'PRISME_GET_SETTINGS': return getSettings();
    case 'PRISME_SAVE_SETTINGS': {
      const settings = parseSettings(message.settings);
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
      return settings;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message: PopupRequest | ComparePageRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== 'string') return;

  let result: Promise<unknown>;
  if (message.type === 'PRISME_COMPARE_TRANSACTION') {
    const platform = platformFromUrl(sender.url);
    if (!platform || sender.frameId !== 0 || message.transaction?.platform !== platform) return;
    result = compare(message.transaction);
  } else {
    if (sender.url !== chrome.runtime.getURL('popup.html')) return;
    result = handlePopup(message);
  }
  void result.then(sendResponse, () => sendResponse(null));
  return true;
});
