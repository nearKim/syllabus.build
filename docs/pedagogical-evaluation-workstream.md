# Pedagogical Evaluation Workstream & Delayed Retention/Transfer Protocol

**Ticket & Requirement Traceability:** `T11`, `NFR-008`, `PROG-006`, `PED-001`..`PED-006`, `ASSESS-001`..`ASSESS-007`, `@S24`, `@S42`, `@S44`, `@S50`, `@S62`

This document specifies the **4-part pedagogical evaluation workstream** enforced in `crates/domain/src/lib.rs` and verified before production release (`evaluate_dynamic_release_readiness` in `crates/application/src/lib.rs`).

---

## 1. Offline Retrieval Benchmark (`evaluate_retrieval_benchmark`)

- **Purpose:** Verify that deterministic catalog retrieval surfaces high-precision, budget-compliant, and objective-aligned reviewed resources across representative learner goals (`CAT-001`..`CAT-007`, `NFR-008`).
- **Domain Invariants (`crates/domain::evaluate_retrieval_benchmark`):**
  - Evaluates a benchmark suite of `RetrievalBenchmarkCase` records.
  - Requires macro-averaged `Precision@K >= 8000 bp` ($0.80$), `Recall@K >= 8000 bp` ($0.80$), and `NDCG@K >= 8500 bp` ($0.85$).
  - Enforces **zero** unapproved, quarantined, broken, or synthetic fixture leaks (`unapproved_or_quarantined_leaks == 0`) and **zero** learner budget policy violations (`budget_policy_violations == 0`).

---

## 2. Blinded Expert Rubric Evaluation (`evaluate_syllabus_expert_rubric`)

- **Purpose:** Blinded subject-matter expert (SME) evaluation of generated syllabi across 5 core pedagogical dimensions on a $1.00$–$5.00$ scale (`100`–`500` centi-points) (`PED-001`..`PED-006`, `@S42`, `@S44`).
- **Domain Invariants (`crates/domain::evaluate_syllabus_expert_rubric`):**
  - Requires at least 3 independent SME ratings (`min_required_reviews >= 3`).
  - Evaluates 5 dimensions:
    1. `prerequisite_sequencing_centi` (DAG topological validity and cognitive scaffolding)
    2. `triad_alignment_centi` (instruction, practice, and independent assessment alignment per objective)
    3. `workload_realism_centi` (realism of `lower <= point <= upper` effort estimates and weekly session packing)
    4. `resource_quality_fit_centi` (alignment between assigned catalog resource versions and learner background)
    5. `adaptive_replanning_coherence_centi` (coherence of `AdaptationProposal` diffs after diagnostics or missed sessions)
  - Requires mean composite score $\ge 4.00 / 5.00$ (`400` centi-points) and every individual dimension mean $\ge 3.50 / 5.00$ (`350` centi-points).

---

## 3. Anchor Assessment Item Psychometrics (`evaluate_anchor_item_psychometrics`)

- **Purpose:** Empirical item-level psychometric calibration of reviewed anchor assessments (`ASSESS-001`..`ASSESS-007`, `@S24`, `@S50`).
- **Domain Invariants (`crates/domain::evaluate_anchor_item_psychometrics`):**
  - Requires sample size $N \ge 30$ learner attempts per calibrated anchor item.
  - Item difficulty index ($p$-value in basis points) must lie within `[2000, 9000]` ($0.20 \le p \le 0.90$) so items are neither trivial nor impossibly opaque.
  - Point-biserial discrimination index ($r_{\text{pbis}}$ in signed basis points) must be $\ge 2000\text{ bp}$ ($r_{\text{pbis}} \ge 0.20$).
  - Items failing calibration or flagged via learner defect reports (`POST /v1/assessments/{assessment_id}/items/{item_id}/report-defect`) immediately suspend mastery gating until curator key correction (`POST /v1/assessments/{assessment_id}/key-corrections`) recomputes affected attempts (`@S16`, `@S17`, `@S24`).

---

## 4. Delayed Retention & Far-Transfer Study Protocol (`evaluate_delayed_retention_and_transfer_study`)

- **Purpose:** Longitudinal cohort evaluation measuring durable learning (7–14 day delayed retention) and far-transfer problem solving (`PED-005`, `NFR-008`, `@S24`, `@S44`, `@S62`).
- **Domain Invariants (`crates/domain::evaluate_delayed_retention_and_transfer_study`):**
  - Evaluates cohorts with `completed_learners >= 20` and `retention_delay_days >= 7`.
  - Requires `delayed_retention_pass_rate_bp >= 7000` ($\ge 70\%$ pass rate on unassisted delayed review assessments in a distinct session after $\ge 7$ days).
  - Requires `far_transfer_pass_rate_bp >= 6500` ($\ge 65\%$ pass rate on novel transfer tasks).
  - Requires positive mastery gain over baseline diagnostic (`mean_post_minus_pre_gain_bp >= 1500`, i.e., $+15\%$ gain).
- **External Provider Completion Boundary (`PROG-006`, `@S50`):**
  - Imported completions from third-party learning providers (`POST /v1/me/integrations/completions`) record activity completion and effort telemetry (`external_provider`, `external_certificate_or_course_ref`) and advance objective proficiency from `unassessed` to `in_progress`, but **never** grant `demonstrated` mastery without an independent reviewed assessment pass.
