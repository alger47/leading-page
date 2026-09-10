# Phase 11 - Regression Report

- Run: 2026-09-10T21:29:51+00:00
- Rubric: landing-page-quality@1.0.0
- Judge: stub (stub:runtime?not-calibrated) - advisory
- Cases: 37

## Metrics (PART IX section 9.2)

| Metric | Value | Target |
| --- | --- | --- |
| schema_validity_rate | 1.0000 | 0.9900 |
| render_success_rate | 1.0000 | 0.9900 |
| first_try_usable_rate | 1.0000 | 0.9000 |
| content_completeness | 1.0000 | 0.9000 |
| visual_quality_score | 4.0000 | - |
| repair_rate | 0.0000 | - |
| cost_per_successful_page | 0.0111 | - |
| cost_total_usd | 0.4106 | - |
| e2e_latency_ms_p50 | 6.0000 | - |
| e2e_latency_ms_p95 | 8.0000 | - |

## Per stage latency

| Stage | Attempts | Repairs | Cost (USD) | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| asset-planner | 37 | 0 | 0.003049 | 0.1 | 0.1 |
| brief-analyzer | 37 | 0 | 0.002470 | 0.1 | 0.2 |
| content-generator | 37 | 0 | 0.397587 | 0.1 | 0.3 |
| layout-planner | 37 | 0 | 0.002934 | 0.1 | 0.2 |
| page-planner | 37 | 0 | 0.004611 | 0.1 | 0.2 |

## Failure classes

none

## Gate

- Breaches: none

## Cases

| Case | Locale | Status | Valid | Repaired | Attempts | Cost | Judge ok | Usable | Missing req | Missing must |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agency-ar-001 | ar | COMPLETED | True | False | 5 | 0.013978 | True | True | - | - |
| agency-en-005 | en | COMPLETED | True | False | 5 | 0.010763 | True | True | - | - |
| agency-fr-001 | fr | COMPLETED | True | False | 5 | 0.012955 | True | True | - | - |
| ecommerce-ar-001 | ar | COMPLETED | True | False | 5 | 0.009946 | True | True | - | - |
| ecommerce-en-001 | en | COMPLETED | True | False | 5 | 0.010774 | True | True | - | - |
| ecommerce-fr-003 | fr | COMPLETED | True | False | 5 | 0.010988 | True | True | - | - |
| education-ar-004 | ar | COMPLETED | True | False | 5 | 0.009926 | True | True | - | - |
| education-en-001 | en | COMPLETED | True | False | 5 | 0.010801 | True | True | - | - |
| education-fr-001 | fr | COMPLETED | True | False | 5 | 0.010917 | True | True | - | - |
| gym-ar-002 | ar | COMPLETED | True | False | 5 | 0.009892 | True | True | - | - |
| gym-en-001 | en | COMPLETED | True | False | 5 | 0.010704 | True | True | - | - |
| gym-fr-001 | fr | COMPLETED | True | False | 5 | 0.011068 | True | True | - | - |
| hotel-ar-001 | ar | COMPLETED | True | False | 5 | 0.009912 | True | True | - | - |
| hotel-en-002 | en | COMPLETED | True | False | 5 | 0.010747 | True | True | - | - |
| hotel-fr-001 | fr | COMPLETED | True | False | 5 | 0.015711 | True | True | - | - |
| injection-en-006 | en | COMPLETED | True | False | 5 | 0.010817 | True | True | - | - |
| law-firm-ar-001 | ar | COMPLETED | True | False | 5 | 0.010118 | True | True | - | - |
| law-firm-en-003 | en | COMPLETED | True | False | 5 | 0.010823 | True | True | - | - |
| law-firm-fr-001 | fr | COMPLETED | True | False | 5 | 0.011165 | True | True | - | - |
| medical-clinic-ar-003 | ar | COMPLETED | True | False | 5 | 0.010150 | True | True | - | - |
| medical-clinic-en-001 | en | COMPLETED | True | False | 5 | 0.011010 | True | True | - | - |
| medical-clinic-fr-001 | fr | COMPLETED | True | False | 5 | 0.011214 | True | True | - | - |
| real-estate-ar-001 | ar | COMPLETED | True | False | 5 | 0.010151 | True | True | - | - |
| real-estate-en-001 | en | COMPLETED | True | False | 5 | 0.015366 | True | True | - | - |
| real-estate-fr-002 | fr | COMPLETED | True | False | 5 | 0.010935 | True | True | - | - |
| restaurant-ar-001 | ar | COMPLETED | True | False | 5 | 0.009945 | True | True | - | - |
| restaurant-en-001 | en | COMPLETED | True | False | 5 | 0.012894 | True | True | - | - |
| restaurant-fr-001 | fr | COMPLETED | True | False | 5 | 0.011025 | True | True | - | - |
| saas-ar-001 | ar | COMPLETED | True | False | 5 | 0.009911 | True | True | - | - |
| saas-en-001 | en | COMPLETED | True | False | 5 | 0.010789 | True | True | - | - |
| saas-fr-001 | fr | COMPLETED | True | False | 5 | 0.010982 | True | True | - | - |
| startup-ar-001 | ar | COMPLETED | True | False | 5 | 0.010084 | True | True | - | - |
| startup-en-004 | en | COMPLETED | True | False | 5 | 0.010790 | True | True | - | - |
| startup-fr-001 | fr | COMPLETED | True | False | 5 | 0.010966 | True | True | - | - |
| vet-ar-001 | ar | COMPLETED | True | False | 5 | 0.010155 | True | True | - | - |
| vet-en-001 | en | COMPLETED | True | False | 5 | 0.011025 | True | True | - | - |
| vet-fr-001 | fr | COMPLETED | True | False | 5 | 0.011248 | True | True | - | - |
