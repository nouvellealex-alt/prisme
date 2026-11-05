import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction } from '../engine';
import { parseDecimal } from '../engine/decimal';
import type { PopupState, Settings } from '../shared';

function decimal(input: string) {
  const value = input.trim().replace(',', '.');
  return value.startsWith('.') ? '0' + value : value;
}

export function ManualForm({ transaction, platform, onCompare }: {
  transaction: Transaction | null;
  platform: PopupState['platform'];
  onCompare: (transaction: Transaction) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [side, setSide] = useState(transaction?.side ?? 'buy');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const submittedPlatform = text('platform') === 'kraken-pro' ? 'kraken-pro' : 'kraken';
    const base = text('base').toUpperCase();
    const quote = text('quote').toUpperCase();
    const quantity = decimal(text('quantity'));
    const total = decimal(text('total'));
    const fee = decimal(text('fee'));
    const validAsset = /^[A-Z0-9]{2,12}$/;
    if (!validAsset.test(base) || !validAsset.test(quote) || base === quote) {
      setError('Saisissez deux codes différents, comme BTC et EUR.');
      return;
    }
    const parsedTotal = parseDecimal(total);
    if (!parseDecimal(quantity) || !parsedTotal) {
      setError('La quantité et le total doivent être supérieurs à zéro.');
      return;
    }
    const parsedFee = parseDecimal(fee);
    if (fee && parsedFee === undefined) {
      setError('Saisissez le montant des frais en chiffres, ou laissez le champ vide.');
      return;
    }
    if (side === 'buy' && parsedFee !== undefined && parsedFee >= parsedTotal) {
      setError('Les frais inclus doivent être inférieurs au total à payer.');
      return;
    }
    void onCompare({ platform: submittedPlatform, side, base, quote, quantity, total, fee: fee || undefined, observedAt: Date.now() });
  }

  return <form className="form" onSubmit={submit}>
    <div className="form-row">
      <label className="field">Plateforme
        <select name="platform" defaultValue={transaction?.platform ?? platform ?? 'kraken'}>
          <option value="kraken">Kraken</option><option value="kraken-pro">Kraken Pro</option>
        </select>
      </label>
      <label className="field">Opération
        <select name="side" value={side} onChange={(event) => setSide(event.currentTarget.value === 'sell' ? 'sell' : 'buy')}>
          <option value="buy">Achat</option><option value="sell">Vente</option>
        </select>
      </label>
    </div>
    <div className="form-row">
      <label className="field">Crypto
        <input name="base" placeholder="BTC" maxLength={12} autoComplete="off" spellCheck={false} defaultValue={transaction?.base} required />
      </label>
      <label className="field">Devise du total
        <input name="quote" placeholder="EUR" maxLength={12} autoComplete="off" spellCheck={false} defaultValue={transaction?.quote} required />
      </label>
    </div>
    <div className="form-row">
      <label className="field">Quantité de crypto
        <input name="quantity" inputMode="decimal" placeholder="0,01" maxLength={39} autoComplete="off" defaultValue={transaction?.quantity} required />
      </label>
      <label className="field">{side === 'buy' ? 'Total à payer' : 'Total à recevoir'}
        <input name="total" inputMode="decimal" placeholder="100,00" maxLength={39} autoComplete="off" defaultValue={transaction?.total} aria-describedby="total-hint" required />
      </label>
    </div>
    <span id="total-hint" className="hint">Le total doit déjà tenir compte de tous les frais du devis.</span>
    <label className="field">Part des frais dans le total (facultatif)
      <input name="fee" inputMode="decimal" placeholder="Montant dans la devise du total" maxLength={39} autoComplete="off" defaultValue={transaction?.fee} />
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="submit" className="primary">Comparer ce devis</button></div>
  </form>;
}

function bps(input: string): number | undefined {
  const value = input.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return;
  const amount = Number(value);
  if (amount <= 10) return Math.round(amount * 100);
}

function feePercent(value: number | undefined) {
  return value === undefined ? '' : String(value / 100).replace('.', ',');
}

export function SettingsForm({ settings, onSave }: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const theme = form.get('theme');
    const kraken = String(form.get('krakenFee') ?? '').trim();
    const krakenTakerBps = bps(kraken);
    if (kraken && krakenTakerBps === undefined) {
      setError('Saisissez un taux entre 0 et 10 %, avec au maximum deux décimales.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
        inlineEnabled: form.has('inline'),
        krakenTakerBps,
      });
    } catch {
      setError('Les paramètres n’ont pas été enregistrés. Réessayez.');
      setSaving(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <p>Saisissez votre taux de frais pour un ordre au marché. Laissez le champ vide si vous ne le connaissez pas.</p>
    <div className="form-row">
      <label className="field">Kraken Pro (%)
        <input name="krakenFee" inputMode="decimal" maxLength={6} autoComplete="off" defaultValue={feePercent(settings.krakenTakerBps)} />
        <span className="hint">Pour les devis Kraken et Kraken Pro.</span>
      </label>
    </div>
    <label className="field">Apparence
      <select name="theme" defaultValue={settings.theme}>
        <option value="auto">Suivre le système</option>
        <option value="light">Clair</option>
        <option value="dark">Sombre</option>
      </select>
    </label>
    <label className="field check-field"><input name="inline" type="checkbox" defaultChecked={settings.inlineEnabled} /> Afficher le résultat dans la page</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
  </form>;
}
