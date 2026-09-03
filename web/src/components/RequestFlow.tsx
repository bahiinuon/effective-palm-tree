import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, getCatalog, submitRequest } from '../api';
import type { NewRequestInput, PaymentOutcome } from '../api';
import { ApiError } from '../types';
import type { AddOn, Catalog, PublicRequest, Tier } from '../types';

type Confirmation = {
  request: PublicRequest;
  payment: PaymentOutcome;
};

const emptyForm = {
  fanName: '',
  fanEmail: '',
  subject: '',
  brief: '',
  occasion: '',
  mustInclude: '',
  avoid: '',
  mood: '',
  referenceTracks: '',
  neededBy: '',
  sharePublicly: false,
};

type FormState = typeof emptyForm;

export default function RequestFlow() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const briefRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCatalog()
      .then(setCatalog)
      .catch(() => setLoadError("Couldn't load the tiers just now. Give it a refresh?"));
  }, []);

  const tier = useMemo(
    () => catalog?.tiers.find((t) => t.id === tierId) ?? null,
    [catalog, tierId],
  );

  const chosenAddOns = useMemo(
    () => catalog?.addOns.filter((a) => addOnIds.includes(a.id)) ?? [],
    [catalog, addOnIds],
  );

  const total = (tier?.priceMinor ?? 0) + chosenAddOns.reduce((sum, a) => sum + a.priceMinor, 0);
  const turnaround = tier
    ? addOnIds.includes('rush')
      ? Math.max(1, Math.ceil(tier.turnaroundDays / 2))
      : tier.turnaroundDays
    : 0;

  function chooseTier(next: Tier) {
    setTierId(next.id);
    // Give the form a beat to render before scrolling to it.
    window.requestAnimationFrame(() =>
      briefRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  function toggleAddOn(addOn: AddOn) {
    setAddOnIds((ids) =>
      ids.includes(addOn.id) ? ids.filter((id) => id !== addOn.id) : [...ids, addOn.id],
    );
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors(({ [key as string]: _removed, ...rest }) => rest);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!tier || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    const payload: NewRequestInput = {
      tierId: tier.id,
      addOnIds,
      fanName: form.fanName,
      fanEmail: form.fanEmail,
      subject: form.subject,
      brief: form.brief,
      sharePublicly: form.sharePublicly,
    };
    for (const key of ['occasion', 'mustInclude', 'avoid', 'mood', 'referenceTracks', 'neededBy'] as const) {
      if (form[key].trim()) payload[key] = form[key].trim();
    }

    try {
      setConfirmation(await submitRequest(payload));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.fields.length > 0) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        setSubmitError('Have another look at the highlighted answers.');
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again?');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <ConfirmationPanel
        confirmation={confirmation}
        onAnother={() => {
          setConfirmation(null);
          setTierId(null);
          setAddOnIds([]);
          setForm(emptyForm);
        }}
      />
    );
  }

  if (loadError) return <p className="notice error">{loadError}</p>;
  if (!catalog) return <p className="notice">Loading the songbook…</p>;

  return (
    <>
      <section className="hero">
        <h1>Tell me a story. I'll write you the song.</h1>
        <p>
          Birthdays, apologies, first dances, the dog. You tell me who it's for and what happened;
          I'll write and record it. Pick how big you want it to be.
        </p>
      </section>

      <section className="tiers" aria-label="Song tiers">
        {catalog.tiers.map((t) => (
          <article
            key={t.id}
            className={`tier-card${tierId === t.id ? ' selected' : ''}`}
            aria-current={tierId === t.id}
          >
            <header>
              <h2>{t.name}</h2>
              <p className="price">{formatMoney(t.priceMinor, catalog.currency)}</p>
            </header>
            <p className="tagline">{t.tagline}</p>
            <dl className="tier-facts">
              <div>
                <dt>Length</dt>
                <dd>{t.lengthLabel}</dd>
              </div>
              <div>
                <dt>Ready in</dt>
                <dd>{t.turnaroundDays} days</dd>
              </div>
              <div>
                <dt>Revisions</dt>
                <dd>{t.revisions === 0 ? 'None' : `${t.revisions} round${t.revisions > 1 ? 's' : ''}`}</dd>
              </div>
            </dl>
            <ul className="deliverables">
              {t.deliverables.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <button
              type="button"
              className="primary"
              onClick={() => chooseTier(t)}
              aria-label={tierId === t.id ? `${t.name} selected` : `Choose ${t.name}`}
            >
              {tierId === t.id ? 'Selected' : 'Choose this one'}
            </button>
          </article>
        ))}
      </section>

      {tier && (
        <div className="brief" ref={briefRef}>
          <form onSubmit={onSubmit} noValidate>
            <section className="panel">
              <h2>The brief</h2>
              <p className="panel-hint">
                The more specific you are, the better the song. Real names, real details, the thing
                only you would know.
              </p>

              <Field
                label="Who or what is the song about?"
                error={fieldErrors.subject}
                required
                hint="One line is plenty — “my dad Ray, retiring after 40 years driving buses”."
              >
                <input
                  value={form.subject}
                  onChange={(e) => update('subject', e.target.value)}
                  maxLength={200}
                  required
                />
              </Field>

              <Field
                label="Tell me the story"
                error={fieldErrors.brief}
                required
                hint="How you met, what they're like, the moment you want the song to land on."
              >
                <textarea
                  value={form.brief}
                  onChange={(e) => update('brief', e.target.value)}
                  rows={7}
                  maxLength={4000}
                  required
                />
                <p className="counter">{form.brief.length}/4000</p>
              </Field>

              <div className="field-row">
                <Field label="Occasion" error={fieldErrors.occasion} hint="Wedding, birthday, apology…">
                  <input
                    value={form.occasion}
                    onChange={(e) => update('occasion', e.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field
                  label="Needed by"
                  error={fieldErrors.neededBy}
                  hint="I'll tell you honestly if it's too tight."
                >
                  <input
                    type="date"
                    value={form.neededBy}
                    onChange={(e) => update('neededBy', e.target.value)}
                  />
                </Field>
              </div>

              <Field
                label="Names, places or lines that must be in it"
                error={fieldErrors.mustInclude}
                hint="Spell out anything unusual — I will sing it exactly as written."
              >
                <textarea
                  value={form.mustInclude}
                  onChange={(e) => update('mustInclude', e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </Field>

              <Field
                label="Anything to steer clear of"
                error={fieldErrors.avoid}
                hint="Subjects, nicknames, an ex nobody mentions."
              >
                <textarea
                  value={form.avoid}
                  onChange={(e) => update('avoid', e.target.value)}
                  rows={2}
                  maxLength={1000}
                />
              </Field>

              <div className="field-row">
                <Field label="Mood" error={fieldErrors.mood} hint="Funny, tender, defiant, filthy…">
                  <input
                    value={form.mood}
                    onChange={(e) => update('mood', e.target.value)}
                    maxLength={300}
                  />
                </Field>
                <Field
                  label="Songs it should feel like"
                  error={fieldErrors.referenceTracks}
                  hint="Two or three tracks as a compass."
                >
                  <input
                    value={form.referenceTracks}
                    onChange={(e) => update('referenceTracks', e.target.value)}
                    maxLength={500}
                  />
                </Field>
              </div>
            </section>

            <section className="panel">
              <h2>Add-ons</h2>
              <div className="add-ons">
                {catalog.addOns.map((addOn) => (
                  <label key={addOn.id} className={addOnIds.includes(addOn.id) ? 'add-on on' : 'add-on'}>
                    <input
                      type="checkbox"
                      checked={addOnIds.includes(addOn.id)}
                      onChange={() => toggleAddOn(addOn)}
                    />
                    <span className="add-on-body">
                      <strong>{addOn.name}</strong>
                      <span>{addOn.description}</span>
                    </span>
                    <span className="add-on-price">+{formatMoney(addOn.priceMinor, catalog.currency)}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>You</h2>
              <div className="field-row">
                <Field label="Your name" error={fieldErrors.fanName} required>
                  <input
                    value={form.fanName}
                    onChange={(e) => update('fanName', e.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    required
                  />
                </Field>
                <Field
                  label="Email"
                  error={fieldErrors.fanEmail}
                  required
                  hint="Where the song and the invoice go."
                >
                  <input
                    type="email"
                    value={form.fanEmail}
                    onChange={(e) => update('fanEmail', e.target.value)}
                    maxLength={200}
                    autoComplete="email"
                    required
                  />
                </Field>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.sharePublicly}
                  onChange={(e) => update('sharePublicly', e.target.checked)}
                />
                <span>
                  I'm happy for this song to be shared publicly. Leave it unticked and it stays
                  between us.
                </span>
              </label>
            </section>

            <div className="summary">
              <div>
                <h3>{tier.name}</h3>
                <ul>
                  <li>{formatMoney(tier.priceMinor, catalog.currency)}</li>
                  {chosenAddOns.map((a) => (
                    <li key={a.id}>
                      {a.name} · {formatMoney(a.priceMinor, catalog.currency)}
                    </li>
                  ))}
                </ul>
                <p className="turnaround">Ready in about {turnaround} days</p>
              </div>
              <div className="summary-total">
                <span>Total</span>
                <strong>{formatMoney(total, catalog.currency)}</strong>
              </div>
            </div>

            {submitError && (
              <p className="notice error" role="alert">
                {submitError}
              </p>
            )}

            <button type="submit" className="primary large" disabled={submitting}>
              {submitting
                ? 'Sending…'
                : catalog.payment.chargeUpFront
                  ? `Send the brief and pay ${formatMoney(total, catalog.currency)}`
                  : 'Send the brief'}
            </button>
            <p className="fine-print">
              {catalog.payment.chargeUpFront
                ? 'Next step is Stripe’s secure checkout. Your card details never touch this site.'
                : `Sending this doesn't charge you. I'll read it, come back to you, and only then send ${
                    catalog.payment.provider === 'stripe' ? 'a payment link' : 'an invoice'
                  }.`}
            </p>
          </form>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">
        {label}
        {required && <em aria-hidden="true"> *</em>}
      </span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function ConfirmationPanel({
  confirmation,
  onAnother,
}: {
  confirmation: Confirmation;
  onAnother: () => void;
}) {
  const { request, payment } = confirmation;
  return (
    <section className="panel confirmation">
      <h1>Brief received.</h1>
      <p className="reference">
        Your reference is <strong>{request.reference}</strong>
      </p>
      <p>
        {request.tier.name} · {formatMoney(request.amountMinor, request.currency)} · roughly{' '}
        {request.turnaroundDays} days once we start.
      </p>
      {payment.instructions && <p className="notice">{payment.instructions}</p>}

      {payment.checkoutUrl && (
        <div className="pay-now">
          {/* Deliberately a click, not an automatic redirect: the fan gets to
              write their reference down before they leave the site. */}
          <a className="primary large link-button" href={payment.checkoutUrl}>
            Pay {formatMoney(request.amountMinor, request.currency)} securely
          </a>
          <p className="fine-print">
            Payment is handled by Stripe. Your song joins the queue the moment it clears.
          </p>
        </div>
      )}

      <p>
        Keep that reference. You can check where the song's got to any time on the{' '}
        <a href="#/status">check a request</a> page with your reference and email.
      </p>
      <button type="button" className="secondary" onClick={onAnother}>
        Request another song
      </button>
    </section>
  );
}
