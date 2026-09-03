import 'dotenv/config';
import { createApp } from './app.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const db = openDatabase();
const app = createApp({ db });

const server = app.listen(port, () => {
  console.info(`[server] listening on http://localhost:${port}`);
  if (!process.env.ADMIN_TOKEN) {
    console.warn('[server] ADMIN_TOKEN is not set - the admin API and dashboard are disabled.');
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
