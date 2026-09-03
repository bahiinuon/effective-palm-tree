import { formatMoney } from './catalog.js';

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/** Plain text is the source of truth; the HTML part is the same words, laid out. */
function html(paragraphs) {
  const body = paragraphs
    .map((p) =>
      p.startsWith('<') ? p : `<p style="margin:0 0 1em">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n');
  return (
    '<div style="font-family:ui-sans-serif,system-ui,Helvetica,Arial,sans-serif;' +
    'font-size:15px;line-height:1.6;color:#1c1917;max-width:34em">\n' +
    `${body}\n</div>`
  );
}

function button(label, url) {
  return (
    `<p style="margin:1.5em 0"><a href="${escapeHtml(url)}" ` +
    'style="background:#b8792c;color:#fff;text-decoration:none;padding:12px 22px;' +
    `border-radius:999px;display:inline-block">${escapeHtml(label)}</a></p>`
  );
}

export function createTemplates({ artistName = '', publicUrl = '', tierName = (id) => id } = {}) {
  const signOff = artistName ? `\n\n- ${artistName}` : '';
  const statusUrl = (record) => `${publicUrl}/#/status?ref=${record.reference}`;

  return {
    /** To the artist: a brief just landed. */
    artistNewBrief(record) {
      const lines = [
        `${record.fanName} <${record.fanEmail}> has asked for a song.`,
        `${tierName(record.tierId)} - ${formatMoney(record.amountMinor, record.currency)} - ${record.reference}`,
        `Subject: ${record.subject}`,
        record.neededBy ? `Needed by: ${record.neededBy}` : null,
        `\n${record.brief}`,
        `Open the queue: ${publicUrl}/#/admin`,
      ].filter(Boolean);

      return {
        subject: `New song request: ${record.subject} (${record.reference})`,
        text: lines.join('\n'),
        html: html(lines),
      };
    },

    /** To the fan: we have it, here's your reference. */
    fanBriefReceived(record, instructions) {
      const lines = [
        `Hi ${record.fanName},`,
        `Thanks - I've got your brief for "${record.subject}".`,
        `Your reference is ${record.reference}. Keep hold of it: it's how you check on the song.`,
        `${tierName(record.tierId)} - ${formatMoney(record.amountMinor, record.currency)} - roughly ${record.turnaroundDays} days once we start.`,
        instructions,
        `Check on it any time: ${statusUrl(record)}${signOff}`,
      ].filter(Boolean);

      return {
        subject: `I've got your song brief (${record.reference})`,
        text: lines.join('\n\n'),
        html: html(lines),
      };
    },

    /** To the fan: the brief is accepted, here's how to pay. */
    fanPaymentLink(record, checkoutUrl) {
      const lines = [
        `Hi ${record.fanName},`,
        `Good news - I'd love to write "${record.subject}".`,
        `It's ${formatMoney(record.amountMinor, record.currency)} for the ${tierName(record.tierId)}, and I'll start as soon as it's paid. Payment is handled by Stripe; the link below is just for you.`,
        button('Pay securely', checkoutUrl),
        `If the button doesn't work, paste this in: ${checkoutUrl}`,
        `Reference ${record.reference}${signOff}`,
      ];

      return {
        subject: `Your song is a yes - here's the payment link (${record.reference})`,
        text: lines.filter((line) => !line.startsWith('<')).join('\n\n'),
        html: html(lines),
      };
    },

    /** To the artist: money landed, start writing. */
    artistPaymentReceived(record) {
      const lines = [
        `${record.reference} is paid: ${formatMoney(record.amountMinor, record.currency)} from ${record.fanName}.`,
        `"${record.subject}" - ${tierName(record.tierId)}, due in about ${record.turnaroundDays} days.`,
        `Open the queue: ${publicUrl}/#/admin`,
      ];

      return {
        subject: `Paid: ${record.subject} (${record.reference})`,
        text: lines.join('\n'),
        html: html(lines),
      };
    },

    /** To the fan: it's finished. */
    fanSongDelivered(record) {
      const lines = [
        `Hi ${record.fanName},`,
        `Your song is done. Here it is:`,
        button('Listen to your song', record.deliveryUrl),
        `Direct link: ${record.deliveryUrl}`,
        `I hope it lands the way you wanted it to. Tell me what you think.${signOff}`,
      ];

      return {
        subject: `Your song is ready (${record.reference})`,
        text: lines.filter((line) => !line.startsWith('<')).join('\n\n'),
        html: html(lines),
      };
    },
  };
}
