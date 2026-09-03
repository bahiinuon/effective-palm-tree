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
| `POST` | `/api/requests` | anyone (rate limited) |
| `GET` | `/api/requests/:reference?email=` | the fan who ordered it |
| `GET` | `/api/admin/requests?status=&limit=&offset=` | `Bearer $ADMIN_TOKEN` |
| `GET` | `/api/admin/requests/:id` | `Bearer $ADMIN_TOKEN` |
| `PATCH` | `/api/admin/requests/:id` | `Bearer $ADMIN_TOKEN` |

A request moves: `new → accepted → writing → delivered`, with `declined` and
`cancelled` as exits. Payment is tracked separately (`unpaid`/`paid`/`refunded`)
so you can accept a brief before any money changes hands.

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
- **Payment is a seam, not a dependency.** The default `manual` provider records
  the request as unpaid and tells the fan an invoice is coming, which is enough
  to take real work on day one. To add hosted checkout, implement a provider in
  [`server/src/payments.js`](server/src/payments.js) and mark the request paid
  from its webhook — nothing else needs to change.
- **Notifications are a `console.info` for now.** Point
  [`server/src/notify.js`](server/src/notify.js) at email or a phone push when
  you want to hear about a request without watching the dashboard.

## Not built yet

Payment capture, email to the fan (confirmation, delivery, revision requests),
file upload for finished songs (the delivery link is a URL you paste), and a
public gallery of songs fans agreed to share — `sharePublicly` is already
recorded on every request, ready for it.
