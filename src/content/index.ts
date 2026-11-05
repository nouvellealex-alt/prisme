import { TRANSACTION_MAX_AGE_MS, type Comparison, type Transaction } from '../engine'
import { DEFAULT_SETTINGS, getSettings, parseSettings, platformFromUrl, STORAGE_KEY } from '../shared'
import { createBadge } from './badge'
import { detectQuote } from './detect'

const CHECK_INTERVAL_MS = 500
const STABLE_MS = 650
const platform = platformFromUrl(location.href)

if (platform && window.top === window) monitor(platform)

function monitor(platform: Transaction['platform']) {
  let settings = { ...DEFAULT_SETTINGS, inlineEnabled: false }
  let latest: { transaction: Transaction; key: string; surface: Element } | null = null
  let badge: ReturnType<typeof createBadge> | null = null
  let validUntil = 0
  let checkedKey = ''
  let dismissed = false
  let expiryTimer: number | undefined
  let interval: number | undefined
  let storageRevision = 0
  let visibilityRevision = 0
  let observedSurface: Element | null = null
  const observer = new MutationObserver(check)

  function clearBadge() {
    window.clearTimeout(expiryTimer)
    badge?.remove()
    badge = null
    validUntil = 0
  }

  function watch(surface: Element | null) {
    if (surface === observedSurface) return
    observer.disconnect()
    observedSurface = surface
    if (surface) observer.observe(surface, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-checked', 'aria-disabled', 'aria-hidden', 'aria-pressed', 'aria-selected', 'disabled', 'hidden', 'value'],
    })
  }

  function scan() {
    const candidate = detectQuote(document, platform)
    if (document.visibilityState === 'visible') watch(candidate?.surface ?? null)
    if (!candidate) {
      if (latest) clearBadge()
      latest = null
      checkedKey = ''
      dismissed = false
      return null
    }
    const key = JSON.stringify(candidate.quote)
    if (latest?.key === key) {
      latest.surface = candidate.surface
    } else {
      clearBadge()
      latest = {
        transaction: { ...candidate.quote, observedAt: Date.now() },
        key,
        surface: candidate.surface,
      }
    }
    return latest
  }

  function check() {
    if (document.visibilityState !== 'visible' || !document.body) return
    const current = scan()
    if (!current || !settings.inlineEnabled || dismissed) return
    const now = Date.now()
    if (badge && now >= validUntil) clearBadge()
    badge?.position(current.surface)
    const { transaction, key } = current
    const age = now - transaction.observedAt
    const checkKey = `${transaction.observedAt}:${key}`
    if (age < STABLE_MS || age >= TRANSACTION_MAX_AGE_MS || checkedKey === checkKey) return
    checkedKey = checkKey
    const revision = storageRevision
    const visibility = visibilityRevision

    void chrome.runtime.sendMessage({ type: 'PRISME_COMPARE_TRANSACTION', transaction })
      .then((comparison: Comparison | null | undefined) => {
        if (!comparison || comparison.status === 'unavailable' || revision !== storageRevision || visibility !== visibilityRevision ||
            !settings.inlineEnabled || dismissed || document.visibilityState !== 'visible') return
        const current = scan()
        if (current?.transaction !== transaction || comparison.validUntil <= Date.now()) return

        badge = createBadge(comparison, transaction, settings.theme, () => {
          dismissed = true
          clearBadge()
        })
        badge.position(current.surface)
        validUntil = comparison.validUntil
        expiryTimer = window.setTimeout(clearBadge, Math.max(0, validUntil - Date.now()))
      }).catch(() => {
        // Chrome invalidates old content scripts when the unpacked extension is reloaded.
      })
  }

  function pause() {
    window.clearInterval(interval)
    visibilityRevision += 1
    checkedKey = ''
    watch(null)
    clearBadge()
  }

  function syncVisibility() {
    window.clearInterval(interval)
    if (document.visibilityState === 'visible') {
      check()
      interval = window.setInterval(check, CHECK_INTERVAL_MS)
    } else {
      pause()
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id === chrome.runtime.id &&
        (message as { type?: string } | null)?.type === 'PRISME_GET_TRANSACTION') {
      reply(scan()?.transaction ?? null)
    }
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return
    storageRevision += 1
    settings = parseSettings(changes[STORAGE_KEY].newValue)
    checkedKey = ''
    clearBadge()
    check()
  })

  void getSettings().then(value => {
    if (storageRevision === 0) settings = value
    check()
  }).catch(() => undefined)

  document.addEventListener('visibilitychange', syncVisibility)
  document.addEventListener('input', event => {
    if (latest?.surface.contains(event.target as Node)) queueMicrotask(check)
  }, true)
  window.addEventListener('resize', check)
  // Capture scroll in nested panels as well, since that can move a control into a badge corner.
  window.addEventListener('scroll', () => {
    if (badge && latest) badge.position(latest.surface)
  }, { capture: true, passive: true })
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', syncVisibility)
  syncVisibility()
}
