import { useEffect, useState } from 'react';
import { formatMoney, lookupRequest } from '../api';
import type { PublicRequest } from '../types';

export const STATUS_COPY: Record<string, { label: string; blurb: string }> = {
  new: { label: 'With me to read', blurb: "I've got the brief and I'm reading it." },
  accepted: { label: 'Accepted', blurb: "It's a yes — it's in the queue." },
  writing: { label: 'Being written', blurb: "I'm working on it now." },
  delivered: { label: 'Delivered', blurb: "It's yours. Check your email." },
  declined: { label: 'Not taken on', blurb: "I couldn't take this one on. You haven't been charged." },
  cancelled: { label: 'Cancelled', blurb: 'This request was cancelled.' },
};

/** Reads the query Stripe appends when it sends a fan back to the site. */
function returnParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

export default function StatusLookup() {
  const [reference, setReference] = useState(() => returnParams().get('ref') ?? '');
  const [justPaid, setJustPaid] = useState(() => returnParams().get('paid') === '1');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setReference(returnParams().get('ref') ?? '');
      setJustPaid(returnParams().get('paid') === '1');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { request } = await lookupRequest(reference.trim().toUpperCase(), email.trim());
      setResult(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that request.');
    } finally {
      setLoading(false);
    }
  }

  const status = result ? (STATUS_COPY[result.status] ?? { label: result.status, blurb: '' }) : null;

  return (
    <section className="panel lookup">
      <h1>Where's my song?</h1>
      <p className="panel-hint">Your reference looks like SR-ABC234. Same email you used to order.</p>

      {justPaid && (
        <p className="notice paid-notice">
          Payment received — thank you. Your song is in the queue. Pop your email in below any time
          to see how it's coming along.
        </p>
      )}

      <form onSubmit={onSubmit}>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="SR-ABC234"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        </div>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Looking…' : 'Look it up'}
        </button>
      </form>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {result && status && (
        <div className="lookup-result">
          <p className={`status-pill status-${result.status}`}>{status.label}</p>
          <h2>{result.subject}</h2>
          <p>{status.blurb}</p>
          <dl className="tier-facts">
            <div>
              <dt>Tier</dt>
              <dd>{result.tier.name}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatMoney(result.amountMinor, result.currency)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{result.paymentStatus}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{new Date(result.createdAt).toLocaleDateString('en-GB')}</dd>
            </div>
          </dl>
          {result.deliveryUrl && (
            <p>
              <a className="primary link-button" href={result.deliveryUrl}>
                Listen to your song
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
