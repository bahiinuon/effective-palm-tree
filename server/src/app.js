import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { loadCatalog, priceRequest } from './catalog.js';
import { createRequestStore, publicView } from './requests.js';
import { createRequestSchema, updateRequestSchema, STATUSES } from './schema.js';
import { createPaymentProvider } from './payments.js';
import { createMailer } from './email.js';
import { createNotifier } from './notifications.js';
import { rateLimit } from './rate-limit.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

function validationError(res, err) {
  return res.status(400).json({
    error: 'invalid_request',
    message: 'Some of those answers need another look.',
    fields: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

/** Admin routes are closed unless an ADMIN_TOKEN is configured - never open by default. */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: 'admin_disabled',
      message: 'Set ADMIN_TOKEN in the server environment to use the admin API.',
    });
  }
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== expected) {
    return res.status(401).json({ error: 'unauthorized', message: 'Bad or missing admin token.' });
  }
  return next();
}

export function createApp({
  db,
  catalog = loadCatalog(),
  payments = createPaymentProvider(),
  log = console,
  mailer = createMailer(process.env, log),
  notifier = createNotifier({ mailer, catalog, log }),
  rateLimitMax = Number(process.env.REQUEST_RATE_LIMIT ?? 5),
} = {}) {
  const store = createRequestStore(db);
  const app = express();

  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  /**
   * Stripe signs the exact bytes it sent, so this route has to see the raw body.
   * It is registered before the JSON parser for that reason - do not move it.
   */
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    if (payments.name !== 'stripe') {
      return res.status(404).json({ error: 'not_found', message: 'Stripe is not enabled.' });
    }

    let event;
    try {
      event = payments.verifyWebhook(req.body, req.get('stripe-signature') ?? '');
    } catch (err) {
      log.warn('[stripe] rejected webhook:', err.message);
      return res.status(400).json({ error: 'bad_signature', message: 'Could not verify that event.' });
    }

    const outcome = payments.interpretEvent(event);
    if (!outcome) return res.json({ received: true, applied: false });

    const record =
      (outcome.match.requestId && store.get(outcome.match.requestId)) ||
      (outcome.match.reference && store.getByReference(outcome.match.reference)) ||
      null;

    if (!record) {
      log.warn(`[stripe] ${event.type} did not match any request`);
      return res.json({ received: true, applied: false });
    }

    // Events can arrive late or out of order; a stale one must never undo a payment.
    if (outcome.patch.paymentStatus === 'unpaid' && record.paymentStatus !== 'pending') {
      return res.json({ received: true, applied: false });
    }

    const updated = store.update(record.id, outcome.patch);
    log.info(`[stripe] ${event.type} -> ${record.reference} is ${outcome.patch.paymentStatus}`);

    if (outcome.patch.paymentStatus === 'paid') await notifier.paymentReceived(updated);

    return res.json({ received: true, applied: true });
  });

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/catalog', (_req, res) =>
    res.json({
      ...catalog,
      payment: { provider: payments.name, chargeUpFront: payments.chargeUpFront },
    }),
  );

  /** How a line on a Stripe receipt should read for this request. */
  function describe(record) {
    const tier = catalog.tiers.find((t) => t.id === record.tierId);
    const addOns = record.addOnIds
      .map((id) => catalog.addOns.find((a) => a.id === id)?.name ?? id)
      .join(', ');
    return {
      name: tier ? `${tier.name} - custom song` : 'Custom song',
      detail: addOns ? `With ${addOns}` : 'Written to your brief',
    };
  }

  app.post('/api/requests', rateLimit({ max: rateLimitMax }), async (req, res, next) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    let pricing;
    try {
      pricing = priceRequest(catalog, parsed.data.tierId, parsed.data.addOnIds);
    } catch (err) {
      return res.status(400).json({ error: 'unknown_option', message: err.message });
    }

    try {
      let record = store.create(parsed.data, pricing);

      let payment;
      try {
        payment = await payments.begin({ pricing, request: record, describe: describe(record) });
      } catch (err) {
        // The brief is already saved - losing it because a card processor blinked
        // would be the worse failure, so fall back to invoicing by hand.
        log.error('[payment] could not start checkout:', err);
        payment = {
          provider: payments.name,
          status: 'unpaid',
          instructions:
            "I've got your brief, but the payment page didn't load. Nothing has been charged - " +
            "I'll email you a payment link instead.",
        };
      }

      const patch = { paymentStatus: payment.status };
      if (payment.paymentRef) patch.paymentRef = payment.paymentRef;
      record = store.update(record.id, patch);

      await notifier.briefReceived(record, pricing, payment);

      return res.status(201).json({ request: publicView(record, catalog), payment });
    } catch (err) {
      // Express 4 does not catch rejected promises from async handlers.
      return next(err);
    }
  });

  // A fan checks on their own song with the reference plus the email they used.
  app.get('/api/requests/:reference', (req, res) => {
    const email = z.string().email().safeParse(String(req.query.email ?? ''));
    const record = store.getByReference(req.params.reference.trim().toUpperCase());

    if (!email.success || !record || record.fanEmail.toLowerCase() !== email.data.toLowerCase()) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No request found for that reference and email address.',
      });
    }
    return res.json({ request: publicView(record, catalog) });
  });

  const listQuerySchema = z.object({
    status: z.enum(STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get('/api/admin/requests', requireAdmin, (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error);
    return res.json({ ...store.list(parsed.data), counts: store.countsByStatus() });
  });

  app.get('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'not_found', message: 'No such request.' });
    return res.json({ request: record });
  });

  app.patch('/api/admin/requests/:id', requireAdmin, async (req, res, next) => {
    const parsed = updateRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (!store.get(req.params.id)) {
      return res.status(404).json({ error: 'not_found', message: 'No such request.' });
    }

    try {
      let record = store.update(req.params.id, parsed.data);

      // The song goes out when it is both marked delivered and has a link -
      // in either order - and the stamp makes sure that happens exactly once.
      const readyToSend = record.status === 'delivered' && record.deliveryUrl;
      if (readyToSend && !record.deliveredEmailAt) {
        const sent = await notifier.songDelivered(record);
        if (sent) record = store.update(record.id, { deliveredEmailAt: new Date().toISOString() });
      }

      return res.json({ request: record });
    } catch (err) {
      return next(err);
    }
  });

  /** A payment link for a brief you've read and decided to take on. */
  app.post('/api/admin/requests/:id/checkout', requireAdmin, async (req, res, next) => {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'not_found', message: 'No such request.' });

    if (!payments.supportsCheckout) {
      return res.status(409).json({
        error: 'no_checkout',
        message: `The ${payments.name} payment provider has no checkout links.`,
      });
    }
    if (record.paymentStatus === 'paid') {
      return res.status(409).json({ error: 'already_paid', message: 'This one is already paid.' });
    }

    try {
      const checkout = await payments.createCheckout({ request: record, describe: describe(record) });
      const updated = store.update(record.id, {
        paymentStatus: checkout.status,
        paymentRef: checkout.paymentRef ?? null,
      });

      const emailed = await notifier.paymentLinkReady(updated, checkout.checkoutUrl);

      return res.json({ request: updated, checkoutUrl: checkout.checkoutUrl, emailed });
    } catch (err) {
      return next(err);
    }
  });

  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${webDist}/index.html`));
  }

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint.' }));

  app.use((err, _req, res, _next) => {
    log.error('[error]', err);
    res.status(500).json({ error: 'server_error', message: 'Something broke on my end.' });
  });

  return app;
}
