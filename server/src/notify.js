import { formatMoney } from './catalog.js';

/**
 * Hook point for real notifications (email, Slack, a push to your phone).
 * Logging keeps the app dependency-free while still being useful in a terminal.
 */
export function notifyNewRequest(request, pricing, log = console) {
  log.info(
    `[request] ${request.reference} - ${pricing.tier.name} - ` +
      `${formatMoney(request.amountMinor, request.currency)} - ` +
      `${request.fanName} <${request.fanEmail}> - "${request.subject}"`,
  );
}
