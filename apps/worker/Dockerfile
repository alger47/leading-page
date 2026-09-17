# syntax=docker/dockerfile:1
#
# @landing-ai/worker — production image (Phase 15).
# Build from the REPO ROOT so pnpm resolves the workspace:
#   docker build -f apps/worker/Dockerfile -t landing-ai-worker .
#
# The worker consumes @landing-ai/telemetry and the BullMQ/Redis driver.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------- builder
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo build --filter @landing-ai/worker

# ----------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/worker ./apps/worker
COPY package.json pnpm-workspace.yaml ./
WORKDIR /repo/apps/worker
EXPOSE 8080
CMD ["pnpm", "start"]
