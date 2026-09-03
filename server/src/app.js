import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { loadCatalog, priceRequest } from './catalog.js';
import { createRequestStore, publicView } from './requests.js';
import { createRequestSchema, updateRequestSchema, STATUSES } from './schema.js';
import { getPaymentProvider } from './payments.js';
import { notifyNewRequest } from './notify.js';
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
  log = console,
  rateLimitMax = Number(process.env.REQUEST_RATE_LIMIT ?? 5),
} = {}) {
  const store = createRequestStore(db);
  const pay = getPaymentProvider();
  const app = express();

  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/catalog', (_req, res) => res.json(catalog));

  app.post('/api/requests', rateLimit({ max: rateLimitMax }), (req, res) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    let pricing;
    try {
      pricing = priceRequest(catalog, parsed.data.tierId, parsed.data.addOnIds);
    } catch (err) {
      return res.status(400).json({
        error: 'unknown_option',
        message: err.message,
      });
    }

    let record = store.create(parsed.data, pricing);
    const payment = pay({ pricing, request: record });
    if (payment.status !== record.paymentStatus) {
      record = store.update(record.id, { paymentStatus: payment.status });
    }

    notifyNewRequest(record, pricing, log);

    return res.status(201).json({ request: publicView(record, catalog), payment });
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

  app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const parsed = updateRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (!store.get(req.params.id)) {
      return res.status(404).json({ error: 'not_found', message: 'No such request.' });
    }
    return res.json({ request: store.update(req.params.id, parsed.data) });
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
