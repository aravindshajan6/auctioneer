/**
 * End-to-end realtime check against a running server.
 *
 * Proves the whole path a bidder actually experiences: sign in over HTTP,
 * open a socket with that session cookie, join a lot room, POST a bid, and
 * receive the broadcast — plus the negative cases (anonymous sockets are
 * allowed to watch, rejected bids do not broadcast).
 *
 *   npm run check:realtime   (server must already be running)
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { io as Client, type Socket } from "socket.io-client";
import { db, pool } from "../src/lib/db";
import { auctions, user } from "../src/lib/db/schema";
import { credit } from "../src/lib/wallet/ledger";
import { auth } from "../src/lib/auth";

const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

/**
 * Better Auth refuses requests that declare CORS mode without an Origin
 * (`MISSING_OR_NULL_ORIGIN`). Node's fetch sets `sec-fetch-mode: cors` but no
 * Origin, whereas a real browser always sends one — so the test has to supply
 * what the browser would.
 */
const HEADERS = { "content-type": "application/json", Origin: BASE };
const $ = (d: number) => Math.round(d * 100);
let failures = 0;
const cleanup: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail}`); }
}

const waitFor = <T,>(s: Socket, event: string, ms = 6000) =>
  new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => { s.off(event, handler); resolve(null); }, ms);
    const handler = (p: T) => { clearTimeout(timer); s.off(event, handler); resolve(p); };
    s.on(event, handler);
  });

async function main() {
  console.log(`\n\x1b[1mRealtime end-to-end check (${BASE})\x1b[0m\n`);
  const run = nanoid(6);

  /* -- Fixtures: a seller, a funded bidder, and a live lot. -------------- */
  const sellerId = `u_rts_${run}`;
  await db.insert(user).values({ id: sellerId, name: "RT Seller", email: `rts-${run}@test.local` });
  cleanup.push(sellerId);

  const email = `rtb-${run}@test.local`;
  const password = "hunter2hunter2";
  const signed = await auth.api.signUpEmail({ body: { email, password, name: "RT Bidder" } });
  const bidderId = signed.user.id;
  cleanup.push(bidderId);
  await db.transaction((tx) => credit(tx, bidderId, $(100_000), { kind: "deposit", memo: "rt" }));

  const auctionId = `a_rt_${run}`;
  const now = new Date();
  await db.insert(auctions).values({
    id: auctionId,
    slug: `rt-lot-${run}`,
    sellerId,
    title: "Realtime Test Lot",
    type: "timed",
    status: "live",
    startingPriceCents: $(100),
    currentPriceCents: $(100),
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    originalEndsAt: new Date(now.getTime() + 3_600_000),
  });

  /* -- Sign in over real HTTP to obtain a session cookie. ---------------- */
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const rawCookie = signIn.headers.getSetCookie?.() ?? [];
  const cookie = rawCookie.map((c) => c.split(";")[0]).join("; ");
  check("sign-in over HTTP returns a session cookie", signIn.ok && cookie.length > 0,
    `status=${signIn.status}`);

  /* -- An anonymous socket may watch: browsing must not require login. --- */
  const anon = Client(BASE, { path: "/ws", transports: ["websocket"] });
  const anonConnected = await new Promise<boolean>((r) => {
    anon.on("connect", () => r(true));
    anon.on("connect_error", () => r(false));
    setTimeout(() => r(false), 5000);
  });
  check("an anonymous socket connects", anonConnected);

  /* -- An authenticated socket carries the session. ---------------------- */
  const sock = Client(BASE, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: { cookie },
  });
  const connected = await new Promise<boolean>((r) => {
    sock.on("connect", () => r(true));
    sock.on("connect_error", (e) => { console.log("   connect_error:", e.message); r(false); });
    setTimeout(() => r(false), 5000);
  });
  check("an authenticated socket connects", connected);

  const clock = await waitFor<{ now: number }>(sock, "server:time", 4000);
  check("the server broadcasts its clock on connect", clock !== null && typeof clock.now === "number");

  /* -- Join the lot room and confirm viewer presence. -------------------- */
  sock.emit("lot:join", auctionId);
  anon.emit("lot:join", auctionId);
  const viewers = await waitFor<{ auctionId: string; count: number }>(sock, "lot:viewers", 4000);
  check("joining a lot broadcasts a viewer count",
    viewers !== null && viewers.auctionId === auctionId && viewers.count >= 1,
    JSON.stringify(viewers));

  /* -- The main event: a bid over HTTP must reach the room. -------------- */
  const statePromise = waitFor<{ currentPriceCents: number; leaderId: string }>(sock, "lot:state", 8000);
  const bidPromise = waitFor<{ bid: { amountCents: number; bidderName: string } }>(sock, "lot:bid", 8000);

  const res = await fetch(`${BASE}/api/lots/${auctionId}/bid`, {
    method: "POST",
    headers: { ...HEADERS, cookie },
    body: JSON.stringify({ amountCents: $(500), idempotencyKey: `rt-${run}` }),
  });
  const body = await res.json();
  check("the bid API accepts the bid", res.ok && body.ok === true, JSON.stringify(body).slice(0, 200));

  const state = await statePromise;
  check("a lot:state broadcast reaches the room",
    state !== null && state.currentPriceCents === $(100) && state.leaderId === bidderId,
    JSON.stringify(state));

  const bidEvent = await bidPromise;
  check("a lot:bid broadcast reaches the room",
    bidEvent !== null && bidEvent.bid.amountCents === $(100),
    JSON.stringify(bidEvent));

  /* -- The anonymous watcher must see it too. ---------------------------- */
  const anonState = waitFor<{ currentPriceCents: number }>(anon, "lot:state", 8000);
  await fetch(`${BASE}/api/lots/${auctionId}/bid`, {
    method: "POST",
    headers: { ...HEADERS, cookie },
    body: JSON.stringify({ amountCents: $(900), idempotencyKey: `rt2-${run}` }),
  });
  const seen = await anonState;
  check("an anonymous watcher receives live prices", seen !== null, JSON.stringify(seen));

  /* -- A rejected bid must not broadcast anything. ----------------------- */
  // Use a SECOND bidder: the first one already leads this lot, so a low bid
  // from them is correctly `not_a_raise`, not `below_minimum`.
  const email2 = `rtc-${run}@test.local`;
  const signed2 = await auth.api.signUpEmail({
    body: { email: email2, password, name: "RT Underbidder" },
  });
  cleanup.push(signed2.user.id);
  await db.transaction((tx) => credit(tx, signed2.user.id, $(100_000), { kind: "deposit", memo: "rt" }));
  const signIn2 = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ email: email2, password }),
  });
  const cookie2 = (signIn2.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  // Let the previous bid's broadcast land before asserting silence, or the
  // assertion races it and reports a failure that never happened.
  await new Promise((r) => setTimeout(r, 1200));

  const shouldStaySilent = waitFor(sock, "lot:bid", 2500);
  const bad = await fetch(`${BASE}/api/lots/${auctionId}/bid`, {
    method: "POST",
    headers: { ...HEADERS, cookie: cookie2 },
    body: JSON.stringify({ amountCents: $(1) }),
  });
  const badBody = await bad.json();
  check("a below-minimum bid is rejected with a reason",
    bad.status === 422 && badBody.code === "below_minimum", JSON.stringify(badBody).slice(0, 160));
  check("a rejected bid broadcasts nothing", (await shouldStaySilent) === null);

  /* -- Unauthenticated bidding is refused. ------------------------------- */
  const noAuth = await fetch(`${BASE}/api/lots/${auctionId}/bid`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ amountCents: $(5_000) }),
  });
  check("bidding without a session is refused", noAuth.status === 401, `status=${noAuth.status}`);

  sock.close();
  anon.close();
  await db.delete(auctions).where(eq(auctions.id, auctionId));
  for (const id of cleanup) await db.delete(user).where(eq(user.id, id));

  console.log(failures === 0
    ? "\n\x1b[32m\x1b[1mRealtime path verified end to end.\x1b[0m\n"
    : `\n\x1b[31m\x1b[1m${failures} check(s) failed.\x1b[0m\n`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
