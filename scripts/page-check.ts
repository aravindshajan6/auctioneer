/**
 * Browser smoke check.
 *
 * The backend suites all passed while the catalogue was crashing on hydration:
 * an infinite render loop blanked the page and nothing server-side noticed,
 * because the HTML was perfect and the fault was in the client. This check
 * exists so that class of bug fails loudly. It loads each route in a real
 * browser and asserts two things: the page has content, and the console is
 * clean.
 *
 * Requires a running server and a `chromium`/`chrome` binary. Skips (exit 0)
 * with a clear message when no browser is installed, so CI without one is not
 * blocked by a missing dependency.
 *
 *   npm start &            # or npm run dev
 *   npm run check:pages
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const BASE = `http://localhost:${process.env.PORT ?? 3000}`;
const DEBUG_PORT = 9455;

/** Routes worth guarding, with a string that must appear once rendered. */
const ROUTES: Array<{ path: string; expect: RegExp; needsCards?: boolean }> = [
  { path: "/", expect: /Objects worth|saleroom/i },
  { path: "/explore", expect: /Everything on offer|lots/i, needsCards: true },
  { path: "/explore?status=sold", expect: /lots/i, needsCards: true },
  { path: "/explore?page=2", expect: /lots/i, needsCards: true },
  { path: "/live", expect: /sale|lot/i },
  { path: "/how-it-works", expect: /bid|reserve/i },
  { path: "/sign-in", expect: /sign in|password/i },
  { path: "/sign-up", expect: /create|password/i },
];

function findBrowser(): string | null {
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    if (spawnSync("which", [bin]).status === 0) return bin;
  }
  return null;
}

interface Cdp {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  events: string[];
  close: () => void;
}

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  const events: string[] = [];
  let id = 0;

  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      events.push(`exception: ${(d.exception?.description ?? d.text ?? "").split("\n")[0]}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      events.push(
        `console.error: ${msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ")}`,
      );
    }
    if (msg.method === "Inspector.targetCrashed") events.push("renderer crashed");
  });

  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
    events,
    close: () => ws.close(),
  };
}

async function main() {
  const bin = findBrowser();
  if (!bin) {
    console.log("\n  page-check skipped: no chromium/chrome binary found.\n");
    process.exit(0);
  }

  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(4000) });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (err) {
    console.error(`\n  page-check: no server at ${BASE} (${(err as Error).message}).`);
    console.error("  Start one with `npm start` or `npm run dev` first.\n");
    process.exit(1);
  }

  const profile = mkdtempSync(path.join(tmpdir(), "auctioneer-pagecheck-"));
  const browser: ChildProcess = spawn(
    bin,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const cleanup = () => {
    browser.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  };

  let failures = 0;
  try {
    // Wait for the debugging endpoint rather than sleeping a fixed amount.
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
        target = list.find((t: { type: string }) => t.type === "page");
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!target) throw new Error("browser never exposed a page target");

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Inspector.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log(`\n\x1b[1mPage check (${BASE})\x1b[0m\n`);

    for (const route of ROUTES) {
      cdp.events.length = 0;
      await cdp.send("Page.navigate", { url: BASE + route.path });
      // Long enough for hydration and the first socket round trip to settle.
      await new Promise((r) => setTimeout(r, 4500));

      let text = "";
      let cards = 0;
      try {
        const probe = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `JSON.stringify({t: document.body.innerText.slice(0, 4000), c: document.querySelectorAll('a[href^="/lot/"]').length})`,
        });
        const parsed = JSON.parse(probe.result.value);
        text = parsed.t;
        cards = parsed.c;
      } catch (err) {
        text = "";
      }

      const problems: string[] = [];
      if (text.length < 200) problems.push(`page is blank (${text.length} chars)`);
      else if (!route.expect.test(text)) problems.push(`missing expected content ${route.expect}`);
      if (route.needsCards && cards === 0) problems.push("no lot cards rendered");
      problems.push(...cdp.events);

      if (problems.length === 0) {
        console.log(`  \x1b[32m✓\x1b[0m ${route.path}`);
      } else {
        failures += 1;
        console.log(`  \x1b[31m✗ ${route.path}\x1b[0m`);
        for (const p of problems.slice(0, 3)) console.log(`      ${p}`);
      }

      await cdp.send("Page.navigate", { url: "about:blank" });
      await new Promise((r) => setTimeout(r, 200));
    }
    cdp.close();
  } finally {
    cleanup();
  }

  console.log(
    failures === 0
      ? "\n\x1b[32m\x1b[1mEvery page rendered with a clean console.\x1b[0m\n"
      : `\n\x1b[31m\x1b[1m${failures} route(s) failed.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
