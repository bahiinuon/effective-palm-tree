import 'dotenv/config';
import { createApp } from './app.js';
import { createMailer } from './email.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const db = openDatabase();
const mailer = createMailer();
const app = createApp({ db, mailer });

const server = app.listen(port, () => {
  console.info(`[server] listening on http://localhost:${port}`);
  if (!process.env.ADMIN_TOKEN) {
    console.warn('[server] ADMIN_TOKEN is not set - the admin API and dashboard are disabled.');
  }
  if (!mailer.configured) {
    console.warn('[server] SMTP_URL is not set - emails will be logged, not sent.');
  } else if (!process.env.ARTIST_EMAIL) {
    console.warn('[server] ARTIST_EMAIL is not set - you will not be told about new requests.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
