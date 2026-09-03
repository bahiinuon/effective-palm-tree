import { formatMoney } from './catalog.js';
import { createTemplates } from './email-templates.js';

/**
 * Everything that tells a human something happened.
 *
 * Sending is always best-effort: a mail server having a bad day must never turn
 * a fan's request into an error, or roll back a payment we've already recorded.
 * Failures are logged loudly and the work carries on.
 */
export function createNotifier({ mailer, catalog, env = process.env, log = console } = {}) {
  const artistEmail = env.ARTIST_EMAIL;
  const templates = createTemplates({
    artistName: env.ARTIST_NAME,
    publicUrl: (env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, ''),
    tierName: (id) => catalog.tiers.find((tier) => tier.id === id)?.name ?? id,
  });

  async function deliver(to, message, what) {
    if (!to) {
      log.warn(`[email] no address for ${what} - set ARTIST_EMAIL to receive these`);
      return false;
    }
    try {
      await mailer.send({ to, ...message });
      log.info(`[email] sent ${what} to ${to}`);
      return true;
    } catch (err) {
      log.error(`[email] could not send ${what} to ${to}:`, err);
      return false;
    }
  }

  return {
    async briefReceived(record, pricing, payment) {
      log.info(
        `[request] ${record.reference} - ${pricing.tier.name} - ` +
          `${formatMoney(record.amountMinor, record.currency)} - ` +
          `${record.fanName} <${record.fanEmail}> - "${record.subject}"`,
      );

      await Promise.all([
        deliver(artistEmail, templates.artistNewBrief(record), `new brief ${record.reference}`),
        deliver(
          record.fanEmail,
          templates.fanBriefReceived(record, payment?.instructions),
          `receipt for ${record.reference}`,
        ),
      ]);
    },

    async paymentLinkReady(record, checkoutUrl) {
      return deliver(
        record.fanEmail,
        templates.fanPaymentLink(record, checkoutUrl),
        `payment link for ${record.reference}`,
      );
    },

    async paymentReceived(record) {
      return deliver(
        artistEmail,
        templates.artistPaymentReceived(record),
        `payment notice for ${record.reference}`,
      );
    },

    async songDelivered(record) {
      return deliver(
        record.fanEmail,
        templates.fanSongDelivered(record),
        `delivery of ${record.reference}`,
      );
    },
  };
}
