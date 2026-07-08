# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (incl. devDependencies needed to build) ----
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: generate prisma client, build Next.js (standalone), compile the ingest script ----
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build
# Next.js standalone output only bundles app/lib/route code; public/ is optional
# in this repo but the standard Dockerfile COPY below expects it to exist.
RUN mkdir -p public
# The daily ingest CronJob must run in a production image that has no
# devDependencies (tsx is a devDependency and is intentionally NOT shipped
# to the runner stage). Compile scripts/ingest-daily.ts to a self-contained
# plain-JS bundle with esbuild instead, resolving the "@/*" path alias at
# bundle time. @prisma/client is kept external (native query engine
# binaries must not be bundled) and ships via the pruned node_modules
# copied into the runner below.
RUN pnpm exec esbuild scripts/ingest-daily.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external \
      --outfile=dist/ingest-daily.mjs
# One-off history backfill (watchlist/holdings symbols only); run manually in a
# pod via `node dist/backfill-history.mjs` after deploy. Same bundling rationale
# as ingest-daily above.
RUN pnpm exec esbuild scripts/backfill-history.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external \
      --outfile=dist/backfill-history.mjs
# FinMind 全市場歷史回填(一次性);於 pod 內 `node dist/backfill-finmind.mjs` 執行,
# 需 FINMIND_TOKEN 與 DATABASE_URL。Same bundling rationale as ingest-daily above.
RUN pnpm exec esbuild scripts/backfill-finmind.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external \
      --outfile=dist/backfill-finmind.mjs
# Strip devDependencies (tsx, typescript, vitest, esbuild, prisma CLI, ...)
# now that build artifacts (.next/standalone, dist/ingest-daily.mjs) exist.
# pnpm keeps @prisma/client's generated engine/client inside its content
# store (node_modules/.pnpm/...) with symlinks from node_modules/@prisma;
# pruning + copying the whole node_modules tree (instead of hand-picking
# node_modules/.prisma or node_modules/@prisma) keeps those symlinks valid.
RUN pnpm prune --prod

# ---- runner: minimal production image, serves the web app and the compiled ingest script ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Production-only node_modules (see pnpm prune above) — provides @prisma/client
# (incl. generated engine) for both the web server and the compiled ingest script.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Compiled daily-ingest script (see esbuild step above); run by the GKE
# CronJob via `node dist/ingest-daily.mjs`.
COPY --from=builder /app/dist ./dist
# Prisma schema + migrations, so `prisma migrate deploy` can run in-cluster
# as a Kubernetes initContainer on every deploy (forward-only, non-destructive).
# The prisma CLI itself ships via node_modules (moved to dependencies so
# `pnpm prune --prod` above keeps it).
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]
