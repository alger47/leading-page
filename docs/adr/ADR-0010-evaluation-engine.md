# ADR-0010: Evaluation & Quality Engine — Golden Dataset, Rubrics, Advisory Judge, Regression Harness (J6)

- **Status:** Accepted (2026-09-10, evaluation phase)
- **Relates to:** ADR-0003 (engine architecture), master catalog "PHASE 11 —
  Evaluation & Quality Engine"; PART IX §9.2 (metrics) — 9.5 (regression gate).

## Context

J6 wants: a full golden dataset (12 verticals × ar/fr/en + adversarial cases),
versioned rubrics, a calibrated judge, a regression harness with before/after
reports, and a nightly run. Acceptance: one full regression report produced,
the metrics table live, thresholds documented — with an exit gate.

Two hard realities shape the design:

1. **Nobody can produce a "true quality" label without humans, and there is no
   human available in this environment.** A judge is only as honest as its
   calibration. We built the judge as an *advisory* scorer: a pinned-model LLM
   judge when an API key exists, and a clearly-labeled deterministic `StubJudge`
   otherwise. Every report states the judge mode; stub scores are explicit
   surrogates, never dressed up as calibrated human quality.
2. **The engine's stub provider is deliberately deterministic** — including its
   substring-based vertical detection (a Phase 4/5 constraint, not new). Golden
   expectations are therefore aligned to *achievable engine output*: the
   `content_must_include` policy uses strings the engine deterministically
   emits (locale CTA labels + real nouns), so content-completeness measures the
   pipeline honestly instead of grading keyword luck.

## Decision

**Evaluation is a first-class production toolchain inside the engine.**

- **Golden dataset:** `evaluation/golden/*.json` — 37 cases = 12 verticals ×
  {ar, fr, en} + `injection-en-006` (the Phase 5 injection case). Format:
  `{case_id, brief, locale, expect:{required_sections, forbidden_sections,
  content_must_include, max_sections, quality_criteria}}`. The Phase 5
  mini-eval acceptance lock moved from ≥10 to ≥36 cases.
- **Rubrics:** `evaluation/rubrics/rubric-v1.json`, loaded by
  `app/evaluation/rubric.py` (`Rubric.ref = "landing-page-quality@1.0.0"`,
  semver-validated). Seven criteria, anchored 1–5: structural correctness,
  semantic coherence, copy quality (locale-aware), CTA strength, visual
  composition, accessibility, SEO completeness.
- **Judge (advisory, PART IX §9.4):** `app/evaluation/judge.py`. One interface
  (`Judge.score(...)`) with two implementations:
  - `LLMJudge` — pinned model (routing model class `judge`, default
    `gpt-4o-mini` via `config/routing.yaml`), versioned prompt asset
    `judge-rubric@1.0.0`, `judge_scoring.input/output.json` schemas,
    temperature 0; `judge_ref = "{prompt.ref}::{provider.name}::{model}"`.
  - `StubJudge` — deterministic rule-based surrogate, ref
    `stub:runtime?not-calibrated`, used in dev/CI and whenever the provider has
    no credentials.
  - `create_judge(container)` resolves routing → provider; `RoutingConfigError`
    or `stub` provider ⇒ `StubJudge`. Judge/provider failures are *recorded* in
    the score (`error` field), never propagated as a hard gate failure.
- **Calibration (advisory):** `evaluation/calibration/human-labels.json` +
  `app/evaluation/calibration.py` — MAE + bias per criterion vs. a small
  human-labeled sample. Above `MAX_ADVISORY_MAE=0.5`, judge scores must not
  drive trend decisions on their own. Stub judge ⇒ `advisory_ok` always False
  (not calibrated by construction).
- **Regression harness (§9.2 metrics):** `app/evaluation/regression.py` — a
  CLI + library that runs the golden set through the pipeline, scores each page
  with the judge, computes `schema_validity_rate`, `render_success_rate`,
  `first_try_usable_rate`, `content_completeness`, visual quality (judge mean),
  `repair_rate`, cost-per-successful-page, and stage/e2e latency p50/p95; writes
  `reports/phase11-regression-<ts>.md/.json` and refreshes `metrics-live`
  md/json.
- **Thresholds:** `evaluation/thresholds.md` — validity/render/usable ≥ 0.99 /
  0.99 / 0.90, completeness ≥ 0.90, visual target band 85–90% (judge mean
  1-5→0-1), the rest trended. §9.5 gate: compare is BLOCKED when a gated metric
  drops or a new validation failure class (`ruleId`) appears.
- **Nightly:** `app/evaluation/nightly.py` — `python -m app.evaluation.nightly`
  runs the full regression + re-judges the human-labeled sample, writes
  `calibration-live.json`, exits non-zero on any threshold breach (CI/compose
  scheduling).
- **Exit gate test for Phase 11:** full `pytest` suite + `mypy app` + `ruff
  check .` green; one full regression report produced (37/37 COMPLETED, all
  gated metrics 1.0000/Ω 0.99 targets, zero breaches, stub judge).

## Consequences

**Positive** — quality is now *measured and trended* (lines, not guesses); the
golden set is bigger than the Phase 5 stub and every case is verified against
actual engine output; a real LLM judge slots into the same `create_judge` seam
the moment a key exists — with calibration reporting whether it can be
trusted, while the stub keeps CI deterministic and offline; the §9.5 before/after
gate protects merges from silent metric drift exactly when a new failure class
appears.

**Trade-offs / notes** — judge + calibration numbers are advisory by policy
(PART IX: "advisory scoring, recorded and trended"); the LLM judge path is not
exercised end-to-end in CI (no key) and is covered by fake-provider tests. Stub
latency is not representative of real providers — recorded anyway to keep the
charts honest. `content_must_include` deliberately uses engine deterministic
strings; replacing the stub with real models is expected to move this metric,
which is the point of having the harness.