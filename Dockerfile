# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Auctioneer
#
# Built in four stages so build tooling never reaches the final image. Note
# that Next's `output: "standalone"` — the usual way to slim this down — is
# NOT usable here: the app runs a custom server so the Socket.IO gateway and
# the auction scheduler share a process and a port with Next. The final image
# therefore carries a real production node_modules.
#
# Alpine is deliberate: it keeps the base near 60 MB. `libc6-compat` is
# required because Next's SWC binaries expect glibc symbols.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1

# --- All dependencies, for the build only ----------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Production dependencies, resolved separately so dev tooling is never
#     copied forward and never has to be pruned out again -------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next inlines NEXT_PUBLIC_* at BUILD time, so the public origin has to be
# known here or metadata URLs bake in localhost.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build
# The build cache is ~120 MB of incremental-compilation state with no runtime
# value. Dropped here rather than in the runner stage, because deleting a file
# in a later layer hides it without reclaiming the space.
RUN rm -rf .next/cache

# --- Runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs auctioneer

COPY --from=prod-deps --chown=auctioneer:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=auctioneer:nodejs /app/.next ./.next
COPY --chown=auctioneer:nodejs public ./public
# The entrypoint is TypeScript executed by tsx, so the sources ship too.
COPY --chown=auctioneer:nodejs server ./server
COPY --chown=auctioneer:nodejs src ./src
COPY --chown=auctioneer:nodejs scripts ./scripts
# The generated SQL migrations, applied at deploy time by scripts/migrate.ts.
COPY --chown=auctioneer:nodejs drizzle ./drizzle
COPY --chown=auctioneer:nodejs package.json next.config.ts tsconfig.json drizzle.config.ts ./

# Seeding writes catalogue art here at runtime; a volume is mounted over it.
RUN mkdir -p /app/public/lots && chown -R auctioneer:nodejs /app/public

USER auctioneer
EXPOSE 3000

# Reports degraded when Postgres or Redis stop answering, so a half-dead
# container is restarted rather than left serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
