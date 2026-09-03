import { useCallback, useEffect, useState } from 'react';
import { adminCreateCheckout, adminList, adminUpdate, formatMoney, getCatalog } from '../api';
import { STATUS_COPY } from './StatusLookup';
import type { AdminRequest, Catalog, RequestStatus } from '../types';

const STATUSES: RequestStatus[] = [
  'new',
  'accepted',
  'writing',
  'delivered',
  'declined',
  'cancelled',
];
const TOKEN_KEY = 'song-requests-admin-token';

export default function Admin() {
  // Session storage, not local: the token dies with the tab.
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [tokenDraft, setTokenDraft] = useState('');
  const [filter, setFilter] = useState<RequestStatus | ''>('');
  const [items, setItems] = useState<AdminRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog).catch(() => undefined);
  }, []);

  // The queue stores tier and add-on ids; the catalog turns them back into names.
  const nameOf = (id: string) =>
    catalog?.tiers.find((t) => t.id === id)?.name ??
    catalog?.addOns.find((a) => a.id === id)?.name ??
    id;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await adminList(token, filter);
      setItems(data.items);
      setCounts(data.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load requests.');
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  function signIn(event: React.FormEvent) {
    event.preventDefault();
    sessionStorage.setItem(TOKEN_KEY, tokenDraft.trim());
    setToken(tokenDraft.trim());
    setTokenDraft('');
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setItems([]);
  }

  async function patch(id: string, body: Parameters<typeof adminUpdate>[2]) {
    try {
      const { request } = await adminUpdate(token, id, body);
      setItems((current) => current.map((item) => (item.id === id ? request : item)));
      if (filter) void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  if (!token) {
    return (
      <section className="panel">
        <h1>Artist login</h1>
        <p className="panel-hint">
          Paste the ADMIN_TOKEN from the server environment. It's kept for this tab only.
        </p>
        <form onSubmit={signIn}>
          <label className="field">
            <span className="field-label">Admin token</span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button type="submit" className="primary">
            Open the queue
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="admin">
      <header className="admin-header">
        <h1>The queue</h1>
        <button type="button" className="secondary" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="filters">
        <button
          type="button"
          className={filter === '' ? 'chip on' : 'chip'}
          onClick={() => setFilter('')}
        >
          All
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={filter === status ? 'chip on' : 'chip'}
            onClick={() => setFilter(status)}
          >
            {STATUS_COPY[status].label}
            {counts[status] ? <span className="count">{counts[status]}</span> : null}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 && <p className="notice">Nothing here yet.</p>}

      <ul className="request-list">
        {items.map((item) => (
          <li key={item.id} className="request-row">
            <button
              type="button"
              className="request-summary"
              onClick={() => setOpenId(openId === item.id ? null : item.id)}
              aria-expanded={openId === item.id}
            >
              <span className={`status-pill status-${item.status}`}>
                {STATUS_COPY[item.status]?.label ?? item.status}
              </span>
              <span className="request-subject">{item.subject}</span>
              <span className="request-meta">
                {item.reference} · {nameOf(item.tierId)} ·{' '}
                {formatMoney(item.amountMinor, item.currency)} · {item.paymentStatus}
              </span>
            </button>

            {openId === item.id && (
              <RequestDetail
                request={item}
                onPatch={patch}
                nameOf={nameOf}
                token={token}
                canCharge={catalog?.payment.provider === 'stripe'}
                onCharged={(updated) =>
                  setItems((current) =>
                    current.map((row) => (row.id === updated.id ? updated : row)),
                  )
                }
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestDetail({
  request,
  onPatch,
  nameOf,
  token,
  canCharge,
  onCharged,
}: {
  request: AdminRequest;
  onPatch: (id: string, body: Parameters<typeof adminUpdate>[2]) => Promise<void>;
  nameOf: (id: string) => string;
  token: string;
  canCharge: boolean;
  onCharged: (request: AdminRequest) => void;
}) {
  const [notes, setNotes] = useState(request.artistNotes ?? '');
  const [deliveryUrl, setDeliveryUrl] = useState(request.deliveryUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);

  async function mintPaymentLink() {
    setMinting(true);
    setCheckoutError(null);
    try {
      const result = await adminCreateCheckout(token, request.id);
      setCheckoutUrl(result.checkoutUrl);
      setEmailed(result.emailed);
      onCharged(result.request);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not create a payment link.');
    } finally {
      setMinting(false);
    }
  }

  async function saveDetails() {
    setSaving(true);
    await onPatch(request.id, {
      artistNotes: notes.trim() || null,
      deliveryUrl: deliveryUrl.trim() || null,
    });
    setSaving(false);
  }

  return (
    <div className="request-detail">
      <dl className="detail-grid">
        <Detail label="From">{`${request.fanName} <${request.fanEmail}>`}</Detail>
        <Detail label="Ordered">{new Date(request.createdAt).toLocaleString('en-GB')}</Detail>
        <Detail label="Needed by">{request.neededBy ?? 'No date given'}</Detail>
        <Detail label="Turnaround">{`${request.turnaroundDays} days`}</Detail>
        <Detail label="Tier">{nameOf(request.tierId)}</Detail>
        <Detail label="Add-ons">{request.addOnIds.map(nameOf).join(', ') || 'None'}</Detail>
        <Detail label="Occasion">{request.occasion ?? '—'}</Detail>
        <Detail label="Mood">{request.mood ?? '—'}</Detail>
        <Detail label="References">{request.referenceTracks ?? '—'}</Detail>
        <Detail label="Can be shared">{request.sharePublicly ? 'Yes' : 'No — keep private'}</Detail>
      </dl>

      <h3>The story</h3>
      <p className="brief-text">{request.brief}</p>

      {request.mustInclude && (
        <>
          <h3>Must include</h3>
          <p className="brief-text">{request.mustInclude}</p>
        </>
      )}
      {request.avoid && (
        <>
          <h3>Avoid</h3>
          <p className="brief-text">{request.avoid}</p>
        </>
      )}

      <div className="detail-actions">
        <label className="field">
          <span className="field-label">Status</span>
          <select
            value={request.status}
            onChange={(e) => void onPatch(request.id, { status: e.target.value as RequestStatus })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_COPY[status].label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Payment</span>
          <select
            value={request.paymentStatus}
            onChange={(e) => void onPatch(request.id, { paymentStatus: e.target.value })}
          >
            {['unpaid', 'pending', 'paid'].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canCharge && request.paymentStatus !== 'paid' && (
        <div className="payment-link">
          <button type="button" className="secondary" onClick={() => void mintPaymentLink()} disabled={minting}>
            {minting ? 'Asking Stripe…' : 'Create a payment link'}
          </button>
          {checkoutUrl && (
            <p className="notice">
              {emailed
                ? `Emailed to ${request.fanName}. Here it is if you want to send it yourself: `
                : `Couldn't email it, so send this to ${request.fanName} yourself: `}
              <a href={checkoutUrl} target="_blank" rel="noreferrer">
                {checkoutUrl}
              </a>
            </p>
          )}
          {checkoutError && (
            <p className="notice error" role="alert">
              {checkoutError}
            </p>
          )}
        </div>
      )}

      <label className="field">
        <span className="field-label">Delivery link</span>
        <input
          value={deliveryUrl}
          onChange={(e) => setDeliveryUrl(e.target.value)}
          placeholder="https://…"
        />
        <span className="field-hint">
          {request.deliveredEmailAt
            ? `Emailed to ${request.fanName} on ${new Date(request.deliveredEmailAt).toLocaleDateString('en-GB')}.`
            : 'Saved with the status on Delivered, this emails the song to them - once.'}
        </span>
      </label>

      <label className="field">
        <span className="field-label">Private notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      <button type="button" className="primary" onClick={() => void saveDetails()} disabled={saving}>
        {saving ? 'Saving…' : 'Save notes and link'}
      </button>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
