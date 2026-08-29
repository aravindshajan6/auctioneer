# Auctioneer

A live auction house on the web. Real-time bidding, eBay-style proxy bids,
sealed reserves, anti-snipe soft close, and a double-entry ledger behind every
deposit.

Built with Next.js 16 (App Router), React 19, TypeScript, Postgres + Drizzle,
Socket.IO, Better Auth, Tailwind v4, and a three.js / anime.js landing page.

---

## Quick start

```bash
docker compose up -d       # Postgres, Redis, MinIO
cp .env.example .env       # then set BETTER_AUTH_SECRET: openssl rand -base64 32
npm install
npm run db:push            # create the schema
npm run db:seed            # demo catalogue, users, bid history
npm run dev                # http://localhost:3000
```

Requires Node ≥ 20.9 (developed on 20.18) and Docker.

### Demo accounts

| Email | Password | Role |
| --- | --- | --- |
| `demo@auctioneer.dev` | `demo1234` | bidder, funded wallet |
| `seller@auctioneer.dev` | `seller1234` | seller |
| `admin@auctioneer.dev` | `admin1234` | admin |

---

## Why there is a custom server

`server/index.ts` mounts Next as the request handler on a plain Node HTTP
server so Socket.IO can share the same port and origin. That means the session
cookie is present on the socket handshake with no CORS or token plumbing, and
the auction scheduler lives in the same process.

Three details in there are load-bearing and easy to get wrong:

- **Socket.IO is attached after the request listener exists.** engine.io's
  `attach()` calls `removeAllListeners("request")` and re-dispatches only to
  the listeners it captured at that moment. Attach first and every HTTP
  request 404s.
- **The gateway lives at `/ws`, not under `/api`.** Next terminates any
  upgrade whose path matches a route it can serve, so a gateway path that
  collides with an App Router route silently kills every socket.
- **`destroyUpgrade: false`,** and `/_next` upgrades are forwarded to Next's
  own handler. Otherwise engine.io destroys unrecognised upgrades after ~1s
  and takes the dev HMR socket with it.

---

## How bidding actually works

### Proxy bidding

Bidders submit a **maximum**, never a price. The house bids on their behalf
only as far as needed to stay ahead, so the visible price is driven by the
*second*-highest maximum plus one increment, capped by the highest maximum.

`src/lib/auction/proxy.ts` is a pure function — no database, no clock — so
every edge case is exercised by `proxy.test.ts` rather than in production:

- The opener pays the starting price, not their ceiling.
- A winner is never charged more than their own maximum, even when a full
  increment would overshoot it.
- An exact tie goes to the **earlier** bid.
- Raising your own ceiling never moves the price — you don't bid against
  yourself.
- A reserve does not block bidding, it blocks *selling*: once the leading
  ceiling covers the reserve, the ask advances straight to it.

### Concurrency

Every mutation of a lot opens a transaction and takes `SELECT … FOR UPDATE` on
the auction row first. That row is the lot's mutex, so two bids arriving in the
same millisecond queue behind each other instead of both reading the same stale
price and both "winning". Proxy resolution, deposits, soft close and counters
all happen inside that lock and commit together.

`scripts/concurrency-check.ts` fires 24 simultaneous bids at one lot and
asserts the invariants a naive read-modify-write would violate.

**A lot's ask only ever rises.** The resolved price is clamped to the standing
one, so a bid can never lower an ask even if the bid history underneath it is
thinner than the recorded price — the shape left behind when bids vanish under
a live lot. Found by the end-to-end suite, which accepted a $145,200 bid and
watched the ask fall from $116,000 to $90,000.

Bid submission is idempotent: pass a stable `idempotencyKey` and a retried
request replays the original outcome instead of bidding twice.

### Anti-snipe soft close

A bid inside the closing window pushes the end time out, because sniping wins
by denying rivals a chance to respond rather than by valuing the lot higher.
Two rules keep that from being abused:

- Only a bid **the room can see** extends the clock. Quietly raising your own
  ceiling moves no price and displaces nobody, so it buys no time — otherwise
  one bidder could stall indefinitely, alone.
- Overtime is **capped** (`ANTISNIPE_MAX_EXTENSIONS`), or two determined
  bidders keep a lot open forever and nobody can plan around a closing time.

### Closing

`server/scheduler.ts` makes the database the schedule: a tick asks "what is
due?" and settles it. A per-lot `setTimeout` would lose every pending close on
restart, deploy or crash. Because the ticker reads `ends_at` fresh, soft-close
extensions need no scheduler work at all, and a lot whose end time passed while
the process was down is settled by the very next tick. `closeAuction` is
idempotent, so the ticker, a retry and the catch-up sweep can all race
harmlessly.

### Money

Integer minor units (cents) everywhere; formatting happens only at the edge.

`ledger_entries` is append-only and authoritative; the balances on `wallets`
are a cache written in the same transaction as the entry that justifies them.
Wallets carry two balances, because a bid is a commitment before it is a
payment: `available` is spendable now, `held` is earmarked against a live bid.
A ledger row's signed `amountCents` is the change in the wallet's **total**
claim, so shuffling money between the two buckets carries 0 and only real
inflows and outflows carry a value. The invariant
`sum(amountCents) == available + held` is asserted by the lifecycle check.

---

## Layout

```
server/            custom Next server, Socket.IO gateway, auction scheduler
src/lib/
  auction/         proxy resolution, increment ladder, the bid engine
  wallet/          double-entry ledger, deposits
  db/              Drizzle schema and client
  realtime/        socket contract, client hooks, zustand store
  auth/            Better Auth server + client
  queries.ts       server-side data access
src/app/
  page.tsx         3D landing page
  (app)/           explore, lot, live, dashboard, sell, wallet, orders
  (auth)/          sign in / sign up
  api/             bids, buy-now, watch, wallet, orders, notifications
scripts/           seed, concurrency check, lifecycle check
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next + gateway + scheduler on :3000 |
| `npm run build` / `npm start` | production build and serve |
| `npm run typecheck` | `tsc --noEmit` (run `next typegen` first on a clean tree) |
| `npm test` | proxy and increment unit tests |
| `npm run check:concurrency` | 24-way simultaneous bid storm |
| `npm run check:lifecycle` | sale, reserve, soft close, settlement, guards |
| `npm run check:realtime` | socket auth, room fan-out, broadcast (server must be running) |
| `npm run check:pages` | loads every route in a real browser; fails on a blank page or console error |
| `npm run test:e2e` | 28 checks driving the real UI: register, fund, bid, consign, live update |
| `npm run db:push` / `db:seed` / `db:studio` | schema, demo data, browser |
| `npm run infra:up` / `infra:down` | Docker services |

---

## Notes and limits

- **Payments are simulated.** The ledger is real double-entry bookkeeping; only
  the funding source is fictional, so a payment provider slots in behind the
  same interface by replacing `src/app/api/wallet/topup/route.ts`.
- **The catalogue describes real objects.** `npm run db:seed` builds it from
  museum open-access APIs — the Met, the Art Institute of Chicago, the V&A and
  Open Library — so lot titles, makers, dates, media, dimensions and (where an
  institution publishes one) genuine provenance chains are real records rather
  than invention. None of the objects is actually for sale; each lot page says
  so and credits the institution and its licence.

  No API keys are needed. The seed respects each institution's published rate
  limit (the Met allows 80 requests/second, the Art Institute 60/minute) and
  downloads web-sized derivatives, never archival masters — a single Met
  original is ~8 MB against ~265 KB for the same image at web size.

  **Seeding works with no network at all**: any source failure falls back to a
  built-in catalogue plus procedurally generated artwork, so the demo is never
  hostage to a museum being up. Two departments — Automobilia and Wine &
  Spirits — have no free source and are always hand-written.

- **Artwork is downloaded or generated at seed time**, so `public/lots/` is
  build output and is git-ignored. Lots without usable photography fall back to
  deterministic SVG plates.
- The landing page's 3D scene is fully procedural: no `.glb`, no HDRI files,
  no CDN. `drei`'s `<Environment preset>` is deliberately avoided because it
  fetches from a no-SLA proxy.
- Redis runs with `maxmemory-policy noeviction` because it carries live bid
  fan-out; evicting those keys would silently drop broadcasts.

---

## Credits

Catalogue records and photography come from museum open-access programmes and
are used under their published terms. The objects are not for sale; each lot
page names its source and licence.

- The Metropolitan Museum of Art — Open Access, CC0 1.0
- The Art Institute of Chicago — CC0 1.0, descriptions CC-BY 4.0
- Victoria and Albert Museum — open access
- Open Library / Internet Archive

Lots without a usable photograph, and the Automobilia and Wine & Spirits
departments, carry generated artwork instead.
