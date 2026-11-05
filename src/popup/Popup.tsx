import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Comparison, Transaction } from '../engine';
import { DEFAULT_SETTINGS, request } from '../shared';
import type { PopupState, Settings } from '../shared';
import { ManualForm, SettingsForm } from './Forms';
import { Icon } from './Icon';

type View = 'home' | 'details' | 'method' | 'manual' | 'settings';
type ReferenceComparison = Extract<Comparison, { reference: string }>;
type Reason = Extract<Comparison, { status: 'unavailable' }>['reason'];

const unavailableMessages: Record<Reason, string> = {
  'invalid-transaction': 'Le montant final ou la quantité du devis n’est pas exploitable.',
  'stale-transaction': 'Le devis est trop ancien. Vérifiez les montants affichés sur la plateforme.',
  'fee-not-configured': 'Indiquez vos frais de marché de référence dans les paramètres.',
  'unsupported-pair': 'La même paire n’est pas disponible sur le marché de référence.',
  'market-unavailable': 'Le marché de référence est momentanément indisponible.',
  'order-size': 'Ce montant sort des limites connues du marché de référence.',
  'insufficient-depth': 'Le carnet de référence ne couvre pas toute la quantité de crypto.',
  'stale-book': 'Le carnet de référence a expiré avant la fin du calcul.',
  'network-error': 'Le marché de référence n’a pas répondu. Réessayez dans un instant.',
};

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 18 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fiat = new Set(['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD']);

// Chromium's Intl formatter preserves decimal strings. The ES2022 type lists numbers and bigints.
function formatDecimal(formatter: Intl.NumberFormat, amount: string) {
  return (formatter.format as (value: number | bigint | string) => string)(amount);
}

function money(amount: string, currency: string) {
  const magnitude = Math.abs(Number(amount));
  const significant = magnitude > 0 && magnitude < (currency === 'JPY' ? 1 : 0.01)
    ? { maximumSignificantDigits: 2 }
    : {};
  if (fiat.has(currency)) {
    return formatDecimal(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, ...significant }), amount);
  }
  const formatter = magnitude > 0 && magnitude < 1e-8
    ? new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 2 })
    : number;
  return formatDecimal(formatter, amount) + '\u00a0' + currency;
}

function ratio(value: number) {
  return percent.format(value / 100);
}

function platformName(platform: PopupState['platform']) {
  return platform === 'kraken' ? 'Kraken' : platform === 'kraken-pro' ? 'Kraken Pro' : '—';
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="metric"><dt>{label}</dt><dd>{children}</dd></div>;
}

function Verdict({
  comparison, transaction, loading, expired, error,
}: {
  comparison: Comparison | null;
  transaction: Transaction | null;
  loading: boolean;
  expired: boolean;
  error: boolean;
}) {
  if (loading) return <section className="verdict" role="status">
    <div className="verdict-label"><Icon name="scan" size={16} /> Marché de référence</div>
    <h1>Vérification en cours</h1>
    <p>Prisme recherche un prix comparable.</p>
  </section>;

  if (comparison?.status === 'better' && transaction && !expired) {
    const savingLabel = transaction.side === 'buy' ? 'Économie possible' : 'Gain supplémentaire possible';
    return <section className="verdict" data-tone="better" role="status">
      <div className="verdict-label"><Icon name="spark" size={16} /> {savingLabel}</div>
      <h1 className="amount" aria-label={savingLabel + ' de ' + money(comparison.savings, transaction.quote)}>
        {money(comparison.savings, transaction.quote)}
      </h1>
      <p>Une offre comparable semble plus avantageuse, frais estimés inclus.</p>
    </section>;
  }

  if (comparison?.status === 'good' && !expired) return <section className="verdict" data-tone="good" role="status">
    <div className="verdict-label"><Icon name="check" size={16} /> Écart estimé {ratio(Math.abs(comparison.gapPct))}</div>
    <h1>Bon prix</h1>
    <p>Votre devis est au moins aussi avantageux ou proche de la référence, frais estimés inclus.</p>
  </section>;

  const message = error
    ? 'La vérification a été interrompue. Vous pouvez réessayer.'
    : expired
      ? 'Le dernier calcul a expiré. Vérifiez à nouveau votre devis.'
      : comparison?.status === 'unavailable'
        ? unavailableMessages[comparison.reason]
        : 'Ouvrez le récapitulatif d’une transaction Kraken ou saisissez votre devis.';
  return <section className="verdict" data-tone={expired ? 'warn' : undefined} role="status">
    <div className="verdict-label"><Icon name="scan" size={16} /> {expired ? 'Données expirées' : 'Vérification requise'}</div>
    <h1>Comparaison indisponible</h1>
    <p>{message}</p>
  </section>;
}

function Details({ comparison, transaction, expired }: {
  comparison: ReferenceComparison;
  transaction: Transaction;
  expired: boolean;
}) {
  const { quote } = transaction;
  const totalLabel = transaction.side === 'buy' ? 'Total à payer' : 'Total à recevoir';
  return <>
    <p>{expired ? 'Ce calcul a expiré.' : 'Estimation au moment de la vérification.'} Les prix disponibles peuvent changer.</p>
    <dl className="details">
      <Metric label="Quantité comparée">{formatDecimal(number, transaction.quantity)} {transaction.base}</Metric>
      <Metric label={'Devis · ' + totalLabel}>{money(transaction.total, quote)}</Metric>
      <Metric label="Frais du devis inclus">{transaction.fee === undefined ? 'Montant inconnu' : money(transaction.fee, quote)}</Metric>
      <Metric label="Marché de référence">{comparison.reference}</Metric>
      <Metric label="Montant au carnet">{money(comparison.referenceGross, quote)}</Metric>
      <Metric label={'Frais estimés · ' + ratio(comparison.feeBps / 100)}>{money(comparison.referenceFee, quote)}</Metric>
      <Metric label={'Référence · ' + totalLabel}>{money(comparison.referenceTotal, quote)}</Metric>
      {comparison.status === 'better' && <Metric label={transaction.side === 'buy' ? 'Économie possible' : 'Gain possible'}>
        {money(comparison.savings, quote)} ({ratio(comparison.gapPct)})
      </Metric>}
      <Metric label="Écart entre achat et vente">{ratio(comparison.spreadPct)}</Metric>
      <Metric label="Effet de la profondeur">{ratio(comparison.slippagePct)}</Metric>
    </dl>
    <p>La référence suppose un ordre au marché et des fonds déjà disponibles dans la bonne devise. Elle inclut les frais de marché saisis dans les paramètres. Les conversions, transferts et retraits restent à votre charge.</p>
  </>;
}

function Method() {
  return <div className="method-list">
    <article><h2>Même transaction</h2><p>Prisme compare le total final du devis avec le prix d’un ordre au marché de même sens, quantité et paire. Les deux totaux utilisent la même devise.</p></article>
    <article><h2>Prix disponible au carnet</h2><p>Le calcul parcourt les niveaux d’achat ou de vente jusqu’à couvrir la quantité. Les frais estimés sont ajoutés à un achat et déduits d’une vente.</p></article>
    <article><h2>Sources de référence</h2><p>Les devis Kraken et Kraken Pro sont comparés au carnet Spot public de Kraken. Pour un devis Kraken Pro, le résultat mesure l’écart avec une estimation sur le même marché.</p></article>
    <article><h2>Fonds et coûts annexes</h2><p>Le calcul suppose des fonds disponibles dans la même devise sur les deux plateformes. Il exclut les conversions, les transferts et les retraits.</p></article>
  </div>;
}
const initialState: PopupState = { platform: null, transaction: null, comparison: null };

export function Popup() {
  const [data, setData] = useState(initialState);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsAvailable, setSettingsAvailable] = useState(false);
  const [view, setView] = useState<View>('home');
  const [source, setSource] = useState<'tab' | 'manual'>('tab');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const focusPage = useRef(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    setExpired(false);
    setSource('tab');
    try {
      const result = await request<PopupState>({ type: 'PRISME_GET_STATE' });
      if (requestVersion.current === version) setData(result);
    } catch {
      if (requestVersion.current === version) {
        setData(initialState);
        setError(true);
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await request<Settings>({ type: 'PRISME_GET_SETTINGS' }));
      setSettingsAvailable(true);
    } catch {
      setSettingsAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadSettings();
  }, [refresh, loadSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const { comparison, transaction } = data;
  useEffect(() => {
    if (!comparison || comparison.status === 'unavailable') return;
    const remaining = comparison.validUntil - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [comparison]);

  useEffect(() => {
    if (focusPage.current) {
      pageRef.current?.focus();
      focusPage.current = false;
    }
  }, [view]);

  function show(next: View) {
    focusPage.current = true;
    setView(next);
  }

  async function compareManual(manual: Transaction) {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    setExpired(false);
    setSource('manual');
    setData({ platform: manual.platform, transaction: manual, comparison: null });
    show('home');
    try {
      const result = await request<Comparison>({ type: 'PRISME_COMPARE_MANUAL', transaction: manual });
      if (requestVersion.current === version) {
        setData({ platform: manual.platform, transaction: manual, comparison: result });
      }
    } catch {
      if (requestVersion.current === version) setError(true);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }

  async function saveSettings(next: Settings) {
    const saved = await request<Settings>({ type: 'PRISME_SAVE_SETTINGS', settings: next });
    setSettings(saved);
    if (source === 'manual') {
      requestVersion.current += 1;
      setLoading(false);
      setData((previous) => ({ ...previous, comparison: null }));
      show('manual');
    } else {
      show('home');
      void refresh();
    }
  }

  const detailed = comparison !== null && comparison.status !== 'unavailable' && transaction !== null;
  const status = loading ? 'loading' : detailed && !expired ? 'ready' : 'pending';
  const statusLabel = status === 'loading' ? 'Vérification' : status === 'ready' ? 'Référence reçue' : 'En attente';
  const setupNeeded = comparison?.status === 'unavailable' && comparison.reason === 'fee-not-configured';

  return <div className="shell">
    <header className="topbar">
      <span className="brand-icon"><Icon name="brand" size={20} /></span>
      <span className="brand">Prisme</span>
      <span className="connection" data-status={status}><span className="connection-dot" />{statusLabel}</span>
      {view !== 'settings' && <button className="icon-button" type="button" aria-label="Paramètres"
        title="Paramètres" onClick={() => { void loadSettings(); show('settings'); }}><Icon name="settings" /></button>}
    </header>

    {view === 'home' ? <main ref={pageRef} tabIndex={-1} aria-label="Comparaison">
      <Verdict comparison={comparison} transaction={transaction} loading={loading} expired={expired} error={error} />
      <dl className="transaction">
        <Metric label="Paire">{transaction ? transaction.base + ' / ' + transaction.quote : '—'}</Metric>
        <Metric label="Plateforme">{platformName(data.platform)}</Metric>
        <Metric label={transaction?.side === 'buy' ? 'Total à payer' : transaction?.side === 'sell' ? 'Total à recevoir' : 'Montant'}>
          {transaction ? money(transaction.total, transaction.quote) : '—'}
        </Metric>
        <Metric label="Dernière vérification">{comparison ? hour.format(comparison.checkedAt) : '—'}</Metric>
      </dl>
      <div className="actions">
        {setupNeeded ? <button className="primary" type="button" disabled={loading}
          onClick={() => { void loadSettings(); show('settings'); }}>Configurer les frais<Icon name="arrow" size={14} /></button>
          : detailed && !expired ? <button className="primary" type="button" disabled={loading} onClick={() => show('details')}>
            {comparison.status === 'better' ? 'Voir la comparaison' : 'Voir les détails'}<Icon name="arrow" size={14} />
          </button>
            : <button className="primary" type="button" disabled={loading} onClick={() => show('manual')}>
              {source === 'manual' ? 'Vérifier le devis saisi' : 'Saisir un devis'}<Icon name="edit" size={14} />
            </button>}
        <div className="small-actions">
          {!loading && !detailed && source === 'tab' && <button className="text-button" type="button" onClick={() => void refresh()}>Réessayer</button>}
          {expired && source === 'tab' && <button className="text-button" type="button" onClick={() => void refresh()}>Actualiser</button>}
          {detailed && !expired && source === 'manual' && <button className="text-button" type="button" onClick={() => show('manual')}>Modifier le devis</button>}
          <button className="text-button" type="button" onClick={() => show('method')}>Comment est-ce calculé ?</button>
        </div>
      </div>
    </main> : <main className="subpage" ref={pageRef} tabIndex={-1} aria-labelledby="view-title">
      <button className="text-button back" type="button" onClick={() => show('home')}><Icon name="back" size={14} /> Retour</button>
      {view === 'details' && detailed && <>
        <h1 id="view-title">Détail de la comparaison</h1>
        <Details comparison={comparison} transaction={transaction} expired={expired} />
      </>}
      {view === 'method' && <><h1 id="view-title">Comment est-ce calculé ?</h1><Method /></>}
      {view === 'manual' && <>
        <h1 id="view-title">Saisir un devis</h1>
        <p>Recopiez la quantité de crypto et le total final d’un devis au comptant affiché à l’instant, dans une devise traditionnelle comme l’euro.</p>
        <ManualForm transaction={transaction} platform={data.platform} onCompare={compareManual} />
      </>}
      {view === 'settings' && <>
        <h1 id="view-title">Paramètres</h1>
        {settingsAvailable ? <SettingsForm settings={settings} onSave={saveSettings} /> : <>
          <p>Les paramètres sont indisponibles.</p>
          <button type="button" className="secondary" onClick={() => void loadSettings()}>Recharger les paramètres</button>
        </>}
      </>}
    </main>}
  </div>;
}
