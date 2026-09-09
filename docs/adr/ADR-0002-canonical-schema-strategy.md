# ADR-0002: Canonical Page Schema Strategy

**Status:** accepted  
**Date:** 2026-09-09  
**Deciders:** Platform architect

---

## Context

The Page Schema is the single contract between all subsystems: AI engine, editor, renderer, preview, publisher, persistence, and tests. We need a canonical source of truth that can generate type-safe validators and models for both TypeScript and Python.

**Options considered:**

1. **(a) Canonical JSON Schema → codegen → Zod + Pydantic + TS types**
   - JSON Schema as the source of truth
   - Generate Zod validators (TypeScript)
   - Generate Pydantic models (Python)
   - Generate TypeScript interfaces

2. **(b) Canonical Zod → derive JSON Schema → codegen Pydantic**
   - Zod as the source of truth
   - Derive JSON Schema from Zod
   - Generate Pydantic from JSON Schema

3. **(c) TypeSpec source → codegen all runtimes**
   - TypeSpec as the source of truth
   - Generate JSON Schema, Zod, Pydantic

---

## Decision

**We adopt option (a): Canonical JSON Schema → codegen → Zod + Pydantic + TS types**

---

## Rationale

### JSON Schema as source of truth

1. **Industry standard** — JSON Schema is the lingua franca for data validation
2. **Tooling maturity** — Excellent tooling for both TypeScript and Python ecosystems
3. **AI compatibility** — LLMs natively understand and can emit JSON Schema-constrained output
4. **Validation clarity** — L1 structural validation is directly expressible in JSON Schema
5. **Documentation** — JSON Schema serves as self-documenting API contract

### Why not Zod-first (option b)?

- Zod is TypeScript-specific; deriving JSON Schema from Zod adds a transformation step
- JSON Schema derived from Zod may lose information or nuances
- Python ecosystem doesn't have a direct Zod equivalent; requires JSON Schema as intermediate anyway

### Why not TypeSpec (option c)?

- TypeSpec is newer and less mature than JSON Schema
- Smaller ecosystem, fewer tools, fewer examples
- Adds a dependency on Microsoft's TypeSpec compiler

---

## Implementation

### Source files

```
packages/page-schema/
├── schema/                    # JSON Schema files (SOURCE OF TRUTH)
│   ├── envelope.schema.json   # Page document envelope
│   ├── sections/              # Section type schemas
│   │   ├── hero.schema.json
│   │   ├── features.schema.json
│   │   ├── cta.schema.json
│   │   ├── header.schema.json
│   │   └── footer.schema.json
│   ├── theme.schema.json      # Theme definition
│   └── assets.schema.json     # Asset model
```

### Codegen targets

```
packages/page-schema/
├── zod/                       # Generated Zod validators
│   ├── index.ts
│   ├── envelope.ts
│   ├── sections/
│   ├── theme.ts
│   └── assets.ts
├── pydantic/                  # Generated Pydantic models
│   ├── __init__.py
│   ├── envelope.py
│   ├── sections/
│   ├── theme.py
│   └── assets.py
└── types/                     # Generated TypeScript interfaces
    ├── index.ts
    ├── envelope.ts
    └── ...
```

### Codegen tooling

- **TypeScript:** `json-schema-to-zod` (npm package)
- **Python:** `datamodel-code-generator` (pip package)
- **CI check:** Compare generated output with committed output; fail on drift

### Versioning

- Schema version follows semver: `MAJOR.MINOR.PATCH`
- Every persisted PageVersion stores its `schemaVersion`
- CI asserts: generated artifacts match source schema

---

## Consequences

### Positive

✅ Single source of truth (JSON Schema) for all subsystems  
✅ Type-safe validation in both TypeScript and Python  
✅ AI can emit JSON Schema-constrained output natively  
✅ Self-documenting API contracts  
✅ Mature tooling and ecosystem  

### Negative

⚠️ JSON Schema verbosity (mitigated by codegen)  
⚠️ Two codegen steps (TS + Python) to maintain  
⚠️ CI drift check required to prevent divergence  

### Mitigations

- Codegen scripts run in CI; drift = build failure
- Generated files are committed (not .gitignored) for review
- Schema changes require ADR process (§4.8)

---

## References

- Master prompt §4.2 (Canonical schema strategy)
- Master prompt §4.4 (Document envelope)
- Master prompt §4.5 (Section anatomy)
- JSON Schema specification: https://json-schema.org/
- json-schema-to-zod: https://github.com/StefanTerdell/json-schema-to-zod
- datamodel-code-generator: https://github.com/koxudaxi/datamodel-code-generator
