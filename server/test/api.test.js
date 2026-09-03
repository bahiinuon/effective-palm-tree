import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { loadCatalog, priceRequest } from '../src/catalog.js';

const ADMIN_TOKEN = 'test-admin-token';
const silent = { info() {}, warn() {}, error() {} };

const validBody = {
  tierId: 'acoustic',
  addOnIds: [],
  fanName: 'Jo Fan',
  fanEmail: 'jo@example.com',
  subject: "My gran's 90th birthday",
  brief: 'She grew up in Cork, ran a bakery for forty years, and still swims in the sea every week.',
  sharePublicly: true,
};

describe('song request API', () => {
  let server;
  let base;
  let db;

  before(async () => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    db = openDatabase(':memory:');
    server = createApp({ db, log: silent, rateLimitMax: 1000 }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    db.close();
  });

  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('serves the catalog with all three tiers in order', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(
      body.tiers.map((t) => t.id),
      ['ditty', 'acoustic', 'produced'],
    );
    assert.equal(body.currency, 'GBP');
  });

  it('accepts a well-formed request and returns a reference', async () => {
    const res = await post('/api/requests', validBody);
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.match(body.request.reference, /^SR-[A-Z2-9]{6}$/);
    assert.equal(body.request.status, 'new');
    assert.equal(body.request.amountMinor, 15000);
    assert.equal(body.request.turnaroundDays, 14);
    assert.equal(body.payment.provider, 'manual');
  });

  it('prices add-ons server-side and ignores any total the client sends', async () => {
    const res = await post('/api/requests', {
      ...validBody,
      tierId: 'ditty',
      addOnIds: ['rush', 'video'],
      amountMinor: 1,
      currency: 'ZWL',
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.request.amountMinor, 4500 + 7500 + 9500);
    assert.equal(body.request.currency, 'GBP');
    assert.equal(body.request.turnaroundDays, 4, 'rush halves the 7-day turnaround');
  });

  it('rejects a thin brief, a bad email and an unknown tier', async () => {
    const thin = await post('/api/requests', { ...validBody, brief: 'a song plz' });
    assert.equal(thin.status, 400);
    assert.ok((await thin.json()).fields.some((f) => f.path === 'brief'));

    const email = await post('/api/requests', { ...validBody, fanEmail: 'nope' });
    assert.equal(email.status, 400);

    const tier = await post('/api/requests', { ...validBody, tierId: 'platinum' });
    assert.equal(tier.status, 400);
    assert.equal((await tier.json()).error, 'unknown_option');
  });

  it('lets a fan check status with reference plus email, and nobody else', async () => {
    const created = await (await post('/api/requests', validBody)).json();
    const ref = created.request.reference;

    const ok = await fetch(`${base}/api/requests/${ref}?email=${encodeURIComponent(validBody.fanEmail)}`);
    assert.equal(ok.status, 200);
    const seen = (await ok.json()).request;
    assert.equal(seen.reference, ref);
    assert.equal(seen.brief, undefined, 'the public view never echoes the brief back');

    const wrongEmail = await fetch(`${base}/api/requests/${ref}?email=someone@else.com`);
    assert.equal(wrongEmail.status, 404);

    const noEmail = await fetch(`${base}/api/requests/${ref}`);
    assert.equal(noEmail.status, 404);
  });

  it('keeps the admin API behind the token', async () => {
    const anon = await fetch(`${base}/api/admin/requests`);
    assert.equal(anon.status, 401);

    const wrong = await fetch(`${base}/api/admin/requests`, {
      headers: { authorization: 'Bearer nope' },
    });
    assert.equal(wrong.status, 401);
  });

  it('lists, filters and updates requests for the artist', async () => {
    const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const list = await (await fetch(`${base}/api/admin/requests`, { headers: auth })).json();
    assert.ok(list.total >= 3);
    assert.ok(list.items[0].brief, 'the artist does see the brief');
    assert.equal(list.counts.new, list.total);

    const id = list.items[0].id;
    const patched = await fetch(`${base}/api/admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        status: 'writing',
        paymentStatus: 'paid',
        deliveryUrl: 'https://example.com/rough-mix.mp3',
      }),
    });
    assert.equal(patched.status, 200);
    const record = (await patched.json()).request;
    assert.equal(record.status, 'writing');
    assert.equal(record.paymentStatus, 'paid');

    const filtered = await (
      await fetch(`${base}/api/admin/requests?status=writing`, { headers: auth })
    ).json();
    assert.equal(filtered.total, 1);

    const badStatus = await fetch(`${base}/api/admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ status: 'vibing' }),
    });
    assert.equal(badStatus.status, 400);
  });

  it('rate-limits a flood of requests from one address', async () => {
    const limitedDb = openDatabase(':memory:');
    const limited = createApp({ db: limitedDb, log: silent, rateLimitMax: 3 }).listen(0);
    await new Promise((resolve) => limited.once('listening', resolve));
    const url = `http://127.0.0.1:${limited.address().port}/api/requests`;

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      statuses.push(res.status);
    }
    limited.close();
    limitedDb.close();

    assert.deepEqual(statuses, [201, 201, 201, 429]);
  });
});

describe('catalog pricing', () => {
  const catalog = loadCatalog();

  it('never lets an unknown add-on through', () => {
    assert.throws(() => priceRequest(catalog, 'ditty', ['free_please']), /Unknown add-on/);
  });

  it('charges a duplicated add-on once', () => {
    const once = priceRequest(catalog, 'produced', ['video']);
    const twice = priceRequest(catalog, 'produced', ['video', 'video']);
    assert.equal(twice.amountMinor, once.amountMinor);
  });
});
