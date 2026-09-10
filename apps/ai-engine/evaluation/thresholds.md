# Evaluation thresholds (PART IX section 9.2) — normative for the regression
# harness (`app/evaluation/regression.py`). Clocked by the harness on every
# run and by the nightly runner (`app/evaluation/nightly.py`).

| Metric | Threshold | Direction | Rationale |
| --- | --- | --- | --- |
| schema_validity_rate   | >= 0.99 | the higher the better | Every assembled page must be schema-valid; 1% headroom for infra noise. |
| render_success_rate    | >= 0.99 | the higher the better | A completed, renderable page per valid brief is the product's promise. |
| first_try_usable_rate  | >= 0.90 | the higher the better | 90% of pages must be usable without any repair attempt. |
| content_completeness   | >= 0.90 | the higher the better | All golden `required_sections` + `content_must_include` must survive. |
| visual_quality_score   | 0.85 - 0.90 | target band | Advisory judge mean (1-5 -> 0-1 normalized); band guards against score inflation. |
| repair_rate            | tracked   | lower is better | No hard gate; trended to catch model drift. |
| cost_per_successful_page | tracked | lower is better | Economics gate after budget calibration; not a per-run gate. |
| e2e latency p50/p95    | tracked   | lower is better | p50 target 60-90 s; drift trended, not gated (provider variance). |

## Gate behaviour (section 9.5)

- A run is BLOCKED when `schema_validity_rate`, `render_success_rate`,
  `first_try_usable_rate`, or `content_completeness` falls below target.
- A regression comparison (`regression.py compare before.json after.json`) is
  BLOCKED when any gated metric drops OR a new validation failure class
  (`ruleId`) appears.
- Judge + calibration numbers are advisory and never block. While the judge
  runs in stub (deterministic surrogate) mode, `advisory_ok` in the
  calibration result is `False` by construction (not calibrated).

## Measurement notes

- Stub provider latency is not representative; e2e latency figures are still
  recorded to keep the charts honest.
- `content_must_include` uses engine-deterministic strings (locale CTA labels +
  real nouns) so the metric measures the pipeline, not keyword luck.