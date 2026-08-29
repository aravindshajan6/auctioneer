/**
 * End-to-end tests: the application driven through its own interface.
 *
 * The other checks verify the engine and that pages return HTML. This one
 * clicks the buttons a bidder clicks. It exists because every bug that reached
 * the user in this project — a render loop that blanked the catalogue, a
 * hydration mismatch, a carousel posed at scale 0 — was invisible to
 * server-side tests and obvious the moment something actually used the UI.
 *
 *   npm start &
 *   npm run test:e2e
 */
import "dotenv/config";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { user } from "../src/lib/db/schema";

const BASE = `http://localhost:${process.env.PORT ?? 3000}`;
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/chromium";
const RUN = Date.now().toString(36);

let passed = 0;
const failures: string[] = [];

/**
 * Set while the suite is deliberately provoking a rejection. The bid endpoint
 * answers an invalid bid with 422 by design, and a watcher that cannot tell an
 * expected refusal from a real fault reports the app as broken for behaving
 * correctly.
 */
let expectingHttpError = false;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`    \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(label);
    console.log(`    \x1b[31m✗ ${label}\x1b[0m ${detail}`);
  }
}

function section(name: string) {
  console.log(`\n  \x1b[1m${name}\x1b[0m`);
}

/** Pull a money figure out of rendered text: "$365,000" -> 365000. */
function money(text: string | null | undefined): number | null {
  const m = text?.match(/\$([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Every console error and page exception, so a silent break still fails. */
function watchConsole(page: Page, sink: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push(msg.text().slice(0, 160));
  });
  page.on("pageerror", (err) => sink.push(`pageerror: ${err.message.slice(0, 160)}`));
  // "Failed to load resource" alone is useless; record what failed.
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (expectingHttpError && res.status() < 500) return;
    sink.push(`HTTP ${res.status()} ${res.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
}

const TOAST = '[data-sonner-toast], [role="status"], [role="alert"]';

/**
 * The submit control on the bidding panel.
 *
 * Its label is deliberately dynamic — "Place bid" while the field is empty or
 * invalid, "Bid up to $170,000" once an acceptable amount is typed, so the
 * button always states what it is about to do. A fixed-text selector silently
 * stops finding it the moment the form becomes valid.
 */
const BID_SUBMIT = /Place bid|Bid up to/;

/**
 * Does this notification mean the bid was turned down?
 *
 * Worded from the engine's own refusal copy. An earlier version tested for
 * "insufficient" and so read "Your available balance does not cover the
 * deposit for this bid." as an acceptance — a refusal reported as a success,
 * which is the worst direction for a test to be wrong in.
 */
/**
 * Submit a bid and read the SERVER's answer, not the screen's.
 *
 * The bid endpoint returns the authoritative outcome — accepted or not, and
 * the resulting price. Inferring that from toast copy and a live-updating
 * panel meant this assertion was repeatedly wrong about a correct app: the
 * wording changed, an empty toast container matched first, the panel had not
 * repainted yet. The response is a contract; the copy is not.
 */
async function submitBid(page: Page, amount: number) {
  const response = page.waitForResponse(
    (r) => /\/api\/lots\/[^/]+\/bid$/.test(r.url()) && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.fill('input[name="amount"]', String(amount));
  await page.locator("button").filter({ hasText: BID_SUBMIT }).first().click();
  try {
    const res = await response;
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      code?: string;
      message?: string;
      currentPriceCents?: number;
      minimumNextBidCents?: number;
    };
    return { status: res.status(), ...body };
  } catch {
    return { status: 0, ok: false, message: "no bid request was sent" };
  }
}

function isRefusal(text: string | null): boolean {
  if (!text) return true;
  return /cannot|refus|does not cover|below the current|must be higher|no longer available|has closed|not opened|already ended/i.test(
    text,
  );
}

/**
 * Text of the notification the app raised, or null if it raised none.
 *
 * Polls for a toast with actual TEXT rather than waiting on the first matching
 * node. The toaster keeps empty, zero-size live regions mounted at all times,
 * so `.first()` can latch onto a container that never becomes visible — and
 * the helper then reports "no notification" while the app is showing one.
 */
async function readToast(page: Page, timeout = 8000): Promise<string | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const texts = await page
      .locator(TOAST)
      .evaluateAll((els) =>
        els
          .map((e) => (e as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "")
          .filter((t) => t.length > 0),
      )
      .catch(() => [] as string[]);
    if (texts.length > 0) return texts[0];
    await page.waitForTimeout(200);
  }
  return null;
}

/**
 * Wait for notifications to clear before the next click.
 * Toasts sit over the bidding panel, and Playwright will not click through an
 * overlay — so a leftover toast reads as a broken button rather than a covered
 * one. (Which is worth knowing about the real UI too.)
 */
async function clearToasts(page: Page) {
  await page.locator(TOAST).first().waitFor({ state: "detached", timeout: 12_000 }).catch(() => {});
}

/** Sign out if a session is already open. Safe to call when signed out. */
async function signOutIfNeeded(page: Page) {
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const control = page.locator('button[aria-label="Sign out"]');
  if ((await control.count()) > 0) {
    await control.first().click();
    await page.waitForTimeout(3000);
  }
}

const PASSWORD = "hunter2hunter2";

/**
 * Register a new account through the form and fund it through the wallet.
 *
 * Every bidding assertion needs a paddle with no history: re-using a seeded
 * account means that after a few runs it already leads the lot under test, and
 * a further bid then only raises its own hidden maximum — the visible price
 * correctly does not move, and the test fails for the app being right.
 */
async function registerAndFund(page: Page, tag: string): Promise<string> {
  const address = `e2e-${RUN}-${tag}@test.local`;
  await page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.fill("#signup-name", `E2E ${tag}`);
  await page.fill("#signup-email", address);
  await page.fill("#signup-password", PASSWORD);
  await page.fill("#signup-confirm", PASSWORD);
  await page.click('button:has-text("Create account")');
  await page.waitForURL((u) => !u.pathname.includes("/sign-up"), { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.goto(`${BASE}/wallet`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.click('button:has-text("$25K")');
  await page.click('button:has-text("Add")');
  await page.waitForTimeout(3000);
  return address;
}

async function signInAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  // An authenticated visitor is redirected away from the form, so a stale
  // session has to be cleared before a different account can sign in.
  if ((await page.locator("#signin-email").count()) === 0) {
    await signOutIfNeeded(page);
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
  }
  await page.fill("#signin-email", email);
  await page.fill("#signin-password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/sign-in"), { timeout: 20_000 }),
    page.click('button:has-text("Sign in")'),
  ]);
}

async function main() {
  console.log(`\n\x1b[1mEnd-to-end (${BASE})\x1b[0m`);

  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (err) {
    console.error(`\n  No server at ${BASE} (${(err as Error).message}). Run \`npm start\` first.\n`);
    process.exit(1);
  }

  const browser: Browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const errors: string[] = [];
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  watchConsole(page, errors);

  try {
    /* ================= 1. Browsing signed out ======================== */
    section("Browsing, signed out");
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    check("the landing page shows the headline", (await page.locator("h1").innerText()).length > 8);

    await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('a[href^="/lot/"]', { timeout: 15_000 });
    const cardCount = await page.locator('a[href^="/lot/"]').count();
    check("the catalogue lists lots", cardCount > 10, `found ${cardCount}`);

    // Filters must be URL-driven, or the back button and sharing both break.
    await page.click('a:has-text("Timepieces")').catch(() => {});
    await page.waitForTimeout(1500);
    check("a department filter changes the URL", /category=/.test(page.url()), page.url());
    const filtered = await page.locator('a[href^="/lot/"]').count();
    check("the filter returns lots", filtered > 0, `found ${filtered}`);

    /* ================= 2. Auth guards ================================ */
    section("Guards");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    check("a signed-out visitor is sent from the dashboard to sign in",
      page.url().includes("/sign-in"), page.url());

    /* ================= 3. Registration =============================== */
    section("Registration");
    const email = `e2e-${RUN}-main@test.local`;
    await page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await page.fill("#signup-name", "E2E Bidder");
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", PASSWORD);
    await page.fill("#signup-confirm", PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/sign-up"), { timeout: 25_000 }).catch(() => {}),
      page.click('button:has-text("Create account")'),
    ]);
    await page.waitForTimeout(2000);
    check("a new account is created and signed in", !page.url().includes("/sign-up"), page.url());

    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    check("the new account reaches its dashboard", page.url().includes("/dashboard"), page.url());

    /* ================= 4. Sign out and demo sign-in ================== */
    section("Sign out, then back in as the demo account");
    // Sign out through the header control rather than by clearing cookies —
    // the point is that the control works.
    await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.click('button[aria-label="Sign out"]');
    await page.waitForTimeout(3500);

    // An already-signed-in visitor is redirected away from /sign-in, so
    // reaching the form at all proves the session is gone.
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    check("signing out returns the visitor to the sign-in form",
      page.url().includes("/sign-in"), page.url());

    await page.click('button:has-text("Use bidder demo")');
    await page.waitForURL((u) => !u.pathname.includes("/sign-in"), { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    check("the demo button signs in", !page.url().includes("/sign-in"), page.url());

    /* ================= 5. Wallet ===================================== */
    /* Deliberately performed as the newly registered account. A fresh paddle
       has no bidding history, which is what makes the bidding assertions below
       deterministic however many times this suite has already run. */
    section("Wallet (as the new account)");
    await signInAs(page, email, PASSWORD);
    await page.goto(`${BASE}/wallet`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const beforeText = await page.locator("body").innerText();
    const beforeAvail = money(beforeText.match(/AVAILABLE[\s\S]{0,60}/i)?.[0]);
    await page.click('button:has-text("$25K")');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(3500);
    const afterText = await page.locator("body").innerText();
    const afterAvail = money(afterText.match(/AVAILABLE[\s\S]{0,60}/i)?.[0]);
    check("a top-up raises the available balance",
      beforeAvail !== null && afterAvail !== null && afterAvail > beforeAvail,
      `${beforeAvail} -> ${afterAvail}`);

    /* ================= 6. Bidding ==================================== */
    section("Bidding");
    // Pick a live lot the demo account does not already lead.
    await page.goto(`${BASE}/explore?status=live`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('a[href^="/lot/"]', { timeout: 15_000 });
    const slugs = await page.locator('a[href^="/lot/"]').evaluateAll((els) =>
      Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!))),
    );
    check("there is at least one live lot to bid on", slugs.length > 0);

    /* A newly registered account leads nothing, so any live lot it can bid on
       will move. Prefer a cheap one: the deposit is a share of the bid, and a
       $2m lot would need more float than the wallet test just added. */
    let lotUrl: string | null = null;
    for (const href of slugs.slice(0, 8)) {
      await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2200);
      const field = page.locator('input[name="amount"]');
      if ((await field.count()) === 0) continue;
      const ph = Number((await field.getAttribute("placeholder"))?.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(ph) && ph > 0 && ph * 1.2 * 0.1 < 20_000) {
        lotUrl = `${BASE}${href}`;
        break;
      }
    }
    check("a live lot is affordable for the new account", lotUrl !== null);
    if (!lotUrl) throw new Error("no affordable live lot for the new account");

    await page.goto(lotUrl, { waitUntil: "domcontentloaded" });
    await page.locator("button").filter({ hasText: BID_SUBMIT }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(2500);

    // The amount field is placeheld with the minimum next bid, so the ask can
    // be read without depending on how the quick-bid buttons are worded.
    const askAttr = await page.locator('input[name="amount"]').getAttribute("placeholder");
    const ask = askAttr ? Number(askAttr.replace(/[^0-9.]/g, "")) || null : null;
    const priceBefore = money(await page.locator('[aria-live]').first().innerText());
    check("the panel shows a current price and an ask", priceBefore !== null && ask !== null,
      `price=${priceBefore} ask=${ask}`);

    // A bid below the ask must be refused — by the server, with a reason the
    // interface then shows.
    if (ask) {
      expectingHttpError = true;
      const low = await submitBid(page, Math.max(1, Math.floor(ask * 0.5)));
      const rejection = await readToast(page);
      expectingHttpError = false;
      // The panel refuses an obviously-short bid itself and sends nothing —
      // the right behaviour, and why this asserts on the interface rather than
      // on a response. `status: 0` from the helper means no request was made.
      check("a bid below the ask is refused",
        low.ok !== true, `HTTP ${low.status} ${low.code ?? ""}`);
      check("the refusal names the amount that would be accepted",
        money(rejection) === ask,
        `told the bidder ${money(rejection)}, ask is ${ask}`);
      if (low.status !== 0) {
        check("a refusal that reaches the server is a 422 with a minimum",
          low.status === 422 && low.minimumNextBidCents === ask * 100,
          `HTTP ${low.status}, min ${low.minimumNextBidCents}`);
      }
      await clearToasts(page);
    }

    // A valid bid must be accepted and must raise the price the server reports.
    if (ask) {
      const bidAmount = Math.round(ask * 1.2);
      const placed = await submitBid(page, bidAmount);
      check("the server accepts a bid above the ask",
        placed.ok === true, `HTTP ${placed.status} ${placed.code ?? ""} ${placed.message ?? ""}`);
      check("the accepted bid raises the price the server reports",
        typeof placed.currentPriceCents === "number" &&
          priceBefore !== null &&
          placed.currentPriceCents > priceBefore * 100,
        `${priceBefore !== null ? priceBefore * 100 : "?"} -> ${placed.currentPriceCents} (bid ${bidAmount * 100})`);

      // And the panel must catch up without a reload.
      let shown: number | null = null;
      for (let i = 0; i < 24; i++) {
        await page.waitForTimeout(500);
        shown = money(await page.locator("[aria-live]").first().innerText());
        if (shown !== null && placed.currentPriceCents !== undefined &&
            shown * 100 === placed.currentPriceCents) break;
      }
      check("the panel catches up to the accepted price without a reload",
        shown !== null && placed.currentPriceCents !== undefined &&
          shown * 100 === placed.currentPriceCents,
        `panel ${shown !== null ? shown * 100 : "?"} vs server ${placed.currentPriceCents}`);
      await clearToasts(page);
    }

    /* ================= 7. Realtime across two clients ================ */
    section("Realtime");
    // A second bidder is needed, and they must not be the lot's consignor —
    // a seller is correctly given no bid field on their own lot, and a test
    // that misses that reports a broken socket when nothing was ever bid.
    const bidderCtx = await browser.newContext();
    const bidder = await bidderCtx.newPage();
    bidder.setDefaultTimeout(15_000);
    watchConsole(bidder, errors);
    await registerAndFund(bidder, "rt");

    let contested: string | null = null;
    for (const href of slugs.slice(0, 8)) {
      await bidder.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
      await bidder.waitForTimeout(2200);
      const field = bidder.locator('input[name="amount"]');
      if ((await field.count()) === 0) continue;
      const ph = Number((await field.getAttribute("placeholder"))?.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(ph) && ph > 0 && ph * 1.2 * 0.1 < 20_000) {
        contested = href;
        break;
      }
    }
    check("a lot exists the second paddle can afford", contested !== null);

    if (contested) {
      const watcherCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      const watcher = await watcherCtx.newPage();
      watchConsole(watcher, errors);
      await watcher.goto(`${BASE}${contested}`, { waitUntil: "domcontentloaded" });
      await watcher.waitForTimeout(5000);
      const watcherBefore = money(await watcher.locator("[aria-live]").first().innerText());

      const askAttr2 = await bidder.locator('input[name="amount"]').getAttribute("placeholder");
      const bidderAsk = askAttr2 ? Number(askAttr2.replace(/[^0-9.]/g, "")) || null : null;
      let placed: Awaited<ReturnType<typeof submitBid>> | null = null;
      if (bidderAsk) placed = await submitBid(bidder, Math.round(bidderAsk * 1.2));
      // Verify the premise before the conclusion: if this bid did not land,
      // the watcher assertion below would be measuring nothing.
      check("the second paddle's bid is accepted",
        placed?.ok === true,
        `HTTP ${placed?.status ?? "-"} ${placed?.code ?? ""} ${placed?.message ?? ""}`);

      // No reload on the watcher: the socket has to carry this.
      await watcher.waitForTimeout(7000);
      const watcherAfter = money(await watcher.locator("[aria-live]").first().innerText());
      check("a bid elsewhere updates an open page without a reload",
        watcherBefore !== null && watcherAfter !== null && watcherAfter > watcherBefore,
        `${watcherBefore} -> ${watcherAfter} on ${contested}`);
      await watcherCtx.close();
    }
    await bidderCtx.close();

    /* ================= 8. Consigning a lot =========================== */
    section("Consigning");
    const sellerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const seller = await sellerCtx.newPage();
    seller.setDefaultTimeout(12_000);
    watchConsole(seller, errors);
    await signInAs(seller, "seller@auctioneer.dev", "seller1234");
    await seller.goto(`${BASE}/sell`, { waitUntil: "domcontentloaded" });
    await seller.waitForTimeout(2500);
    check("the consignment wizard opens", (await seller.locator("#lot-title").count()) === 1);

    const lotTitle = `E2E Consignment ${RUN}`;
    const categories = await seller
      .locator("#lot-category option")
      .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));

    // Step 1 — the item. The wizard refuses to advance without a department,
    // which is the behaviour being relied on here.
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(900);
    check("the wizard refuses to advance without a department",
      (await seller.locator('[aria-invalid="true"]').count()) > 0);

    await seller.fill("#lot-title", lotTitle);
    await seller.selectOption("#lot-category", categories[0]);
    await seller.fill(
      "#lot-description",
      "Consigned by the end-to-end suite. Long enough to satisfy the catalogue note's minimum length, and describing nothing that exists.",
    );
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(1200);

    // Step 2 — images.
    await seller.fill("#lot-image-url", "/lots/a-gold-watch-1768-1769-1.jpg");
    await seller.click('button:has-text("Add")');
    await seller.waitForTimeout(700);
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(1200);

    // Step 3 — pricing. A reserve below the start must be refused: it is the
    // one money rule a seller can trip by hand.
    await seller.fill("#lot-starting", "1000");
    await seller.fill("#lot-reserve", "500");
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(1000);
    check("a reserve below the starting price is refused",
      (await seller.locator('[aria-invalid="true"]').count()) > 0);

    await seller.fill("#lot-reserve", "2000");
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(1200);

    // Step 4 — schedule, then Review.
    await seller.click('button:has-text("Continue")');
    await seller.waitForTimeout(1500);

    const submit = seller.locator("button").filter({ hasText: /consign|publish|submit|list it|send|on the block/i }).last();
    const hasSubmit = (await submit.count()) > 0;
    if (!hasSubmit) {
      const seen = await seller.locator("button").evaluateAll((b) =>
        b.map((x) => (x as HTMLElement).innerText.trim().replace(/\s+/g, " ")).filter(Boolean),
      );
      check("the review step offers a submit control", false, `buttons: ${seen.join(" | ")}`);
    } else {
      check("the review step offers a submit control", true);
      await submit.click();
      await seller.waitForTimeout(5000);

      // The lot must actually exist afterwards, found the way a seller would
      // find it: their own lots tab on the dashboard.
      await seller.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
      await seller.waitForTimeout(2500);
      await seller.locator("button").filter({ hasText: /Your lots/i }).first().click().catch(() => {});
      await seller.waitForTimeout(2000);
      const dash = await seller.locator("body").innerText();
      check("the consigned lot appears in the seller's lots", dash.includes(lotTitle),
        dash.includes("E2E Consignment") ? "(only a previous run's lot)" : "(not listed)");

      // And a buyer must be able to reach it in the catalogue.
      await seller.goto(`${BASE}/explore?q=${encodeURIComponent(lotTitle)}`, {
        waitUntil: "domcontentloaded",
      });
      await seller.waitForTimeout(2500);
      check("the consigned lot is findable in the catalogue",
        (await seller.locator("body").innerText()).includes(lotTitle));
    }
    await sellerCtx.close();

    /* ================= 9. Console hygiene ============================ */
    section("Console");
    const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
    check("no console errors or page exceptions during the whole run",
      real.length === 0, real.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    // Remove only the accounts this run created.
    await db.delete(user).where(like(user.email, `e2e-${RUN}%`));
  }

  const total = passed + failures.length;
  console.log(
    failures.length === 0
      ? `\n\x1b[32m\x1b[1m  ${passed}/${total} end-to-end checks passed.\x1b[0m\n`
      : `\n\x1b[31m\x1b[1m  ${failures.length} of ${total} failed:\x1b[0m\n${failures.map((f) => `    - ${f}`).join("\n")}\n`,
  );
  await pool.end();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
