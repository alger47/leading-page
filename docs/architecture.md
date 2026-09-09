# Architecture — AI Landing Page Generation Platform

**Date:** 2026-09-09  
**Status:** Greenfield — to be implemented per master prompt

---

## 1. System Overview

A schema-driven, AI-native platform that converts natural-language business briefs into production-grade landing pages through a versioned intermediate representation (Page Schema) rendered by a deterministic system.

**Core flow:**
```
User Brief → AI Engine → Page Schema → Validation → Renderer → Preview → Publish
```

---

## 2. Monorepo Structure

```
landing-ai-platform/
├── apps/
│   ├── web/                    # Next.js 14+ (App Router)
│   │   ├── app/                # Routes: marketing, dashboard, editor, published
│   │   ├── components/         # App-level components
│   │   ├── lib/                # Utilities, API clients
│   │   ├── hooks/              # React hooks
│   │   ├── store/              # Zustand (editor state only)
│   │   └── styles/             # Global styles, Tailwind config
│   │
│   ├── worker/                 # BullMQ job orchestration
│   │   ├── queues/             # Queue definitions
│   │   ├── processors/         # Job handlers
│   │   ├── clients/            # AI engine client, storage client
│   │   └── events/             # Event emitters
│   │
│   └── ai-engine/              # FastAPI (Python)
│       ├── api/                # Internal API routes
│       ├── services/           # Pipeline stages
│       ├── schemas/            # Pydantic models
│       ├── clients/            # LLM provider clients
│       ├── prompts/            # Versioned prompt assets
│       ├── evaluators/         # Golden dataset, rubrics
│       └── tests/              # AI engine tests
│
├── packages/
│   ├── page-schema/            # THE canonical contract
│   │   ├── schema/             # JSON Schema definitions
│   │   ├── zod/                # Generated Zod validators
│   │   ├── pydantic/           # Generated Pydantic models
│   │   ├── validators/         # L1 + L2 validation logic
│   │   ├── migrations/         # Schema migration functions
│   │   └── examples/           # Valid/invalid fixtures
│   │
│   ├── design-system/          # Design tokens & primitives
│   │   ├── tokens/             # Color, font, space, radius, shadow
│   │   ├── themes/             # Theme presets (validated)
│   │   ├── typography/         # Font stacks, Arabic-first
│   │   ├── rtl/                # RTL utilities & helpers
│   │   └── primitives/         # Base UI primitives
│   │
│   ├── ui-components/          # Section components
│   │   ├── sections/           # Hero, features, CTA, etc.
│   │   ├── primitives/         # Button, Card, Container
│   │   ├── Renderer.tsx        # Schema → DOM renderer
│   │   └── registry.ts         # Component registry
│   │
│   ├── editor-ui/              # Schema-level editor
│   │   ├── canvas/             # Visual canvas
│   │   ├── panels/             # Edit panels
│   │   ├── toolbar/            # Editor toolbar
│   │   └── inspectors/         # Property inspectors
│   │
│   ├── database/               # Persistence layer
│   │   ├── prisma/             # Schema, migrations
│   │   ├── client.ts           # Prisma client
│   │   └── repositories/       # Tenant-scoped data access
│   │
│   ├── queue-contracts/        # Job & event types (TS)
│   ├── ai-contracts/           # Engine DTOs (TS + Pydantic)
│   ├── shared-types/           # Common type definitions
│   ├── config/                 # Shared configuration
│   └── telemetry/              # Logging, metrics, tracing
│
├── infra/                      # Infrastructure
│   ├── docker/                 # Dockerfiles
│   ├── docker-compose.yml      # Dev environment
│   ├── redis/                  # Redis config
│   └── postgres/               # Postgres config
│
├── docs/                       # Documentation
│   ├── adr/                    # Architecture Decision Records
│   ├── MASTER_PROMPT.md        # Source of truth
│   ├── discovery-report.md     # Phase 1 output
│   ├── architecture.md         # This file
│   └── walkthrough.md          # Phase-by-phase log
│
├── scripts/                    # Build, seed, utilities
├── tests/                      # E2E, shared test utilities
├── turbo.json                  # Turborepo config
├── pnpm-workspace.yaml         # Workspace definition
├── tsconfig.base.json          # Base TypeScript config
├── .env.example                # Environment template
└── README.md
```

---

## 3. Package Dependency Rules (CI-Enforced, Acyclic)

| Package | Owns | May depend on | Must NEVER depend on |
|---------|------|---------------|---------------------|
| page-schema | Canonical schema, versions, validators, fixtures | nothing | anything |
| design-system | Tokens, themes, typography, RTL rules | page-schema (types) | React apps, editor |
| ui-components | Section components, registry, Renderer | page-schema, design-system | editor, web app |
| editor-ui | Canvas, panels, inspectors | page-schema, ui-components, design-system | web app internals |
| database | Prisma schema, migrations, repositories | page-schema (types) | UI packages |
| queue-contracts | Job/event payload types | page-schema, shared-types | app code |
| ai-contracts | Engine DTOs (TS + Pydantic mirror) | page-schema | app internals |
| telemetry | Logging, metrics, tracing helpers | shared-types | business logic |
| apps/web | Marketing, dashboard, editor host, API routes | all packages | ai-engine internals |
| apps/worker | Queues, processors | queue-contracts, ai-contracts, database, telemetry | React code |
| apps/ai-engine | Pipeline, prompts, evaluators | page-schema (Pydantic), telemetry | web, worker internals |

**Violation = CI failure. No exceptions.**

---

## 4. Trust Boundaries

| Boundary | Trust Level | Handling |
|----------|-------------|----------|
| User briefs | Untrusted | Length caps, injection framing, L0 validation |
| AI output | Untrusted | L1/L2 validation, sanitization, data-only rendering |
| Stock/AI assets | Untrusted | Validation, safe fetch, storage, no hotlinking |
| Published pages | Public internet | Isolated runtime, zero dashboard/editor JS |
| Worker ↔ AI Engine | Internal | Service tokens, timeouts, bounded payloads |

---

## 5. Technology Stack

| Concern | Default | Notes |
|---------|---------|-------|
| Web | Next.js 14+ (App Router) + TypeScript + React | SSR-first, minimal hydration |
| Styling | Tailwind + Design tokens | Logical CSS properties only (RTL) |
| State | Local/server state; Zustand for editor only | Minimize client state |
| Database | PostgreSQL + Prisma | Forward-only migrations |
| Queue | Redis + BullMQ | Job orchestration |
| AI Engine | Python 3.11+ + FastAPI + Pydantic | Stateless, HTTP API |
| Web → Worker | Queue (BullMQ) | Async job creation |
| Worker → AI Engine | HTTP (JSON) | Authenticated, timeout-bounded |
| Package manager | pnpm | Workspaces |
| Monorepo | Turborepo | Build orchestration |
| Testing | Vitest + pytest + Playwright | Per-layer strategy |

---

## 6. Runtime Topology (Development)

```
┌─────────────────────────────────────────────────────────────┐
│                     DEVELOPMENT ENVIRONMENT                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  Next.js    │    │   FastAPI   │    │   Worker    │    │
│  │  :3000      │    │   :8000     │    │  (BullMQ)   │    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │
│         │                  │                  │            │
│         └──────────────────┼──────────────────┘            │
│                            │                               │
│                    ┌───────┴───────┐                       │
│                    │    Redis      │                       │
│                    │    :6379      │                       │
│                    └───────┬───────┘                       │
│                            │                               │
│                    ┌───────┴───────┐                       │
│                    │  PostgreSQL   │                       │
│                    │    :5432      │                       │
│                    └───────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Synchronous vs Asynchronous

| Operation | Mode | Reason |
|-----------|------|--------|
| Auth | Sync | Must complete in request scope |
| Project CRUD | Sync | Simple database operations |
| Schema validation | Sync | Deterministic, fast |
| Preview render | Sync | Same renderer as production |
| Publish trigger | Sync | Initiate, return immediately |
| **Full generation** | **Async** | Multi-stage AI pipeline |
| **Section regeneration** | **Async** | AI involvement |
| **Asset generation/fetching** | **Async** | External providers, retries |
| **Publishing pipeline** | **Async** | Multi-step, may fail |

**Rule:** Anything that can exceed a few seconds, call an external provider, or retry MUST be a job. Never run AI orchestration inside a normal HTTP request.

---

## 8. Data Model

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌───────────────┐
│  User   │────<│ Project  │────<│   Page   │────<│  PageVersion  │
└─────────┘     └──────────┘     └──────────┘     └───────────────┘
                     │                │                   │
                     │                │                   │
                     └────< GenerationJob                  ├────< PublishedPage
                              │                            │            │
                              └────< GenerationAttempt     │     Subdomain
                                                          │
                                                     Asset
```

**Key rules:**
- PageVersion is immutable (new version = new row)
- GenerationJob status: QUEUED → RUNNING → VALIDATING → RENDERING → COMPLETED/FAILED
- Tenant scoping on every repository call
- Optimistic concurrency for drafts

---

## 9. Validation Layers

| Layer | Name | Runs on | Gate Effect |
|-------|------|---------|-------------|
| L0 | Brief validation | Brief text | Blocks job start |
| L1 | Structural | Page Schema JSON | Blocks render |
| L2 | Semantic | Page Schema | Blocks render/publish |
| L3 | Visual | Rendered page | Blocks publish |
| L4 | Editorial | Content quality | Advisory (MVP) |

---

## 10. Security Architecture

**Headers (published pages):**
- Strict CSP (reviewed per component)
- HSTS
- frame-ancestors: DENY
- X-Content-Type-Options: nosniff

**Cookies:**
- httpOnly: true
- sameSite: strict
- secure: true (production)

**Auth:**
- Session-based (dashboard)
- Service tokens (worker ↔ engine)

**AI Output Sanitization:**
```
validated (L1) → sanitized (URL policy, length caps) → rendered as data → telemetry
```

---

## 11. Performance Budgets

| Metric | Target |
|--------|--------|
| JS on published pages | ≤ 90 KB gzipped (excluding images) |
| LCP | < 2.5s (mid-tier mobile) |
| CLS | < 0.1 |
| INP | < 200ms |
| Images | AVIF/WebP + srcset, lazy below fold |
| Isolation | Zero editor/dashboard JS on published routes |

---

## 12. Observability

**Correlation ID:** Every log/trace/metric carries generation_id, stage, attempt, project_id, user_id.

**Metrics catalog:**
- generation_jobs_total{status}
- generation_stage_seconds{stage}
- ai_attempts_total{stage, outcome}
- ai_tokens{model, direction}
- ai_cost_usd{model}
- validation_failures_total{layer, ruleId}
- render_fallbacks_total{sectionType}

**Tracing:** One span per pipeline stage (OTLP-compatible).

---

## 13. Testing Strategy

| Layer | Scope | Tooling |
|-------|-------|---------|
| Unit | Validators, rules engine, SchemaBuilder | Vitest / pytest |
| Contract | Schema fixtures, registry↔schema lockstep | Vitest / pytest |
| Component | Every registry component × variant × locale | Testing Library |
| Visual regression | Screenshots per section/variant/theme | Playwright |
| Integration | Worker + stubbed AI engine, DB repos | Vitest + testcontainers |
| AI evaluation | Golden dataset + rubrics | pytest + eval harness |
| E2E | J1, J2, J5 (AI stubbed in CI) | Playwright |
| Security | Authz, tenant isolation, URL policy | Automated checks |

---

## 14. Deployment Architecture

**Development:**
- Docker Compose (Redis, PostgreSQL)
- Local processes (Next.js, FastAPI, Worker)

**Production (future):**
- Container orchestration (Docker Compose → platform TBD)
- PostgreSQL managed service
- Redis managed service
- CDN for published pages
- Object storage for assets

---

**Phase 1 — COMPLETE**

Awaiting: **"continue"** → Phase 2 — Page Schema Foundation
