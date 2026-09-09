# Discovery Report — AI Landing Page Generation Platform

**Date:** 2026-09-09  
**Status:** Greenfield project — no existing codebase

---

## A. What currently exists

The repository contains only the master prompt document (GIDE.txt) and planning files. This is a **greenfield project** with zero existing code, configuration, or infrastructure.

**Files present:**
- `GIDE.txt` — Master prompt (copied to `docs/MASTER_PROMPT.md`)
- `CHANGELOG.txt` — Change documentation (empty)
- `NOTES.txt` — Project notes (empty)
- `docs/MASTER_PROMPT.md` — Copy of master prompt

**No existing:**
- Source code
- Package configuration
- Database schemas
- Docker/infrastructure files
- CI/CD pipelines
- Tests
- Documentation beyond the master prompt

---

## B. What is reusable

Nothing from the repository itself. However, the master prompt provides:

- **Complete architecture specification** — monorepo structure, package boundaries, dependency rules
- **Technology stack decision** — Next.js, FastAPI, PostgreSQL, Redis, BullMQ
- **Page Schema contract** — section taxonomy, slot types, validation rules
- **Testing strategy** — golden dataset, rubrics, visual regression
- **Security model** — trust boundaries, threat model, sanitization pipeline
- **18-phase execution plan** with clear acceptance criteria

---

## C. What is missing

Everything required for implementation:

| Category | Missing |
|----------|---------|
| **Infrastructure** | Docker Compose, Redis, PostgreSQL configuration |
| **Monorepo** | pnpm workspace, turbo.json, tsconfig.base.json |
| **Web App** | Next.js application, API routes, dashboard |
| **AI Engine** | FastAPI service, prompt files, provider abstraction |
| **Worker** | BullMQ queues, processors, job orchestration |
| **Database** | Prisma schema, migrations, repositories |
| **Page Schema** | Canonical JSON Schema, Zod/Pydantic codegen, fixtures |
| **Design System** | Tokens, themes, typography, RTL primitives |
| **UI Components** | Section components, registry, Renderer |
| **Editor** | Schema-level editing interface |
| **Publishing** | Subdomain routing, CDN, cache |
| **Testing** | Unit, integration, visual regression, evaluation |
| **Documentation** | Architecture docs, ADRs, walkthrough |
| **CI/CD** | GitHub Actions, lint, typecheck, test pipelines |

---

## D. What should be refactored

N/A — no existing code to refactor.

---

## E. What should be removed

N/A — nothing to remove.

---

## F. Target architecture

```
landing-ai-platform/
├── apps/
│   ├── web/                    # Next.js (App Router)
│   ├── worker/                 # BullMQ orchestration
│   └── ai-engine/              # FastAPI, Python
├── packages/
│   ├── page-schema/            # THE contract
│   ├── design-system/          # Tokens, themes, typography
│   ├── ui-components/          # Section components, Renderer
│   ├── editor-ui/              # Canvas, panels, inspectors
│   ├── database/               # Prisma, migrations
│   ├── queue-contracts/        # Job types (TS)
│   ├── ai-contracts/           # Engine DTOs (TS + Pydantic)
│   ├── shared-types/           # Common types
│   ├── config/                 # Shared configuration
│   └── telemetry/              # Logging, metrics
├── infra/                      # Docker, Redis, Postgres
├── docs/                       # Documentation tree
├── scripts/                    # Build, seed, utilities
└── tests/                      # E2E, fixtures
```

**Trust boundaries:**
- User briefs → untrusted
- AI output → untrusted until validated
- Published pages → isolated runtime (zero dashboard JS)
- Worker ↔ AI Engine → internal, authenticated

---

## G. Page Schema strategy

**Recommendation:** Start with (a) Canonical JSON Schema → codegen → Zod + Pydantic + TS types

**Rationale:**
- JSON Schema is the lingua franca for validation
- Tooling mature for both TypeScript (zod-schema-codegen) and Python (pydantic)
- Supports the strict validation requirements (L1 structural)
- Enables the repair ladder (validation errors fed back to AI)

**ADR-0002** will formalize this decision in Phase 2.

---

## H. AI pipeline strategy

**9-stage pipeline (as specified in master prompt):**

1. BriefAnalyzer → 2. PagePlanner → 3. LayoutPlanner → 4. ContentGenerator → 5. AssetPlanner → 6. AssetResolver → 7. SchemaBuilder → 8. Validators → 9. Refinements

**Key decisions:**
- Stages 4 (ContentGenerator) and 6 (AssetResolver) run in parallel
- SchemaBuilder (stage 7) is deterministic code — never LLM
- Repair ladder: validate → retry → re-ask → repair → fallback → fail honestly
- Provider abstraction: model-agnostic, configured not coded

**MVP model choice:** Deferred — will evaluate after Phase 4 implementation.

---

## I. Database strategy

**Stack:** PostgreSQL + Prisma ORM

**Entity model:**
```
User → Project → Page → PageVersion
                     → Asset
Project → GenerationJob → GenerationAttempt
PageVersion → PublishedPage → Subdomain
```

**Key constraints:**
- PageVersion immutable (new version = new row)
- Tenant-scoped repositories (ownership filter on every query)
- Optimistic concurrency for drafts
- Soft delete where recovery matters

---

## J. Security risks

| Risk | Mitigation |
|------|------------|
| Prompt injection via brief | Brief framed as data, instruction hierarchy, schema-constrained output |
| XSS via AI content | Slots are text-only, escape at render, no dangerouslySetInnerHTML |
| Malicious URLs | Scheme allowlist, host policy, rel="noopener" |
| SSRF via asset fetching | Egress allowlist, no internal ranges, redirect limits |
| IDOR | Ownership scoping on every access + tests |
| Tenant leakage | Tenant-bound cache keys, queue payload carries tenant |
| Unsafe uploads | Type sniffing, size caps, image re-encode |
| Cost abuse | Auth-gated quotas, rate limits, per-job budgets |

**Immediate actions required:**
- Establish security baseline before any user-facing features
- Implement URL policy validator early (used by multiple subsystems)
- Plan for LLM output sanitization pipeline from day one

---

## K. Migration strategy

**N/A — greenfield project.**

However, migration strategy is built into the architecture:
- Page Schema versioning with semver
- Migration functions: `migrate(old) → new` over historical data
- Published pages keep rendering with their original schema version
- Forward-only Prisma migrations in MVP

---

## L. Recommended phase sequence

Per master prompt Phase 15.4 (18 phases):

| Phase | Name | Priority |
|-------|------|----------|
| 0 | Protocol bootstrap | ✅ Done |
| 1 | Deep discovery | ✅ This document |
| 2 | Page Schema foundation | Next |
| 3 | Design system + Renderer | — |
| 4 | AI Engine | — |
| 5 | Worker & job orchestration | — |
| 6 | Database & persistence | — |
| 7 | Web application | — |
| 8 | Editor (schema-level) | — |
| 9 | Versioning | — |
| 10 | Publishing | — |
| 11 | Evaluation & quality engine | — |
| 12 | Visual QA automation | — |
| 13 | Performance | — |
| 14 | Security audit | — |
| 15 | Production readiness | — |

**Week-1 critical validation loop:**
Before ANY platform work, build the thinnest vertical slice:
```
brief → AI (stages 1–7) → schema → validate → render → preview
```
Run against 20–50 diverse briefs. If reliable → proceed. If not → iterate.

---

## M. Major risks and dependencies

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Greenfield complexity | High | High | Strict MVP scope, phase gates |
| AI output quality | High | Medium | Golden dataset, evaluation suite |
| RTL implementation | Medium | Medium | Arabic-first design from day one |
| Provider reliability | Medium | Medium | Multi-provider abstraction, circuit breaker |
| Schema evolution | High | Low | Versioning, migration functions, ADR process |
| Performance targets | Medium | Medium | Measure from day one, optimize only measured |

**External dependencies:**
- AI provider APIs (OpenAI, Anthropic, Google, Stability AI)
- Stock photo APIs (Unsplash, Pexels)
- Redis (queue, cache)
- PostgreSQL (persistence)
- Object storage (asset storage, CDN)

---

**Phase 1 — COMPLETE**

Awaiting: **"continue"** → Phase 2 — Page Schema Foundation
