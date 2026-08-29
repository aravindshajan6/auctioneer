#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Auctioneer deploy. Run ON THE VPS from /opt/auctioneer.
#
# Pulls a pre-built image rather than building here: the build peaks around
# 1.7 GB and this box has ~2.6 GB free alongside valodex.
#
#   ./deploy.sh              -> deploy :latest
#   ./deploy.sh sha-abc1234  -> deploy a specific tag (this is your rollback)
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"

TAG="${1:-latest}"
IMAGE="ghcr.io/aravindshajan6/auctioneer:${TAG}"

echo "==> Deploying ${IMAGE}"

if [ ! -f .env ]; then
  echo "!! .env is missing. Copy .env.production.example to .env and fill it in."
  exit 1
fi

echo "==> Recording the currently running image (for rollback)"
docker inspect --format '{{.Config.Image}}' auctioneer 2>/dev/null | tee .last-good-image || true

echo "==> Pulling"
APP_IMAGE="$IMAGE" docker compose -f docker-compose.yml pull app

echo "==> Starting"
APP_IMAGE="$IMAGE" docker compose -f docker-compose.yml up -d

echo "==> Waiting for health"
for i in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Health.Status}}' auctioneer 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && { echo "    healthy after ${i}0s"; break; }
  [ "$state" = "unhealthy" ] && { echo "!! unhealthy — see: docker compose logs app"; exit 1; }
  sleep 10
done

# Only dangling layers, never `-a`: a broad prune would delete images
# belonging to valodex.
echo "==> Removing dangling layers only"
docker image prune -f

echo "==> Status"
docker compose ps
echo "==> Memory"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}' \
  auctioneer auctioneer-postgres auctioneer-redis 2>/dev/null || true
