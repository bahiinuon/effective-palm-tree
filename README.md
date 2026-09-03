# Songs on request

A small web app for taking custom song commissions from fans. Someone picks how
big a song they want, tells you the story behind it, and lands in a queue you
work through.

## The three tiers

| Tier | What it is | Default price | Turnaround |
| --- | --- | --- | --- |
| **The Ditty** | 30–60 second hook, voice and one instrument | £45 | 7 days |
| **Full Song, Acoustic** | Complete song, studio acoustic performance | £150 | 14 days |
| **Produced Track** | Arranged, produced, mixed and mastered | £400 | 28 days |

Plus optional add-ons: rush delivery (halves the turnaround), an extra revision
round, and a performance video.

Prices, copy, turnarounds and add-ons all live in
[`server/config/tiers.json`](server/config/tiers.json) — edit that file and
restart; no code change, no rebuild of the front end. The file is validated on
boot, so a typo fails loudly at startup rather than quietly at checkout.

## Running it

```bash
npm install
cp .env.example .env      # then set ADMIN_TOKEN
npm run dev               # API on :3001, site on :5173 with a proxy
```

For a single-process deployment:

```bash
npm run build             # builds the front end into web/dist
npm start                 # API + site on :3001
npm test                  # API test suite
```

## How it fits together

```
web/     Vite + React + TypeScript. Three screens, hash-routed:
           #/         commission form (tier picker → brief → confirmation)
           #/status   a fan checks their song with reference + email
           #/admin    your queue, behind the admin token
server/  Express + SQLite (better-sqlite3), no ORM.
           config/tiers.json   the catalog — prices and copy
           src/catalog.js      loads and validates it, prices a request
           src/requests.js     the order book
           src/app.js          routes, admin auth, static hosting
```

Requests land in one SQLite table. That file is your entire order book, so back
it up.

### API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/catalog` | anyone |
| `POST` | `/api/webhooks/stripe` | Stripe (signature checked) |
| `POST` | `/api/requests` | anyone (rate limited) |
| `GET` | `/api/requests/:reference?email=` | the fan who ordered it |
| `GET` | `/api/admin/requests?status=&limit=&offset=` | `Bearer $ADMIN_TOKEN` |
| `GET` | `/api/admin/requests/:id` | `Bearer $ADMIN_TOKEN` |
| `PATCH` | `/api/admin/requests/:id` | `Bearer $ADMIN_TOKEN` |
| `POST` | `/api/admin/requests/:id/checkout` | `Bearer $ADMIN_TOKEN` |

A request moves: `new → accepted → writing → delivered`, with `declined` and
`cancelled` as exits. Payment is tracked separately (`unpaid`/`pending`/`paid`)
so you can accept a brief before any money changes hands.

## Taking payment

Set `PAYMENT_PROVIDER=stripe` and the app runs Stripe Checkout. Card details
never touch this server — the fan goes to a page hosted by Stripe and comes
back to `#/status?ref=SR-XXXXXX`. Out of the box nobody is charged until you
have read their brief and said yes (see `STRIPE_CHARGE_AT` below).

1. Put your secret key in `STRIPE_SECRET_KEY` (`sk_test_…` until you're ready).
2. In the Stripe dashboard, add a webhook endpoint at
   `https://your-domain/api/webhooks/stripe` subscribed to
   `checkout.session.completed` and `checkout.session.expired`, and put its
   signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Set `PUBLIC_URL` to the site's real origin so Stripe can send fans back.

Locally you can forward events with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

`STRIPE_CHARGE_AT` decides when money is asked for:

- `accept` (default) — the brief arrives free and nothing is sent to Stripe. You
  read it, decide, and press **Create a payment link** in the queue. The fan is
  told up front that a link comes only if you take the song on.
- `submit` — the fan pays as they send the brief. The request sits at `pending`
  until Stripe confirms, then flips to `paid`.

Either way the amount charged is the total stored on the request, not a fresh
catalog lookup — if you raise your prices between order and payment, the fan
pays what they agreed to.

## Decisions worth knowing about

- **Totals are always computed on the server** from `tiers.json`. Whatever price
  the browser shows is display only — a hand-edited request body can't change
  what gets stored.
- **The admin API is closed until you set `ADMIN_TOKEN`.** With no token set it
  returns 503 rather than falling back to something open. The dashboard keeps
  the token in `sessionStorage`, so it dies with the tab.
- **A fan needs both the reference and the email they ordered with** to see a
  request, and even then only gets status and delivery link back — never the
  brief, and never anyone else's.
- **Payment providers are interchangeable.** `manual` keeps money out of the app
  entirely; `stripe` runs hosted checkout. Both live behind one small interface
  in [`server/src/payments.js`](server/src/payments.js), and the rest of the app
  only ever sees a payment status.
- **Nothing trusts an unsigned webhook.** Stripe events are verified against
  `STRIPE_WEBHOOK_SECRET` on the raw request body, and a late or out-of-order
  event can never turn a paid request back into an unpaid one.
- **Checkout creation is idempotent** (keyed on the request id), so a double
  submit or a retry can't produce two charges for one song.
- **A payment failure never loses a brief.** If Stripe is unreachable when a
  request comes in, the brief is still saved and the fan is told you'll send a
  link by hand.
- **Email is best-effort, always.** A mail server having a bad day can never
  turn a fan's request into an error or undo a payment that already cleared:
  failures are logged and the work carries on. Sends are capped at ten seconds
  so a hung SMTP server can't hold a browser open.
- **The finished song is emailed exactly once**, stamped on the record, so
  editing a delivered request later doesn't send it again.

## Email

Five messages, all optional — with no `SMTP_URL` they're logged instead of sent,
and the app runs fine without any of it.

| When | Who | What |
| --- | --- | --- |
| A brief arrives | you | The whole brief, and who sent it |
| A brief arrives | the fan | Their reference and what happens next |
| You create a payment link | the fan | The Stripe link, ready to pay |
| A payment clears | you | Time to start writing |
| Delivered, with a link | the fan | Their song |

Set `SMTP_URL`, `MAIL_FROM` and `ARTIST_EMAIL` to turn them on — any SMTP
service will do, and `.env.example` has connection strings for a few. Emails to
fans are signed with `ARTIST_NAME` and reply to `MAIL_REPLY_TO` (or
`ARTIST_EMAIL`), so a fan replying reaches you rather than a black hole.

Nothing is sent when you decline a request — that message is better written by
hand than by an app.

## Not built yet

Revision-request emails, file upload for
finished songs (the delivery link is a URL you paste), and a public gallery of
songs fans agreed to share — `sharePublicly` is already recorded on every
request, ready for it.
