# Prompt to paste into the new project's Claude Code session

Revised after deploying `auctioneer.sapper.top`. The additions marked
**(learned the hard way)** each correspond to a bug that actually happened —
keep them.

---

I want to deploy this app to my own VPS, manually over SSH, with no PaaS layer.
Read `DEPLOY_NOTES.md` in this repo first — it has verified server facts, and
the sections on name collisions and sizing will save you a wasted iteration.

## Context you must respect

My VPS (`sapper`, HeavenCloud): 4 GB RAM, 48 GB disk, Ubuntu, root SSH at
`82.41.67.6`. It already runs Coolify hosting a different app at
valodex.sapper.top. I am NOT deploying this new app through Coolify — I want a
manual pipeline I control and understand.

**The binding constraint is RAM, not disk.** Measured: **~1.6 GB genuinely
available**, and valodex holds ~1 GB with no limit of its own. Optimise for
small *memory* footprint. Disk is plentiful (37 GB free) — do not trade
reliability for image size.

`*.sapper.top` is already a **wildcard DNS record**, so a new subdomain needs
no DNS change. Verify it resolves anyway before deploying.

## Hard constraints — do not violate these

1. **Coolify's Traefik owns ports 80 and 443.** Do NOT add nginx, Caddy, or any
   other reverse proxy. Do NOT publish container ports 80/443.
2. **Do not modify anything under `/data/coolify`** or touch valodex, its
   containers, images, volumes, or Traefik's config.
3. **Do not run `docker system prune -a`** — it can delete valodex's images.
   Dangling-only (`docker image prune -f`) is fine.
4. My code lives at `/opt/<appname>`, outside Coolify's tree.
5. Traefik has `exposedbydefault=false` — my container must set
   `traefik.enable=true` or it gets no routing at all.
6. **(learned the hard way) Never address my own services by generic name.**
   My app joins the shared `coolify` network, where `redis` already resolves to
   Coolify's Redis. Use container names (`myapp-redis`, `myapp-postgres`) in
   connection strings, and keep the database and cache on a separate private
   network that is NOT `coolify`.

## Step 1 — inspect before you write anything

Do not guess the stack. Read the actual project files to determine:
- Language, framework, package manager, lockfile
- The build command and the production start command
- **The exact port the app listens on**, and whether it binds `0.0.0.0`.
  Check the real `listen()` call, not a `HOST` variable that may only be used
  for URL construction. Confirm with `ss -ltnp` against a running instance.
- Runtime env vars and secrets it needs
- Whether it needs a database and/or cache
- **(learned the hard way) Which packages the runtime imports that are filed
  under `devDependencies`.** A pruned image dies on first boot with
  `MODULE_NOT_FOUND`. Walk every import in the server/app/scripts directories
  and check it against `dependencies`. Report the list.
- **(learned the hard way) Whether the build requires any runtime secret.**
  A statically-prerendered page that reads a secret makes `next build` fail in
  Docker and in CI. If so, split non-secret config from secrets rather than
  feeding production credentials to the build.
- **Measure, don't estimate:** peak build RSS (`/usr/bin/time -v`) and the size
  of a production-only dependency install. Report both before choosing.

Tell me what you found, the port you're targeting, and those measurements
before generating any files.

## Step 2 — choose the deployment shape and justify it

**Option A — Docker Compose on the `coolify` network** (default).
Traefik auto-discovers via container labels. Most reliable, easiest TLS,
and container memory limits protect the box from my app.

**Option B — bare systemd service, no container.**
Lighter on disk. Traefik routes to it via the file provider at
`/data/coolify/proxy/dynamic/` pointing at `host.docker.internal:<port>`.
More moving parts.

Recommend one for MY stack in two or three sentences. Weigh that Option B
needs any database installed and tuned on the host, competing with Coolify,
while Option A can cap its own memory.

**Also decide WHERE it builds and justify it.** If the build peaks anywhere
near 1 GB, build in GitHub Actions and push to GHCR so the VPS only pulls.
A build on this box is the single most likely thing to OOM it and take
valodex down; `mem_limit` does not constrain a build.

## Step 3 — generate the files

- **`Dockerfile`** — multi-stage, alpine base, non-root user, HEALTHCHECK that
  actually checks dependencies. Build tooling must not reach the final image.
  Exclude build caches (e.g. `.next/cache`) from the runtime stage.
  **Give me a realistic size estimate up front** — for Next.js expect
  1.2–1.5 GB because `output: "standalone"` is incompatible with a custom
  server. Do not promise 400 MB.
- **`.dockerignore`** — aggressive: `.git`, `node_modules`, build output,
  `.env`, tests, docs, local tooling.
- **`docker-compose.yml`** — from the template in `DEPLOY_NOTES.md`. No
  `ports:`. Database and cache on a private network. `mem_limit` **and**
  `memswap_limit` on every service, and for Node pair the limit with
  `NODE_OPTIONS=--max-old-space-size` at ~75% of it, or the kernel will kill
  the container instead of Node collecting garbage.
- **`.env.example`** — every var documented, no real secrets, connection
  strings using **container** names.
- **`deploy.sh`** — pull (not build), up, wait for health, prune dangling
  images only, print status and memory.
- **CI workflow** — build and push to GHCR, tagging both `latest` and
  `sha-<short>` so rollback names a specific build.

**(learned the hard way) Do not regenerate the lockfile to make a small change.**
Moving a dependency between `dependencies` and `devDependencies`, or adding a
script, does NOT need a fresh `package-lock.json`. Regenerating one can re-hoist
native/optional binaries differently (e.g. esbuild's per-platform packages), and
a postinstall that checks its binary version then fails the Docker build with
`Expected "X" but got "Y"`. Edit the manifest, keep the lockfile, and if it must
change, change it by the minimum. Note that **`npm ci --dry-run` passes on a
broken lockfile** because it skips install scripts — it is not a valid check for
this. Only a real `docker build` is.

## Step 3.5 — rehearse locally before writing the runbook

**(learned the hard way) Do not hand me instructions for something you have not
seen boot.** Build the image and run the full stack on your machine first:
create a throwaway `coolify` network, bring everything up, run the migration,
run the seed, and confirm the app serves and the health check passes.

Report what broke. Three separate bugs surfaced this way last time and never
reached my server.

**(learned the hard way) A green build is not a booting image.** After the build
succeeds, actually `docker run` it and hit the health endpoint before you write
a single runbook line. When you pass env for this test, `docker run --env-file
.env` feeds quotes and comments through literally — a value quoted in `.env`
arrives with the quotes attached and a connection string breaks. Pass the vars
explicitly, or strip quotes first.

Be aware of the limit of this rehearsal: a local `coolify` network is *empty*,
so it cannot reveal collisions with Coolify's own services. Reason about those
separately — see constraint 6.

## Step 3.6 — harden before you call it deployable

A live URL is an exposed URL. Before the runbook, check and fix:
- **Seed/demo credentials.** If a seed runs on production, any account with a
  guessable password is a live login. Only intentionally-public demo logins stay
  fixed; every other account (admin included) gets a random password per run.
- **Security headers.** Set CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and turn off any `X-Powered-By`
  framework banner. Verify them with `curl -sI` against the running image.
- **Port exposure.** From off-box, confirm the datastore ports (5432/6379/etc.)
  and the app's own port are closed to the internet — only the proxy's 443
  should answer.
- **Secrets in the client bundle.** Grep the built assets; nothing but
  intentionally-public `PUBLIC_`/`NEXT_PUBLIC_` values should appear.
- **Schema changes via migrations, not a live `push`.** A push against a
  populated database is unversioned and irreversible; generate migrations and
  apply them, baselining once if the DB was originally built with push.

Report what you found and fixed. Re-verify each on the deployed URL in Step 4,
not just locally.

## Step 4 — give me the runbook

Exact commands in order, each marked **LOCAL** or **ON THE VPS** — I have got
this wrong by pasting server commands into my laptop, so make it unmissable.

Cover:
- Verifying DNS resolves (wildcard means usually nothing to create)
- First-time server setup, including `docker login ghcr.io` if the image is
  private, and that `.env` **must** sit beside `docker-compose.yml`
- The first deploy, and the required order:
  deploy → migrate → seed → **restart** (Next caches `public/` at boot, so
  anything the seed writes 404s until the container restarts)
- Verification: logs, cert issuance, an external `curl` proving HTTPS, and
  `docker stats` proving the memory budget holds
- Rollback via the `sha-` tag
- Diagnosis: 404 (Traefik matched nothing) vs 502 (app not reachable) vs
  `no available server` (route matched, container mid-restart)
- **(learned the hard way) Do not hardcode the compose filename in follow-up
  commands.** `deploy.sh` finds the compose file; a hand-written
  `docker compose -f compose.prod.yml exec …` line silently fails with
  `no such file or directory` if the file is named differently, and the
  migrate/seed/restart you thought ran did not. Run `docker compose` from the
  app directory with no `-f` and let it resolve, or confirm the real filename
  with `ls /opt/<appname>/*.y*ml` first.
- **(learned the hard way) Verify the change you shipped, not just that the app
  is up.** `curl` the thing that was supposed to change and assert on it —
  headers present, an old credential now rejected, the new route answering. A
  healthy container proves it started, not that the deploy did what it was for.

## Working rules

- **You do not have SSH access to the VPS. I run every server command myself.**
  Give me commands to paste; never assume one succeeded — wait for my output.
- **Prefer a script over hand-editing** for anything with secrets or a value
  repeated across fields. Generating and `sed`-ing a `.env` beats me editing it
  in nano and mistyping a password inside a connection string.
- **Never ask me to paste a secret back to you.** Ask for the *outcome*
  (`Login Succeeded`), and warn me before any command whose output might
  contain a credential.
- Explain *why* for anything non-obvious, especially the Traefik labels.
- Ask me before adding any dependency or service that runs on the VPS.
- Flag anything that could affect valodex before I run it.

Start with Step 1.
