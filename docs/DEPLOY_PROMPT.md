# Prompt to paste into the new project's Claude Code session

---

I want to deploy this app to my own VPS, manually over SSH, with no PaaS layer.
Read `DEPLOY_NOTES.md` in this repo first — it has the verified server facts.

## Context you must respect

My VPS (`sapper`, HeavenCloud): 4 GB RAM, 48 GB disk, Ubuntu, root SSH.
It already runs Coolify hosting a different app at valodex.sapper.top.
I am NOT deploying this new app through Coolify — I want a manual pipeline
I control and understand.

**The binding constraint is RAM, not disk.** ~2.6 GB is free after Coolify's
overhead. Optimize every decision for small memory and disk footprint.

## Hard constraints — do not violate these

1. **Coolify's Traefik owns ports 80 and 443.** Do NOT add nginx, Caddy, or any
   other reverse proxy. Do NOT publish container ports 80/443. Traffic reaches
   my app only through the existing Traefik.
2. **Do not modify anything under `/data/coolify`** or touch the running
   valodex app, its containers, images, volumes, or Traefik's config.
3. **Do not run `docker system prune -a`** or any broad cleanup — it can delete
   images belonging to the other app.
4. My code lives at `/opt/<appname>` on the server, outside Coolify's tree.
5. Traefik has `exposedbydefault=false`, so my container must explicitly set
   `traefik.enable=true` or it gets no routing at all.

## Step 1 — inspect before you write anything

Do not guess the stack. Read the actual project files to determine:
- Language, framework, package manager, lockfile
- The build command and the production start command
- **The exact port the app listens on**, and whether it binds `0.0.0.0`
  (binding only `127.0.0.1` will make it unreachable from Traefik — fix it)
- Runtime env vars and secrets it needs
- Whether it needs a database, and if so which

Tell me what you found and what port you're targeting before generating files.

## Step 2 — choose the deployment shape and justify it

**Option A — Docker Compose on the `coolify` network** (default choice).
Traefik auto-discovers via container labels. Most reliable, easiest TLS.

**Option B — bare systemd service, no container.**
Lighter on disk (no image layers) and slightly lighter on RAM. Traefik would
route to it via the file provider at `/data/coolify/proxy/dynamic/` pointing at
`host.docker.internal:<port>`. More moving parts, but minimal footprint.

Recommend one for MY specific stack and say why in two or three sentences.
Given the RAM constraint, seriously evaluate B — don't reflexively pick A.

## Step 3 — generate the files

For Option A:
- **`Dockerfile`** — multi-stage, slim/alpine base. Build deps must NOT reach
  the final image. Target under ~400 MB. My other app is 2.3 GB because Coolify
  used Nixpacks; do not repeat that. Run as a non-root user. Include a
  HEALTHCHECK.
- **`.dockerignore`** — aggressive. Must exclude `.git`, `node_modules`,
  build output, `.env`, tests, and local tooling.
- **`docker-compose.yml`** — use the template in `DEPLOY_NOTES.md`, filled in
  with my real app name, subdomain, and port. Add sensible `mem_limit` /
  `cpus` so a runaway process can't OOM the box and take valodex down.
- **`.env.example`** — every var documented, no real secrets.
- **`deploy.sh`** — git pull, build, up, prune dangling images only, show status.

For Option B: the systemd unit, the Traefik dynamic file, and the deploy script.

## Step 4 — give me the runbook

Exact commands in order, marked clearly as LOCAL vs ON THE VPS:
- DNS record I need to create, and how to verify it resolves before deploying
  (a failed ACME challenge counts against Let's Encrypt rate limits)
- First-time server setup
- The first deploy
- How to verify: app logs, cert issuance, and a curl that proves HTTPS works
- How to roll back if the deploy is bad
- What to check if I get a 404 (Traefik didn't match) vs 502 (app not reachable)

## Working rules

- **You do not have SSH access to the VPS. I run every server command myself.**
  Give me commands to paste; never assume one succeeded — wait for my output.
- Explain *why* for anything non-obvious, especially the Traefik labels. I want
  to understand this setup, not just copy it.
- Ask me before adding any dependency or service that runs on the VPS.
- Flag anything that could affect the existing valodex app before I run it.

Start with Step 1.
