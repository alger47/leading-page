# Phase 11 - Regression Report

- Run: 2026-09-10T09:54:47+00:00
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
| cost_per_successful_page | 0.0106 | - |
| cost_total_usd | 0.3929 | - |
| e2e_latency_ms_p50 | 4.0000 | - |
| e2e_latency_ms_p95 | 7.0000 | - |

## Per stage latency

| Stage | Attempts | Repairs | Cost (USD) | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| asset-planner | 37 | 0 | 0.002997 | 0.1 | 0.1 |
| brief-analyzer | 37 | 0 | 0.002470 | 0.1 | 0.2 |
| content-generator | 37 | 0 | 0.380088 | 0.1 | 0.2 |
| layout-planner | 37 | 0 | 0.002868 | 0.1 | 0.1 |
| page-planner | 37 | 0 | 0.004464 | 0.1 | 0.1 |

## Failure classes

none

## Gate

- Breaches: none

## Cases

| Case | Locale | Status | Valid | Repaired | Attempts | Cost | Judge ok | Usable | Missing req | Missing must |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agency-ar-001 | ar | COMPLETED | True | False | 5 | 0.009931 | True | True | - | - |
| agency-en-005 | en | COMPLETED | True | False | 5 | 0.010748 | True | True | - | - |
| agency-fr-001 | fr | COMPLETED | True | False | 5 | 0.010925 | True | True | - | - |
| ecommerce-ar-001 | ar | COMPLETED | True | False | 5 | 0.009931 | True | True | - | - |
| ecommerce-en-001 | en | COMPLETED | True | False | 5 | 0.010760 | True | True | - | - |
| ecommerce-fr-003 | fr | COMPLETED | True | False | 5 | 0.010973 | True | True | - | - |
| education-ar-004 | ar | COMPLETED | True | False | 5 | 0.009911 | True | True | - | - |
| education-en-001 | en | COMPLETED | True | False | 5 | 0.010789 | True | True | - | - |
| education-fr-001 | fr | COMPLETED | True | False | 5 | 0.010902 | True | True | - | - |
| gym-ar-002 | ar | COMPLETED | True | False | 5 | 0.009877 | True | True | - | - |
| gym-en-001 | en | COMPLETED | True | False | 5 | 0.010689 | True | True | - | - |
| gym-fr-001 | fr | COMPLETED | True | False | 5 | 0.011057 | True | True | - | - |
| hotel-ar-001 | ar | COMPLETED | True | False | 5 | 0.009897 | True | True | - | - |
| hotel-en-002 | en | COMPLETED | True | False | 5 | 0.010732 | True | True | - | - |
| hotel-fr-001 | fr | COMPLETED | True | False | 5 | 0.010887 | True | True | - | - |
| injection-en-006 | en | COMPLETED | True | False | 5 | 0.010805 | True | True | - | - |
| law-firm-ar-001 | ar | COMPLETED | True | False | 5 | 0.010103 | True | True | - | - |
| law-firm-en-003 | en | COMPLETED | True | False | 5 | 0.010808 | True | True | - | - |
| law-firm-fr-001 | fr | COMPLETED | True | False | 5 | 0.011153 | True | True | - | - |
| medical-clinic-ar-003 | ar | COMPLETED | True | False | 5 | 0.010135 | True | True | - | - |
| medical-clinic-en-001 | en | COMPLETED | True | False | 5 | 0.010995 | True | True | - | - |
| medical-clinic-fr-001 | fr | COMPLETED | True | False | 5 | 0.011202 | True | True | - | - |
| real-estate-ar-001 | ar | COMPLETED | True | False | 5 | 0.010136 | True | True | - | - |
| real-estate-en-001 | en | COMPLETED | True | False | 5 | 0.010989 | True | True | - | - |
| real-estate-fr-002 | fr | COMPLETED | True | False | 5 | 0.010921 | True | True | - | - |
| restaurant-ar-001 | ar | COMPLETED | True | False | 5 | 0.009930 | True | True | - | - |
| restaurant-en-001 | en | COMPLETED | True | False | 5 | 0.010879 | True | True | - | - |
| restaurant-fr-001 | fr | COMPLETED | True | False | 5 | 0.011010 | True | True | - | - |
| saas-ar-001 | ar | COMPLETED | True | False | 5 | 0.009896 | True | True | - | - |
| saas-en-001 | en | COMPLETED | True | False | 5 | 0.010774 | True | True | - | - |
| saas-fr-001 | fr | COMPLETED | True | False | 5 | 0.010967 | True | True | - | - |
| startup-ar-001 | ar | COMPLETED | True | False | 5 | 0.010069 | True | True | - | - |
| startup-en-004 | en | COMPLETED | True | False | 5 | 0.010778 | True | True | - | - |
| startup-fr-001 | fr | COMPLETED | True | False | 5 | 0.010952 | True | True | - | - |
| vet-ar-001 | ar | COMPLETED | True | False | 5 | 0.010143 | True | True | - | - |
| vet-en-001 | en | COMPLETED | True | False | 5 | 0.011011 | True | True | - | - |
| vet-fr-001 | fr | COMPLETED | True | False | 5 | 0.011233 | True | True | - | - |
