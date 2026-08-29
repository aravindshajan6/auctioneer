# Auctioneer — working notes

Live auction platform. Next.js 16 App Router + React 19 + TypeScript, Postgres
via Drizzle, Socket.IO on a custom server, Better Auth, Tailwind v4.

## Running it

`docker compose up -d` then `npm run dev` (custom server on :3000 — **not**
`next dev`, which skips the gateway and scheduler). `npm run db:seed` for demo
data. Demo login: `demo@auctioneer.dev` / `demo1234`.

## Non-obvious constraints — read before changing these

- **Node is 20.18.0 here.** Prisma 7 (`^20.19`) and pg-boss 12 (`>=22.12`) will
  not install; that is why this uses Drizzle and a DB ticker. Several installed
  packages emit EBADENGINE warnings and work anyway (verified).
- **`npx tsc --noEmit` fails on a clean tree** with `Cannot find name
  'LayoutProps'`. That global is generated — run `npx next typegen` first.
- **`server-only` cannot be imported by anything `server/` loads.** Outside
  Next's bundler it resolves to its client build and throws at require time.
  `src/lib/realtime/publish.ts` is deliberately unmarked for this reason.
- **Socket.IO lives at `/ws`, never under `/api`.** Next terminates upgrades
  whose path matches a route it can serve.
- **Socket.IO must attach after the HTTP request listener exists** — engine.io
  calls `removeAllListeners("request")` during `attach()`.
- **Better Auth rejects Origin-less CORS-mode requests** (`MISSING_OR_NULL_ORIGIN`).
  Browsers always send Origin; Node's `fetch` does not. Server-side test
  clients must set it explicitly.
- **`drei`'s `<Environment preset>` is banned** — it fetches from a no-SLA
  proxy. Use `<Environment>` with `<Lightformer>` children.
- **anime.js is v4**: named exports (`import { animate } from 'animejs'`), no
  default export. `animejs/adapters/three` drives three.js objects directly.
- **A zustand selector must never allocate.** Zustand v5 compares results with
  `Object.is`, so returning a fresh object (`?? emptyLot()`) reports a change
  every render and React throws "Maximum update depth exceeded". `useLotLive`
  returns a shared frozen `EMPTY_LOT` for this reason. This blanked the whole
  catalogue and no server-side test could see it.
- **Clock-derived text needs `suppressHydrationWarning`.** A countdown rendered
  on the server and hydrated a second later is a text mismatch, which makes
  React throw away and re-render the subtree.
- **An anime.js `opacity: [0, 1]` applies its from-value when the animation is
  CREATED, not when it plays.** Building a scroll-triggered reveal up front
  therefore hides content permanently if the trigger never fires — construct
  the animation inside the observer instead.

## Catalogue data

`scripts/sources/` holds one adapter per museum open-access API (Met, AIC, V&A,
Open Library) behind a shared throttled client. None needs a key. Two rules:
never fetch archival-size images (the Met's `primaryImage` is ~8 MB; use
`primaryImageSmall`), and never assert a fact the source does not support —
where no provenance is published the lot says so rather than inventing an
ownership chain. Every sourced lot stores `sourceName`/`sourceUrl`/
`sourceLicense` and the lot page credits them.

The seed must always complete offline; source failures degrade to the built-in
catalogue and procedural art.

## Invariants that must not regress

- Money is **integer cents** everywhere. Format only at the UI edge.
- Every price mutation takes `SELECT ... FOR UPDATE` on the auction row first.
- `sum(ledger_entries.amountCents) == wallets.available + wallets.held`.
  Holds move money between buckets and therefore record 0.
- Bidding is idempotent on `(auctionId, bidderId, idempotencyKey)`.
- Only a bid the room can see may extend the clock, and overtime is capped.
- `closeAuction` is idempotent — the ticker, retries and the sweeper all race.

## Checks

`npm test` (proxy/increment units), `npm run check:concurrency` (24-way bid
storm), `npm run check:lifecycle` (sale, reserve, soft close, settlement,
guards), `npm run check:realtime` (needs a running server; set `PORT` and a
matching `BETTER_AUTH_URL`).

Prefer adding to these over adding a framework. They run against real Postgres
and a real browser, and have already caught a ledger double-count, two
anti-snipe exploits, and the render loop that blanked the catalogue.
