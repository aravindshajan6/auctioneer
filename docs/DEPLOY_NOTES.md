# VPS Deployment Notes — sapper (HeavenCloud)

## Server
- 4 GB RAM / 48 GB disk (11 GB used, 37 GB free — no storage issue)
- 2 GB swapfile at /swap.img — KEEP IT (OOM insurance during builds)
- Ubuntu, hostname `sapper`, root SSH
- ufw INACTIVE — check whether HeavenCloud provides a cloud firewall
- Real constraint is RAM (~2.6 GB free after Coolify), not disk. Ceiling ~6-8 small apps.

## Existing setup — DO NOT BREAK
- Coolify installed, running valodex.sapper.top
- Coolify's Traefik owns ports 80/443. Do NOT install nginx/Caddy on those ports.

## Traefik (proxy) facts needed for labels
| Item | Value |
|---|---|
| Container | `coolify-proxy` |
| Version | traefik:v3.6 |
| Docker network | `coolify` (external) |
| Entrypoints | `http` (:80), `https` (:443) |
| Cert resolver | `letsencrypt` (HTTP-01 challenge) |
| exposedbydefault | `false` — containers must set traefik.enable=true |

## Plan for the new app (manual deploy, no Coolify)
Deploy as a plain `docker compose` stack that joins the `coolify` network and
carries Traefik labels. Manual pipeline, no Coolify UI, no Nixpacks, and TLS
is still issued automatically. valodex stays untouched.

Steps:
1. DNS A record: newapp.sapper.top -> VPS IP (`curl -4 ifconfig.me`);
   verify with `dig +short newapp.sapper.top` BEFORE first deploy
   (failed ACME challenges count against Let's Encrypt rate limits)
2. Code at /opt/newapp (outside /data/coolify so Coolify never touches it)
3. docker-compose.yml — see template below
4. deploy.sh: git pull --ff-only && docker compose build && docker compose up -d
5. Multi-stage Dockerfile (target ~300 MB, NOT the 2.3 GB Nixpacks builds)

## compose template
Replace `newapp`, the domain, and port 3000.
NOTE: no `ports:` section — Traefik reaches the app privately over the
`coolify` network, so the app is never directly internet-facing.
`loadbalancer.server.port` is the port INSIDE the container.

```yaml
name: newapp
networks:
  coolify:
    external: true
services:
  app:
    build: .
    container_name: newapp
    restart: unless-stopped
    networks: [coolify]
    env_file: [.env]
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
```

## Verify first deploy
```
docker compose logs -f app
docker logs coolify-proxy --tail 50 | grep -i acme   # cert issued?
```
Cert takes 10-30s on first request. Failures are DNS ~95% of the time.

## Later (not urgent)
- Move builds to GitHub Actions + GHCR so the 4 GB box only pulls
- Turn on Coolify's Docker Cleanup (retain 1-2 old images)

## SSH kept dropping — fixed via ~/.ssh/config on the laptop
```
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
```
Use `tmux new -s deploy` on the server so drops don't kill running commands.
