# VPS Deployment Notes — sapper (HeavenCloud)

Verified facts for deploying a new app alongside Coolify. Everything marked
**[measured]** was observed on the box, not assumed. Updated after deploying
`auctioneer.sapper.top` (Next.js 16 + Postgres + Redis), which is the worked
example throughout.

## Server
- 4 GB RAM / 48 GB disk (~11 GB used) — **[measured]** disk is not the issue
- 2 GB swapfile at /swap.img — KEEP IT (OOM insurance)
- Ubuntu 24.04, hostname `sapper`, root SSH, IP `82.41.67.6`
- ufw INACTIVE — check whether HeavenCloud provides a cloud firewall
- **[measured] ~1.6–1.7 GB genuinely available**, not the 2.6 GB previously
  estimated. `free -h` "available" is the number that matters.
- Ceiling: roughly 4–6 more small apps, if each stays near 250 MB.

## Existing setup — DO NOT BREAK
- Coolify running valodex.sapper.top
- Coolify's Traefik owns 80/443. Do NOT install nginx/Caddy on those ports.
- **[measured] valodex uses ~1.0 GB and runs with NO memory limit** — its
  `docker stats` limit shows the full host size. If it spikes, nothing stops
  it. Your app having limits is partly protection *from* that situation, since
  it guarantees yours is not the one that starved the box.

## DNS — already solved
**`*.sapper.top` is a wildcard A record → 82.41.67.6.** **[measured]** — a
freshly invented subdomain resolves. So a new app needs **no DNS record at
all**; the name works the moment Traefik has a route for it.

Verify before deploying anyway (an ACME failure costs rate limit):
```
dig +short newapp.sapper.top          # expect 82.41.67.6
curl -I http://newapp.sapper.top      # 404 from Traefik = reachable, no route yet
```
That 404 is the healthy pre-deploy state: Traefik is answering, it just has no
matching router.

## Traefik (proxy) facts needed for labels
| Item | Value |
|---|---|
| Container | `coolify-proxy` |
| Version | traefik:v3.6 |
| Docker network | `coolify` (external) |
| Entrypoints | `http` (:80), `https` (:443) |
| Cert resolver | `letsencrypt` (HTTP-01 challenge) |
| exposedbydefault | `false` — containers must set traefik.enable=true |

Keep the HTTP router even though it only redirects: **Let's Encrypt answers
HTTP-01 on port 80**, so removing it breaks certificate issuance.

---

## ⚠️ The trap that cost the most time: name collisions

Your app must join the shared `coolify` network for Traefik to reach it. That
means it also inherits Coolify's **DNS namespace**, and generic service names
are not yours to claim.

**[measured] On the `coolify` network, `redis` resolves to 10.0.1.2 —
Coolify's own Redis**, which requires a password. An app configured with
`redis://redis:6379` connects to the neighbour and loops on:

```
NOAUTH HELLO must be called with the client already authenticated
```

…while hammering a service valodex depends on.

**Rule: address your own services by CONTAINER name, never service name.**

```
DATABASE_URL=postgresql://user:pass@myapp-postgres:5432/db   # not @postgres
REDIS_URL=redis://myapp-redis:6379                           # not @redis
```

Container names are unique across the whole daemon. Postgres happened to
resolve correctly (Coolify's is `coolify-db`), but relying on that is luck.

Put your database and cache on a **second, private network** and keep them off
`coolify` entirely — only the app needs to straddle both. Otherwise every
container on the shared network can reach your database.

## Other gotchas, each hit for real

**`.env` must sit beside `docker-compose.yml`.** Compose resolves
`${VAR}` in the compose file from a `.env` in the *compose file's directory*
or the shell — **not** from `env_file:`, which only injects into the container.
Wrong location gives `required variable X is missing a value`, which does not
explain itself.

**Pin Node's heap below the container limit.** Node sizes its heap from the
HOST's memory, so in a 768m container it grows past the cap and is killed by
the kernel — presenting as an unexplained crash-loop. Always pair a `mem_limit`
with `NODE_OPTIONS=--max-old-space-size=<~75% of limit>`.

**A build must never require runtime secrets.** If any statically-prerendered
page reads a secret at build time, `next build` fails in Docker (where `.env`
is correctly excluded) and in CI. Split non-secret config from secrets.

**Check for devDependencies used at runtime.** A pruned production image dies
on first boot with `MODULE_NOT_FOUND`. For Next with a custom server, `tsx` and
`dotenv` are runtime dependencies despite conventionally being dev ones.

**Next caches `public/` at boot.** Anything written there afterwards (seed
output, uploads) 404s until the container restarts.

**`no available server`** from Traefik = route matched, backend not answering.
Usually the container is mid-restart. Not a routing problem.

## Sizing reality — Next.js
- `next build` peaks at **~1.7 GB RSS** **[measured]**. Do NOT build on this
  box; use GitHub Actions + GHCR and let the VPS only pull.
- Final image **~1.3 GB** **[measured]** for Next 16. `output: "standalone"`
  would slim it drastically but is **incompatible with a custom server**
  (needed for WebSockets/schedulers). Production `node_modules` alone is
  874 MB, of which `next` + `@next` are 385 MB. Budget 1.2–1.5 GB, not 400 MB.
- Image size costs **disk, not RAM**, and layer caching means redeploys pull
  only the changed app layer (~45 MB).
- **[measured] A deployed Next app idles at ~150 MB**, Postgres ~55 MB,
  Redis ~25 MB. So ~230 MB total per app of this shape.

---

## Working compose template

Replace `newapp`, the domain, and the port. Proven in production.

```yaml
name: newapp
networks:
  coolify:
    external: true
  internal:            # keeps the DB off the shared network
    driver: bridge
volumes:
  postgres-data:
  redis-data:
services:
  app:
    image: ${APP_IMAGE:-ghcr.io/OWNER/newapp:latest}   # pulled, never built here
    container_name: newapp
    restart: unless-stopped
    networks: [coolify, internal]
    env_file: [.env]
    environment:
      NODE_OPTIONS: --max-old-space-size=576           # ~75% of mem_limit
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.5
    labels:
      - traefik.enable=true
      - traefik.docker.network=coolify
      - traefik.http.routers.newapp.rule=Host(`newapp.sapper.top`)
      - traefik.http.routers.newapp.entrypoints=https
      - traefik.http.routers.newapp.tls=true
      - traefik.http.routers.newapp.tls.certresolver=letsencrypt
      - traefik.http.services.newapp.loadbalancer.server.port=3000
      - traefik.http.routers.newapp-http.rule=Host(`newapp.sapper.top`)
      - traefik.http.routers.newapp-http.entrypoints=http
      - traefik.http.routers.newapp-http.middlewares=newapp-https
      - traefik.http.middlewares.newapp-https.redirectscheme.scheme=https

  postgres:
    image: postgres:17-alpine
    container_name: newapp-postgres      # referenced by THIS name in DATABASE_URL
    restart: unless-stopped
    networks: [internal]                 # deliberately NOT on coolify
    environment:
      POSTGRES_USER: newapp
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}
      POSTGRES_DB: newapp
    volumes: [postgres-data:/var/lib/postgresql/data]
    command: >
      postgres -c shared_buffers=96MB -c max_connections=50
               -c effective_cache_size=256MB -c work_mem=4MB
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U newapp -d newapp"]
      interval: 10s
      timeout: 5s
      retries: 10
    mem_limit: 320m
    memswap_limit: 320m

  redis:
    image: redis:8-alpine
    container_name: newapp-redis         # referenced by THIS name in REDIS_URL
    restart: unless-stopped
    networks: [internal]
    command: ["redis-server","--appendonly","yes","--maxmemory","128mb","--maxmemory-policy","noeviction"]
    volumes: [redis-data:/data]
    healthcheck:
      test: ["CMD","redis-cli","ping"]
      interval: 10s
      timeout: 3s
      retries: 10
    mem_limit: 160m
    memswap_limit: 160m
```

No `ports:` anywhere — Traefik reaches the app privately, so nothing can
collide with 80/443 and the app is never directly internet-facing.

## Build pipeline (GitHub Actions → GHCR)

The box only ever pulls. Workflow needs `permissions: packages: write` and
authenticates with the automatic `GITHUB_TOKEN`. Tag both `latest` and
`sha-<short>` — the SHA tag is what makes rollback a specific, nameable thing.

Pass build-time public vars as `build-args` (Next inlines `NEXT_PUBLIC_*` at
build time; setting them only at runtime bakes in `localhost`).

**On the VPS, one-time**, for a private image:
```
 echo 'ghp_xxx' | docker login ghcr.io -u OWNER --password-stdin   # leading space keeps it out of history
```
PAT needs **only** `read:packages`.

## First-deploy order that actually works
```
./deploy.sh
docker compose exec app npm run db:migrate             # drizzle-kit is NOT in the image
docker compose exec app npm run db:seed                # optional
docker compose restart app                             # REQUIRED after seeding
curl -s https://newapp.sapper.top/api/health
```

## Verify
```
docker compose logs -f app
docker logs coolify-proxy --tail 50 | grep -i acme     # cert issued?
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}'
free -h
```
Cert takes 10–30s on the first HTTPS request. Failures are DNS ~95% of the
time — but with the wildcard in place, that's rarely the cause here.

## Laptop convenience
```
ssh-copy-id root@82.41.67.6     # stop typing the root password
```
Then disable password auth entirely (only after key login is proven):
```
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh      # sshd -t FIRST, or risk lockout
```

Keep SSH alive on the laptop via `~/.ssh/config`:
```
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
```
Use `tmux new -s deploy` on the server so drops don't kill running commands.

## Security baseline (audited 2026-08-29)

What an external attacker can reach is only ever Traefik's 443. Verified from
off-box: `5432`, `6379` and `3000` are all closed to the internet, because the
compose file declares no `ports:` for Postgres, Redis or the app — Traefik
reaches the app over the shared `coolify` network instead. Keep it that way; the
moment you add a `ports:` mapping to a datastore you publish it to the world.

### Findings that were fixed in the app

| Finding | Risk | Fix |
| --- | --- | --- |
| Seeded `admin@auctioneer.dev` / `admin1234` existed on production | Anyone who guessed the pattern from the two public demo logins could sign in as the admin persona | `scripts/seed.ts` now randomises every non-showcase password per run (`PRIVATE_SEED_PASSWORD`, override with `SEED_PASSWORD`). Only `demo@` and `seller@` stay public, deliberately. |
| No security headers at all | Clickjacking, no HSTS, MIME sniffing, framework fingerprinting | `next.config.ts` now sets CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, and disables `poweredByHeader`. |
| Seller-supplied image URLs accepted plain `http://` | Mixed content, and the validation message promised https | `POST /api/lots` now accepts only `https://` or a site-relative `/path`. |
| 4 moderate esbuild advisories in the production tree | `drizzle-kit` arrives as an *optional peer of better-auth*, so it installs even under `--omit=dev` | **Not fixed — see below.** Schema work moved to `scripts/migrate.ts` so nothing at runtime calls drizzle-kit, but the package still ships. |

### The esbuild advisories: two fixes that both break the build

`npm audit` reports 4 moderate advisories, all from `drizzle-kit`'s abandoned
`@esbuild-kit/*` chain pinned to esbuild 0.18 (GHSA-67mh-4wv8-2f99). Do not
spend time on these without reading this first — both obvious fixes fail, and
each one costs a red CI build:

- **`overrides` pinning `@esbuild-kit/core-utils`'s esbuild** → `npm ci` dies
  with `Expected "0.28.2" but got "0.25.12"`. `drizzle-kit`'s nested `tsx`
  requires esbuild 0.28.2, and esbuild's postinstall runs the binary and
  compares versions. Note that `npm ci --dry-run` **passes** here, because it
  skips install scripts — it is not a valid check for this class of change.
- **`npm ci --omit=peer` in the prod-deps stage** → same error. The flag skips
  the nested esbuild's platform binary package, so the postinstall check
  resolves the hoisted esbuild 0.25.12 instead of its own.

The advisory is against esbuild's **dev server**, which requires `esbuild serve`
to be running. Nothing starts it, in the image or out of it. The package ships
unused. Verify any future attempt with a real `docker build`, not `npm ci
--dry-run`.

### What was already correct — do not regress it

- **Session cookies**: `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
  Better Auth sets these itself once it sees an https origin, which is why
  `BETTER_AUTH_URL` must be the real public URL.
- **Brute force**: Better Auth's built-in limiter is active in production with no
  configuration — measured at 3 attempts before `429`.
- **Authorization**: every mutating API route resolves the session server-side;
  `/api/health` is the only intentionally public one. Orders check
  `order.buyerId !== payerId`; the engine refuses `sellerId === bidderId`.
- **Socket rooms**: the private per-user room is joined server-side from the
  session (`socket.join(userRoom(socket.data.userId))`). There is no
  client-controlled join for it, so nobody can subscribe to another user's
  notifications. Chat is authenticated, truncated to 280 chars and rate-limited
  to 5 per 10s.
- **Injection**: no `dangerouslySetInnerHTML` anywhere; raw `sql` templates
  interpolate Drizzle column objects only, never user values.
- **Client bundle**: no secrets. The one `BETTER_AUTH_SECRET` string in a chunk
  is Better Auth's env-getter shim referencing the *name*.

### Known and accepted

- `POST /api/wallet/topup` credits up to $1,000,000 per call, unlimited times.
  There is no payment provider — the funding source is fictional by design. If
  this ever takes real money, that endpoint is the first thing to replace.
- CSP carries `script-src 'unsafe-inline'` because Next ships inline hydration
  bootstrap. The directives doing real work here are `frame-ancestors`,
  `object-src`, `base-uri` and `form-action`.

### Rotating the seeded passwords on a live database

Re-running the seed is the intended path — it truncates and rebuilds the
catalogue, and the new code will generate a fresh admin password and print it
once:

```bash
docker compose -f /opt/auctioneer/compose.prod.yml exec app npm run db:seed
```

## Schema changes: migrations, not push

`drizzle-kit` is a devDependency again, so `db:push` is not available in the
container. Generate migrations on the laptop and apply them on the server:

```bash
# laptop, after editing src/lib/db/schema.ts
npm run db:generate          # writes drizzle/NNNN_*.sql, commit it

# server, after the new image is pulled
docker compose -f /opt/auctioneer/compose.prod.yml exec app npm run db:migrate
```

**One-time baseline.** The live database was built with `drizzle-kit push`, so it
already has every table but no migration ledger. Running `db:migrate` against it
would try to `CREATE TABLE` things that exist. Mark the existing migrations as
applied without executing them, once:

```bash
docker compose -f /opt/auctioneer/compose.prod.yml exec -e BASELINE=1 app npm run db:migrate
```

After that, `db:migrate` behaves normally.

## Later (not urgent)
- Turn on Coolify's Docker Cleanup (retain 1–2 old images)
- Give valodex a `mem_limit` so it can't starve the box
- Reboot to clear `*** System restart required ***`; both apps are
  `restart: unless-stopped` and come back on their own
