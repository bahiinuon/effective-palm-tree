import { formatMoney } from './catalog.js';

/**
 * Payment is deliberately a seam rather than a hard dependency.
 *
 * The default `manual` provider records the request as unpaid and tells the fan
 * an invoice is coming - enough to take real requests on day one. To add a
 * hosted checkout, implement a provider here (create the session, return its
 * URL) and mark the request paid from that provider's webhook. Nothing else in
 * the app needs to change: totals are already computed server-side in
 * catalog.js, and `paymentStatus` already gates delivery in the admin view.
 */
const providers = {
  manual({ pricing, request }) {
    return {
      provider: 'manual',
      status: 'unpaid',
      instructions:
        `I'll email an invoice for ${formatMoney(pricing.amountMinor, pricing.currency)} to ` +
        `${request.fanEmail} within 24 hours. Nothing is charged until you've heard back from me ` +
        `and we both agree the brief works.`,
    };
  },
};

export function getPaymentProvider(name = process.env.PAYMENT_PROVIDER || 'manual') {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown PAYMENT_PROVIDER "${name}". Available: ${Object.keys(providers).join(', ')}.`,
    );
  }
  return provider;
}
