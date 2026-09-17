# syntax=docker/dockerfile:1
#
# @landing-ai/web — production image (Phase 15).
# Build from the REPO ROOT so pnpm resolves the workspace:
#   docker build -f apps/web/Dockerfile -t landing-ai-web .
#
# The build mirrors render.yaml: prisma client generation, then the turbo
# build graph for the web app (which builds every workspace dependency first).

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- builder
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Prisma client for @landing-ai/database (no DB connection needed to generate).
RUN pnpm --filter @landing-ai/database generate
RUN pnpm exec turbo build --filter @landing-ai/web

# ----------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps ./apps
COPY package.json pnpm-workspace.yaml ./
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
