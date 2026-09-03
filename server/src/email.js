import nodemailer from 'nodemailer';

const SEND_TIMEOUT_MS = 10_000;

/**
 * Email, like payment, is optional infrastructure. With no SMTP_URL the app
 * still runs: messages are logged instead of sent, so nothing silently
 * disappears and nothing has to be configured just to develop against.
 */
export function createMailer(env = process.env, log = console) {
  const from = env.MAIL_FROM || 'Songs on request <no-reply@localhost>';
  const replyTo = env.MAIL_REPLY_TO || env.ARTIST_EMAIL || undefined;

  if (!env.SMTP_URL) {
    return {
      name: 'log',
      configured: false,
      async send(message) {
        log.info(`[email:log] to ${message.to} - ${message.subject}`);
        return { logged: true };
      },
    };
  }

  const transport = nodemailer.createTransport(env.SMTP_URL);

  return {
    name: 'smtp',
    configured: true,
    async send(message) {
      // A hung mail server must not hold a fan's browser open.
      return Promise.race([
        transport.sendMail({ from, replyTo, ...message }),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('SMTP timed out')), SEND_TIMEOUT_MS),
        ),
      ]);
    },
  };
}
