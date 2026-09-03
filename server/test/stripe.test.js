import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createPaymentProvider } from '../src/payments.js';

const WEBHOOK_SECRET = 'whsec_test_secret';
const silent = { info() {}, warn() {}, error() {} };

const brief = {
  tierId: 'ditty',
  addOnIds: [],
  fanName: 'Sam',
  fanEmail: 'sam@example.com',
  subject: 'A song for my dog Biscuit',
  brief: 'He is fourteen, deaf as a post, and still steals socks off the radiator every morning.',
};

/** Stands in for api.stripe.com so the suite never touches the network. */
function startStripeStub() {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      calls.push({ url: req.url, body, idempotencyKey: req.headers['idempotency-key'] });
      const params = new URLSearchParams(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cs_test_123',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
          amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
          currency: params.get('line_items[0][price_data][currency]'),
        }),
      );
    });
  });
  return { server, calls };
}

/** Signs a payload the way Stripe does, so constructEvent accepts it. */
function stripeSignature(payload, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('stripe checkout', () => {
  let stub;
  let app;
  let db;
  let base;

  before(async () => {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    stub = startStripeStub();
    await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
    const stripePort = stub.server.address().port;

    const payments = createPaymentProvider({
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_key',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: `http://127.0.0.1:${stripePort}`,
      PUBLIC_URL: 'https://songs.example',
    });

    db = openDatabase(':memory:');
    app = createApp({ db, payments, log: silent, rateLimitMax: 1000 }).listen(0);
    await new Promise((resolve) => app.once('listening', resolve));
    base = `http://127.0.0.1:${app.address().port}`;
  });

  after(() => {
    app.close();
    stub.server.close();
    db.close();
  });

  const submit = (body = brief) =>
    fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const sendWebhook = (event, signature) =>
    fetch(`${base}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body: event,
    });

  it('advertises stripe and up-front charging in the catalog', async () => {
    const body = await (await fetch(`${base}/api/catalog`)).json();
    assert.deepEqual(body.payment, { provider: 'stripe', chargeUpFront: true });
  });

  it('returns a checkout URL and holds the request as pending', async () => {
    const res = await submit();
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.payment.provider, 'stripe');
    assert.equal(body.payment.status, 'pending');
    assert.equal(body.payment.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_123');
    assert.equal(body.request.paymentStatus, 'pending');

    const call = stub.calls.at(-1);
    assert.equal(call.url, '/v1/checkout/sessions');
    const sent = new URLSearchParams(call.body);
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '4500');
    assert.equal(sent.get('line_items[0][price_data][currency]'), 'gbp');
    assert.equal(sent.get('customer_email'), 'sam@example.com');
    assert.equal(sent.get('client_reference_id'), body.request.reference);
    assert.match(sent.get('success_url'), /^https:\/\/songs\.example\/#\/status\?ref=SR-/);
    assert.ok(call.idempotencyKey, 'a retry must not create a second charge');
  });

  it('marks the request paid when the signed completion event arrives', async () => {
    const created = await (await submit()).json();
    const id = await requestIdFor(created.request.reference);

    const event = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          payment_intent: 'pi_test_999',
          client_reference_id: created.request.reference,
          metadata: { requestId: id, reference: created.request.reference },
        },
      },
    });

    const res = await sendWebhook(event, stripeSignature(event));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, applied: true });

    const record = await adminGet(id);
    assert.equal(record.paymentStatus, 'paid');
    assert.equal(record.paymentRef, 'pi_test_999', 'the payment intent is kept for refunds');

    // A late expiry event must not undo a completed payment.
    const stale = JSON.stringify({
      id: 'evt_2',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_123', metadata: { requestId: id } } },
    });
    const staleRes = await sendWebhook(stale, stripeSignature(stale));
    assert.deepEqual(await staleRes.json(), { received: true, applied: false });
    assert.equal((await adminGet(id)).paymentStatus, 'paid');
  });

  it('refuses an unsigned or wrongly signed event', async () => {
    const event = JSON.stringify({
      id: 'evt_3',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', metadata: {} } },
    });

    assert.equal((await sendWebhook(event, '')).status, 400);
    assert.equal((await sendWebhook(event, stripeSignature(event, 'whsec_wrong'))).status, 400);
  });

  it('ignores event types it has no opinion about', async () => {
    const event = JSON.stringify({ id: 'evt_4', type: 'invoice.paid', data: { object: {} } });
    const res = await sendWebhook(event, stripeSignature(event));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, applied: false });
  });

  it('records a refund against the payment intent', async () => {
    const created = await (await submit()).json();
    const id = await requestIdFor(created.request.reference);

    const paid = JSON.stringify({
      id: 'evt_5',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_refund_me',
          metadata: { requestId: id },
        },
      },
    });
    await sendWebhook(paid, stripeSignature(paid));

    const refund = JSON.stringify({
      id: 'evt_6',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_refund_me' } },
    });
    const res = await sendWebhook(refund, stripeSignature(refund));
    assert.deepEqual(await res.json(), { received: true, applied: true });
    assert.equal((await adminGet(id)).paymentStatus, 'refunded');
  });

  it('mints a payment link from the queue for a request taken on later', async () => {
    const created = await (await submit()).json();
    const id = await requestIdFor(created.request.reference);

    const res = await fetch(`${base}/api/admin/requests/${id}/checkout`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_123');
    assert.equal(body.request.paymentStatus, 'pending');
    assert.equal(body.request.paymentRef, 'cs_test_123');
  });

  it('will not mint a link for something already paid', async () => {
    const created = await (await submit()).json();
    const id = await requestIdFor(created.request.reference);

    const paid = JSON.stringify({
      id: 'evt_7',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', payment_intent: 'pi_done', metadata: { requestId: id } } },
    });
    await sendWebhook(paid, stripeSignature(paid));

    const res = await fetch(`${base}/api/admin/requests/${id}/checkout`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'already_paid');
  });

  async function adminGet(id) {
    const res = await fetch(`${base}/api/admin/requests/${id}`, {
      headers: { authorization: 'Bearer test-admin-token' },
    });
    return (await res.json()).request;
  }

  async function requestIdFor(reference) {
    const res = await fetch(`${base}/api/admin/requests?limit=200`, {
      headers: { authorization: 'Bearer test-admin-token' },
    });
    const { items } = await res.json();
    return items.find((item) => item.reference === reference).id;
  }
});

describe('payment provider configuration', () => {
  it('refuses to start on stripe without a secret key', () => {
    assert.throws(
      () => createPaymentProvider({ PAYMENT_PROVIDER: 'stripe' }),
      /STRIPE_SECRET_KEY/,
    );
  });

  it('refuses an unknown provider name', () => {
    assert.throws(() => createPaymentProvider({ PAYMENT_PROVIDER: 'cash' }), /Unknown/);
  });

  it('holds off charging when STRIPE_CHARGE_AT is accept', async () => {
    const provider = createPaymentProvider({
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_key',
      STRIPE_CHARGE_AT: 'accept',
    });
    assert.equal(provider.chargeUpFront, false);

    const outcome = await provider.begin({
      pricing: { amountMinor: 15000, currency: 'GBP' },
      request: { fanEmail: 'sam@example.com' },
    });
    assert.equal(outcome.status, 'unpaid', 'no card is touched until the brief is accepted');
    assert.match(outcome.instructions, /£150/);
  });
});
