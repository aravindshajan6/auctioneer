# Deploying Auctioneer to sapper

Target: `https://auctioneer.sapper.top`, behind Coolify's existing Traefik,
without touching Coolify or valodex.

Everything below was rehearsed locally first: the image was built with no
secrets present, the full stack was brought up, the schema pushed, the
catalogue seeded, and the pages served. Three bugs were found that way and
fixed before this document existed.

**Legend:** 🖥 = run on your laptop · 🌐 = run on the VPS

---

## 0. Before anything: DNS

A failed ACME challenge counts against Let's Encrypt's rate limit, so prove
DNS resolves *before* the first deploy.

🌐 Get the IP:

```bash
curl -4 ifconfig.me
```

Create an **A record**: `auctioneer` → that IP, in the `sapper.top` zone.

🖥 Verify (must print the VPS IP, and may take a few minutes to propagate):

```bash
dig +short auctioneer.sapper.top
```

**Do not continue until this returns the right address.**

---

## 1. One-time server setup

🌐 Work inside tmux so an SSH drop cannot kill a running command:

```bash
tmux new -s deploy
```

🌐 Create the app directory, outside Coolify's tree so Coolify never manages it:

```bash
mkdir -p /opt/auctioneer && cd /opt/auctioneer
```

🌐 Authenticate to GHCR. The repo is private, so the image is too. Use a
GitHub PAT with **only** `read:packages`:

```bash
echo 'YOUR_PAT_HERE' | docker login ghcr.io -u aravindshajan6 --password-stdin
```

🌐 Fetch the deployment files (only these three are needed on the server):

```bash
curl -fsSLO https://raw.githubusercontent.com/aravindshajan6/auctioneer/main/docs/compose.prod.yml
mv compose.prod.yml docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/aravindshajan6/auctioneer/main/deploy.sh
curl -fsSL https://raw.githubusercontent.com/aravindshajan6/auctioneer/main/.env.production.example -o .env.example
chmod +x deploy.sh
```

> Private repo, so `curl` needs auth. If these 404, either clone with your SSH
> key (`git clone git@github.com:aravindshajan6/auctioneer.git /opt/auctioneer`)
> or paste the files by hand. Cloning is simpler and makes `git pull` available.

🌐 Create `.env` **in this directory** and fill it in:

```bash
cp .env.example .env
openssl rand -base64 32   # run twice: one for POSTGRES_PASSWORD, one for BETTER_AUTH_SECRET
nano .env
```

> **This file must sit beside `docker-compose.yml`.** Compose resolves
> `${POSTGRES_PASSWORD}` from a `.env` next to the compose file — *not* from
> the `env_file:` entry, which only injects variables into the container. Put
> it elsewhere and you get `required variable POSTGRES_PASSWORD is missing a
> value`, which does not explain itself.

`DATABASE_URL` must contain the same password you set in `POSTGRES_PASSWORD`.

---

## 2. First deploy

🖥 Push to `main`. GitHub Actions builds the image and pushes it to GHCR —
**the VPS never builds.** `next build` peaks around 1.7 GB and the box has
~2.6 GB free while running valodex; a build there is the one thing that could
realistically OOM it.

Watch the run finish under the repo's Actions tab before continuing.

🌐 Deploy:

```bash
cd /opt/auctioneer && ./deploy.sh
```

🌐 Create the schema (first deploy only):

```bash
docker compose exec app npx drizzle-kit push --force
```

🌐 Load the demo catalogue (optional; takes ~50s and fetches from museum APIs):

```bash
docker compose exec app npm run db:seed
docker compose restart app
```

> **The restart is required, not tidiness.** Next caches the `public/` file
> listing at boot. Seeding writes ~90 catalogue plates into the mounted volume
> afterwards, so without a restart every image 404s. Verified: 404 before,
> 200 after.

---

## 3. Verify

🌐 App logs — expect `▲ Auctioneer ready`, `◆ realtime gateway on /ws`,
`◷ scheduler running`:

```bash
docker compose logs -f app
```

🌐 Certificate issued? (10–30s after the first HTTPS request):

```bash
docker logs coolify-proxy --tail 100 | grep -i acme
```

🖥 Prove HTTPS end to end:

```bash
curl -I https://auctioneer.sapper.top
curl -s https://auctioneer.sapper.top/api/health
```

Healthy looks like:

```json
{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}
```

🌐 Confirm memory is within budget (~1.5 GB ceiling across the three):

```bash
docker stats --no-stream auctioneer auctioneer-postgres auctioneer-redis
```

Then sign in at `https://auctioneer.sapper.top/sign-in` with
`demo@auctioneer.dev` / `demo1234`.

---

## 4. Routine deploys

🖥 Push to `main`, wait for Actions, then:

🌐
```bash
cd /opt/auctioneer && ./deploy.sh
```

Only the changed layers are pulled — typically the ~45 MB app layer, not the
whole image, unless `package-lock.json` changed.

---

## 5. Rollback

Every build is tagged `sha-<short-commit>`, so rolling back names a specific
build rather than hoping:

🌐
```bash
cd /opt/auctioneer
cat .last-good-image          # written by deploy.sh before each deploy
./deploy.sh sha-abc1234       # redeploy that exact build
```

Database migrations are **not** rolled back. If a deploy changed the schema,
roll the schema back deliberately before pinning an older image.

---

## 6. When it breaks

**404 from Traefik** — Traefik did not match a route to your container.

```bash
docker inspect auctioneer --format '{{json .Config.Labels}}' | tr ',' '\n' | grep traefik
docker inspect auctioneer --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n' | grep -o coolify
```

Check: `traefik.enable=true` present (Traefik runs with
`exposedbydefault=false`, so without it your container is invisible); the
`Host()` rule matches exactly; the container really is on the `coolify`
network.

**502 from Traefik** — routing matched, the app did not answer.

```bash
docker compose ps
docker compose logs --tail 100 app
docker compose exec app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
```

Usually the app is crash-looping (read the logs) or
`loadbalancer.server.port` disagrees with the port the app listens on (3000).

**Certificate never issues** — almost always DNS. Re-check `dig +short
auctioneer.sapper.top`, and confirm the HTTP router is still enabled: it looks
redundant next to HTTPS, but Let's Encrypt answers the HTTP-01 challenge on
port 80, so removing it breaks issuance.

**Container restarting** — `docker compose logs app` shows the reason. A
`MODULE_NOT_FOUND` means a package used at runtime is still filed under
`devDependencies` and got pruned from the image.

---

## Safety notes

- Nothing here writes to `/data/coolify` or touches valodex, its containers,
  volumes, or Traefik's configuration.
- `deploy.sh` runs `docker image prune -f` — **dangling layers only**. Never
  run `docker system prune -a`: it would delete images belonging to valodex.
- Postgres and Redis are on a private `internal` network and are *not* on
  `coolify`, so no other container on the box can reach this database.
- No host ports are published. Traefik reaches the app over the Docker
  network, so it cannot collide with 80/443.
- Every service has `mem_limit` and a matching `memswap_limit`, so a runaway
  process fails on its own rather than exhausting host RAM or swap.
