import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { loadCatalog } from '../src/catalog.js';
import { createMailer } from '../src/email.js';
import { createNotifier } from '../src/notifications.js';

const ADMIN_TOKEN = 'test-admin-token';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_email';
const silent = { info() {}, warn() {}, error() {} };

const brief = {
  tierId: 'acoustic',
  addOnIds: [],
  fanName: 'Ros',
  fanEmail: 'ros@example.com',
  subject: "My dad's allotment",
  brief: 'Forty years of runner beans, one shed, and a radio that only gets Radio 4 on a good day.',
};

/** Captures what would have been sent, and can be told to fail. */
function fakeMailer() {
  const sent = [];
  let failure = null;
  return {
    sent,
    name: 'fake',
    configured: true,
    failNext(err) {
      failure = err;
    },
    async send(message) {
      if (failure) {
        const err = failure;
        failure = null;
        throw err;
      }
      sent.push(message);
      return { ok: true };
    },
  };
}

const fakePayments = {
  name: 'stripe',
  chargeUpFront: false,
  supportsCheckout: true,
  async begin() {
    return {
      provider: 'stripe',
      status: 'unpaid',
      instructions: "I'll read this and come back to you.",
    };
  },
  async createCheckout() {
    return {
      provider: 'stripe',
      status: 'pending',
      checkoutUrl: CHECKOUT_URL,
      paymentRef: 'cs_email',
    };
  },
  verifyWebhook: (rawBody) => JSON.parse(rawBody),
  interpretEvent(event) {
    if (event.type !== 'checkout.session.completed') return null;
    return {
      match: { requestId: event.data.object.metadata.requestId },
      patch: { paymentStatus: 'paid', paymentRef: 'pi_email' },
    };
  },
};

describe('email notifications', () => {
  let mailer;
  let server;
  let db;
  let base;

  const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

  function start(env = {}) {
    const catalog = loadCatalog();
    mailer = fakeMailer();
    const notifier = createNotifier({
      mailer,
      catalog,
      log: silent,
      env: { ARTIST_EMAIL: 'artist@example.com', PUBLIC_URL: 'https://songs.example', ...env },
    });
    db = openDatabase(':memory:');
    return createApp({
      db,
      catalog,
      payments: fakePayments,
      notifier,
      mailer,
      log: silent,
      rateLimitMax: 1000,
    });
  }

  before(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  beforeEach(async () => {
    if (server) server.close();
    if (db) db.close();
    server = start().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    db.close();
  });

  const submit = (body = brief) =>
    fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const patch = (id, body) =>
    fetch(`${base}/api/admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(body),
    });

  async function idFor(reference) {
    const { items } = await (
      await fetch(`${base}/api/admin/requests?limit=200`, { headers: auth })
    ).json();
    return items.find((item) => item.reference === reference).id;
  }

  const to = (address) => mailer.sent.filter((message) => message.to === address);

  it('tells the artist and the fan when a brief arrives', async () => {
    const { request } = await (await submit()).json();

    assert.equal(mailer.sent.length, 2);

    const [artist] = to('artist@example.com');
    assert.match(artist.subject, /My dad's allotment/);
    assert.match(artist.subject, new RegExp(request.reference));
    assert.match(artist.text, /Forty years of runner beans/, 'the brief itself is in the email');
    assert.match(artist.text, /ros@example\.com/);

    const [fan] = to('ros@example.com');
    assert.match(fan.subject, new RegExp(request.reference));
    assert.match(fan.text, /I'll read this and come back to you/, 'the payment promise is repeated');
    assert.match(fan.text, /https:\/\/songs\.example\/#\/status\?ref=SR-/);
    assert.ok(fan.html.includes('<div'), 'both plain text and HTML parts are sent');
  });

  it('emails the payment link to the fan when the song is taken on', async () => {
    const { request } = await (await submit()).json();
    const id = await idFor(request.reference);
    mailer.sent.length = 0;

    const res = await fetch(`${base}/api/admin/requests/${id}/checkout`, {
      method: 'POST',
      headers: auth,
    });
    const body = await res.json();

    assert.equal(body.emailed, true);
    assert.equal(mailer.sent.length, 1);
    const [fan] = to('ros@example.com');
    assert.match(fan.subject, /payment link/i);
    assert.ok(fan.text.includes(CHECKOUT_URL), 'the link is in the plain text part too');
  });

  it('tells the artist when a payment clears', async () => {
    const { request } = await (await submit()).json();
    const id = await idFor(request.reference);
    mailer.sent.length = 0;

    await fetch(`${base}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'test' },
      body: JSON.stringify({
        id: 'evt_email',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'paid', metadata: { requestId: id } } },
      }),
    });

    const [artist] = to('artist@example.com');
    assert.match(artist.subject, /^Paid:/);
    assert.match(artist.text, /£150/);
  });

  it('sends the song once it is both delivered and linked, and only once', async () => {
    const { request } = await (await submit()).json();
    const id = await idFor(request.reference);
    mailer.sent.length = 0;

    // Marked delivered with nowhere to listen yet - nothing should go out.
    await patch(id, { status: 'delivered' });
    assert.equal(mailer.sent.length, 0, 'no email until there is something to listen to');

    const withLink = await (await patch(id, { deliveryUrl: 'https://example.com/song.mp3' })).json();
    assert.equal(mailer.sent.length, 1);
    assert.ok(withLink.request.deliveredEmailAt, 'the send is stamped on the record');
    const [fan] = to('ros@example.com');
    assert.match(fan.subject, /ready/i);
    assert.ok(fan.text.includes('https://example.com/song.mp3'));

    // Editing the request afterwards must not send the song twice.
    await patch(id, { artistNotes: 'Mastered a touch louder' });
    await patch(id, { status: 'delivered' });
    assert.equal(mailer.sent.length, 1, 'later edits do not resend');
  });

  it('does not resend when a delivered song is re-linked', async () => {
    const { request } = await (await submit()).json();
    const id = await idFor(request.reference);
    await patch(id, { status: 'delivered', deliveryUrl: 'https://example.com/one.mp3' });
    mailer.sent.length = 0;

    await patch(id, { deliveryUrl: 'https://example.com/two.mp3' });
    assert.equal(mailer.sent.length, 0);
  });

  it('takes the brief even when the mail server is down', async () => {
    mailer.failNext(new Error('SMTP timed out'));

    const res = await submit();
    assert.equal(res.status, 201, 'a mail failure never costs a fan their brief');

    const body = await res.json();
    assert.match(body.request.reference, /^SR-/);
    assert.equal(mailer.sent.length, 1, 'the other recipient still got theirs');
  });

  it('carries on when no artist address is configured', async () => {
    server.close();
    db.close();
    server = start({ ARTIST_EMAIL: undefined }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    const res = await submit();
    assert.equal(res.status, 201);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'ros@example.com');
  });
});

describe('mailer configuration', () => {
  it('logs instead of sending when no SMTP_URL is set', async () => {
    const lines = [];
    const mailer = createMailer({}, { info: (line) => lines.push(line) });

    assert.equal(mailer.name, 'log');
    assert.equal(mailer.configured, false);
    await mailer.send({ to: 'someone@example.com', subject: 'Test', text: 'Hello' });
    assert.match(lines[0], /someone@example\.com/);
  });

  it('builds an SMTP transport when one is configured', () => {
    const mailer = createMailer({ SMTP_URL: 'smtps://user:pass@smtp.example.com:465' });
    assert.equal(mailer.name, 'smtp');
    assert.equal(mailer.configured, true);
  });
});
