import Stripe from 'stripe';
import { formatMoney } from './catalog.js';

/**
 * Payment providers all look the same to the rest of the app:
 *
 *   begin(ctx)            -> what to tell the fan when a brief arrives
 *   createCheckout(ctx)   -> a hosted checkout URL for an existing request
 *   verifyWebhook(...)    -> a trusted event, or a throw
 *   interpretEvent(event) -> { match, patch } the route applies, or null
 *
 * `manual` keeps money out of the app entirely: the request is recorded unpaid
 * and you invoice off your own bat. `stripe` runs Stripe Checkout, either at
 * submission or later from the queue (STRIPE_CHARGE_AT).
 */
export function createPaymentProvider(env = process.env) {
  const name = env.PAYMENT_PROVIDER || 'manual';
  if (name === 'manual') return manualProvider();
  if (name === 'stripe') return stripeProvider(env);
  throw new Error(`Unknown PAYMENT_PROVIDER "${name}". Available: manual, stripe.`);
}

function manualProvider() {
  return {
    name: 'manual',
    chargeUpFront: false,
    supportsCheckout: false,

    async begin({ pricing, request }) {
      return {
        provider: 'manual',
        status: 'unpaid',
        instructions:
          `I'll email an invoice for ${formatMoney(pricing.amountMinor, pricing.currency)} to ` +
          `${request.fanEmail} within 24 hours. Nothing is charged until you've heard back from me ` +
          `and we both agree the brief works.`,
      };
    },

    async createCheckout() {
      throw new Error('Manual payments have no checkout link - send an invoice instead.');
    },
  };
}

function stripeProvider(env) {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY. Find it in the Stripe dashboard ' +
        'under Developers > API keys (use the test key until you are ready to take money).',
    );
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const publicUrl = (env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');
  // Default is 'accept': a brief arrives free, and a payment link goes out once
  // the artist has read it and said yes. 'submit' takes the card up front.
  const chargeUpFront = (env.STRIPE_CHARGE_AT || 'accept') === 'submit';

  // STRIPE_API_BASE exists so the test suite can point the SDK at a local stub.
  const options = {};
  if (env.STRIPE_API_BASE) {
    const base = new URL(env.STRIPE_API_BASE);
    options.host = base.hostname;
    options.port = Number(base.port);
    options.protocol = base.protocol.replace(':', '');
  }
  const stripe = new Stripe(secretKey, options);

  /**
   * The session charges the total stored on the request, not a fresh lookup:
   * if prices in the catalog change between order and payment, the fan pays
   * what they agreed to.
   */
  async function createCheckout({ request, describe }) {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: request.fanEmail,
        client_reference_id: request.reference,
        metadata: { requestId: request.id, reference: request.reference },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: request.currency.toLowerCase(),
              unit_amount: request.amountMinor,
              product_data: {
                name: describe.name,
                description: `${describe.detail} (ref ${request.reference})`,
              },
            },
          },
        ],
        success_url: `${publicUrl}/#/status?ref=${request.reference}&paid=1`,
        cancel_url: `${publicUrl}/#/status?ref=${request.reference}`,
      },
      // Retrying a submission must not create a second charge for the same song.
      { idempotencyKey: `checkout:${request.id}` },
    );

    return {
      provider: 'stripe',
      status: 'pending',
      checkoutUrl: session.url,
      paymentRef: session.id,
    };
  }

  return {
    name: 'stripe',
    chargeUpFront,
    supportsCheckout: true,
    createCheckout,

    async begin(ctx) {
      if (!chargeUpFront) {
        return {
          provider: 'stripe',
          status: 'unpaid',
          instructions:
            `I'll read this and come back to you. If I can take it on, you'll get a payment link ` +
            `for ${formatMoney(ctx.pricing.amountMinor, ctx.pricing.currency)} - nothing is ` +
            `charged before then.`,
        };
      }
      const checkout = await createCheckout(ctx);
      return {
        ...checkout,
        instructions: `Your brief is safe with me. It joins the queue once payment goes through.`,
      };
    },

    verifyWebhook(rawBody, signature) {
      if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not set, so webhooks cannot be trusted.');
      }
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },

    interpretEvent(event) {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.payment_status !== 'paid') return null;
          return {
            match: { requestId: session.metadata?.requestId, reference: session.client_reference_id },
            patch: { paymentStatus: 'paid', paymentRef: session.payment_intent ?? session.id },
          };
        }
        case 'checkout.session.expired': {
          const session = event.data.object;
          return {
            match: { requestId: session.metadata?.requestId, reference: session.client_reference_id },
            patch: { paymentStatus: 'unpaid' },
          };
        }
        case 'charge.refunded': {
          const charge = event.data.object;
          return {
            match: { paymentRef: charge.payment_intent },
            patch: { paymentStatus: 'refunded' },
          };
        }
        default:
          return null;
      }
    },
  };
}
