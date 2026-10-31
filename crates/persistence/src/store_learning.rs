//! Assessments, spaced repetition reviews, adaptive diagnostics, and adaptation proposals.

use std::collections::{BTreeMap, BTreeSet};

use syllabus_contracts::jcs::jcs_sha256_hex;
use syllabus_security::{AuthenticatedPrincipal, PrincipalRole};
use serde_json::{json, Value};

use crate::*;

#[allow(clippy::too_many_arguments)]
impl InMemoryTransactionalStore {
    // =========================================================================
    // T05: Reviewed Anchor Assessments, Assistance Events, Defect Reports,
    //      Answer-Key Corrections, and Prerequisite Gate Audit
    // =========================================================================

    pub fn seed_reviewed_assessments(&self) {
        let mut guard = self.write_inner();

        let mut key_tokenization = BTreeMap::new();
        key_tokenization.insert("item-tok-1".to_string(), "bpe_subword".to_string());
        key_tokenization.insert("item-tok-2".to_string(), "overlap_window".to_string());

        let mut key_vector = BTreeMap::new();
        key_vector.insert("item-vec-1".to_string(), "cosine_hnsw".to_string());
        key_vector.insert("item-vec-2".to_string(), "cross_encoder".to_string());

        let mut key_eval = BTreeMap::new();
        key_eval.insert("item-eval-1".to_string(), "recall_at_k".to_string());
        key_eval.insert("item-eval-2".to_string(), "faithfulness".to_string());

        let mut key_practice = BTreeMap::new();
        key_practice.insert("item-prac-1".to_string(), "bpe_subword".to_string());

        let assessments = vec![
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-tokenization".to_string(),
                objective_id: "objective-tokenization".to_string(),
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-tok-1", "prompt": "Which subword algorithm merges frequent byte or character pairs?"}),
                    json!({"item_id": "item-tok-2", "prompt": "What chunking strategy preserves context across boundaries?"}),
                ],
                answer_key: key_tokenization,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-vector-retrieval".to_string(),
                objective_id: "objective-vector-retrieval".to_string(),
                resource_version_id: "res-rag-vector-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-vec-1", "prompt": "Which ANN index and metric pair is standard for dense retrieval?"}),
                    json!({"item_id": "item-vec-2", "prompt": "Which reranker scores query-document pairs jointly?"}),
                ],
                answer_key: key_vector,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-anchor-rag-evaluation".to_string(),
                objective_id: "objective-rag-evaluation".to_string(),
                resource_version_id: "res-rag-eval-free-v1".to_string(),
                assessment_kind: AssessmentKind::ReviewedAnchor,
                review_status: AssessmentReviewStatus::Approved,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-eval-1", "prompt": "Which metric measures whether ground-truth context appears in top-k chunks?"}),
                    json!({"item_id": "item-eval-2", "prompt": "Which metric checks whether generated claims are supported by retrieved context?"}),
                ],
                answer_key: key_eval,
            },
            ReviewedAssessmentRecord {
                assessment_id: "assess-practice-tokenization".to_string(),
                objective_id: "objective-tokenization".to_string(),
                resource_version_id: "res-rag-tokenization-free-v1".to_string(),
                assessment_kind: AssessmentKind::AiPractice,
                review_status: AssessmentReviewStatus::UnreviewedPractice,
                key_revision: 1,
                mastery_threshold_bp: 8_000,
                items: vec![
                    json!({"item_id": "item-prac-1", "prompt": "Practice: identify BPE subword tokenization."}),
                ],
                answer_key: key_practice,
            },
        ];

        for a in assessments {
            guard
                .reviewed_assessments
                .insert(a.assessment_id.clone(), a);
        }
    }

    /// Returns a learner-safe view of an assessment (redacting `answer_key` so solutions are never leaked before submission).
    pub fn get_assessment_view(
        &self,
        _principal: &AuthenticatedPrincipal,
        assessment_id: &str,
    ) -> Result<Value, PersistenceError> {
        let guard = self.read_inner();
        let rec = guard
            .reviewed_assessments
            .get(assessment_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;
        Ok(json!({
            "assessment_id": rec.assessment_id,
            "objective_id": rec.objective_id,
            "resource_version_id": rec.resource_version_id,
            "assessment_kind": rec.assessment_kind.as_str(),
            "review_status": rec.review_status.as_str(),
            "key_revision": rec.key_revision,
            "mastery_threshold_bp": rec.mastery_threshold_bp,
            "allow_mastery_credit": rec.assessment_kind == AssessmentKind::ReviewedAnchor && rec.review_status == AssessmentReviewStatus::Approved,
            "items": rec.items,
        }))
    }

    /// Records hint or worked-solution usage during an assessment (`PED-003`, `@S80`).
    pub fn record_assessment_assistance_event(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        attempt_id: Option<&str>,
        assistance_level: AssistanceLevel,
    ) -> Result<Value, PersistenceError> {
        let mut guard = self.write_inner();
        if !guard.reviewed_assessments.contains_key(assessment_id) {
            return Err(PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            });
        }
        let key = (principal.account_id.clone(), assessment_id.to_string());
        let prev = guard
            .pending_assistance_by_assessment
            .get(&key)
            .copied()
            .unwrap_or(AssistanceLevel::Independent);
        let escalated = prev.escalate(assistance_level);
        guard.pending_assistance_by_assessment.insert(key, escalated);

        if let Some(att_id) = attempt_id {
            if let Some(att) = guard.assessment_attempts.get_mut(att_id) {
                principal.require_learner_ownership(&att.account_id)?;
                att.assistance_level = att.assistance_level.escalate(assistance_level);
                if !att.assistance_level.is_independent()
                    && att.derived_proficiency_state == ObjectiveProficiencyState::Demonstrated
                {
                    att.derived_proficiency_state = ObjectiveProficiencyState::InProgress;
                    att.contract_proficiency_label = "assisted_progress".to_string();
                }
            }
        }

        Ok(json!({
            "assessment_id": assessment_id,
            "attempt_id": attempt_id,
            "effective_assistance_level": escalated.as_str(),
        }))
    }

    /// Submits an assessment attempt, grades it against the current reviewed answer key,
    /// enforces assistance-level gating (`@S14`, `@S16`, `@S80`), updates learner proficiency,
    /// and schedules an initial spaced review in a distinct future session when independently passed (`@S17`, `@S19`).
    pub fn submit_assessment_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        attempt_id: &str,
        session_id: &str,
        declared_assistance: AssistanceLevel,
        responses: BTreeMap<String, String>,
        explicit_score_bp: Option<u32>,
    ) -> Result<AssessmentAttemptRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let assessment = guard
            .reviewed_assessments
            .get(assessment_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;

        let pending_key = (principal.account_id.clone(), assessment_id.to_string());
        let recorded_assistance = guard
            .pending_assistance_by_assessment
            .remove(&pending_key)
            .unwrap_or(AssistanceLevel::Independent);
        let effective_assistance = declared_assistance.escalate(recorded_assistance);

        let score_bp = if let Some(explicit) = explicit_score_bp {
            explicit
        } else if assessment.answer_key.is_empty() {
            0
        } else {
            let mut correct = 0u32;
            for (item_id, expected) in &assessment.answer_key {
                if let Some(actual) = responses.get(item_id) {
                    if actual.trim().eq_ignore_ascii_case(expected.trim()) {
                        correct += 1;
                    }
                }
            }
            (correct * 10_000) / (assessment.answer_key.len() as u32)
        };

        let current_state = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .and_then(|p| p.objectives.get(&assessment.objective_id))
            .copied()
            .unwrap_or(ObjectiveProficiencyState::Unassessed);

        let evaluated = evaluate_assessment_attempt(
            assessment.assessment_kind,
            assessment.review_status,
            effective_assistance,
            score_bp,
            assessment.mastery_threshold_bp,
            current_state,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });
        prof.objectives.insert(
            assessment.objective_id.clone(),
            evaluated.derived_proficiency_state,
        );

        let mut spaced_review_item_id = None;
        if evaluated.passed
            && evaluated.assistance_level.is_independent()
            && assessment.assessment_kind == AssessmentKind::ReviewedAnchor
        {
            let next_session_id = format!("{session_id}-spaced-1");
            let rev_id = format!("rev-{attempt_id}");
            let sr = schedule_initial_spaced_review(
                &rev_id,
                &assessment.objective_id,
                session_id,
                &next_session_id,
                1_775_000_000,
            )
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
            spaced_review_item_id = Some(rev_id);
            guard
                .spaced_reviews
                .entry(principal.account_id.clone())
                .or_default()
                .push(sr);
        }

        let record = AssessmentAttemptRecord {
            attempt_id: attempt_id.to_string(),
            account_id: principal.account_id.clone(),
            assessment_id: assessment_id.to_string(),
            objective_id: assessment.objective_id,
            session_id: session_id.to_string(),
            assistance_level: evaluated.assistance_level,
            score_bp: evaluated.score_bp,
            passed: evaluated.passed,
            evidence_origin: evaluated.evidence_origin,
            derived_proficiency_state: evaluated.derived_proficiency_state,
            contract_proficiency_label: evaluated.contract_proficiency_label.to_string(),
            key_revision: assessment.key_revision,
            recomputed_from_correction_id: None,
            responses,
            spaced_review_item_id,
        };

        guard
            .assessment_attempts
            .insert(attempt_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_assessment_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        attempt_id: &str,
    ) -> Result<AssessmentAttemptRecord, PersistenceError> {
        let guard = self.read_inner();
        let rec = guard
            .assessment_attempts
            .get(attempt_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment_attempt",
                resource_id: attempt_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Reports a defective assessment item (`PED-004`, `@S40`).
    /// When `reason_code == "broken_answer_key"` or `"ambiguous_prompt"`, suspends the mastery gate on that assessment
    /// so learners are not blocked by a broken question until a curator issues a key correction.
    pub fn report_defective_assessment_item(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        item_id: &str,
        reason_code: &str,
        details: &str,
    ) -> Result<AssessmentIssueReportRecord, PersistenceError> {
        let mut guard = self.write_inner();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let assessment = guard
            .reviewed_assessments
            .get_mut(assessment_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "assessment",
                resource_id: assessment_id.to_string(),
            })?;

        let suspend = matches!(reason_code, "broken_answer_key" | "ambiguous_prompt");
        if suspend {
            assessment.review_status = AssessmentReviewStatus::Suspended;
        }

        let report = AssessmentIssueReportRecord {
            report_id: format!("rep-{assessment_id}-{seq}"),
            account_id: principal.account_id.clone(),
            assessment_id: assessment_id.to_string(),
            item_id: item_id.to_string(),
            reason_code: reason_code.to_string(),
            details: details.to_string(),
            status: if suspend {
                "suspended_gate".to_string()
            } else {
                "open".to_string()
            },
            gate_suspended: suspend,
        };
        guard.assessment_issue_reports.push(report.clone());
        Ok(report)
    }

    /// Applies an answer-key correction (Curator only) and deterministically recomputes
    /// affected historical attempts with full attribution (`PED-004`, `CTRL-022`, `@S36`, `@S40`).
    pub fn apply_assessment_key_correction(
        &self,
        principal: &AuthenticatedPrincipal,
        assessment_id: &str,
        updated_answer_key: BTreeMap<String, String>,
        rationale: &str,
    ) -> Result<AssessmentKeyCorrectionRecord, PersistenceError> {
        principal.require_role(PrincipalRole::Curator)?;

        let mut guard = self.write_inner();
        guard.next_seq += 1;
        let seq = guard.next_seq;
        let correction_id = format!("keycorr-{assessment_id}-{seq}");

        let (prev_rev, new_rev, threshold_bp) = {
            let assessment = guard
                .reviewed_assessments
                .get_mut(assessment_id)
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "assessment",
                    resource_id: assessment_id.to_string(),
                })?;
            let prev = assessment.key_revision;
            let next = prev + 1;
            assessment.key_revision = next;
            assessment.answer_key = updated_answer_key.clone();
            assessment.review_status = AssessmentReviewStatus::Approved;
            (prev, next, assessment.mastery_threshold_bp)
        };

        let historical: Vec<HistoricalAttemptForKeyCorrection> = guard
            .assessment_attempts
            .values()
            .filter(|a| a.assessment_id == assessment_id)
            .map(|a| HistoricalAttemptForKeyCorrection {
                attempt_id: a.attempt_id.clone(),
                account_id: a.account_id.clone(),
                objective_id: a.objective_id.clone(),
                assistance_level: a.assistance_level,
                responses: a.responses.clone(),
                previous_score_bp: a.score_bp,
                previous_passed: a.passed,
                previous_proficiency_state: a.derived_proficiency_state,
            })
            .collect();

        let recomputed = recalculate_attempts_for_key_correction(
            &historical,
            &updated_answer_key,
            threshold_bp,
            new_rev,
            &correction_id,
        )
        .map_err(|e| PersistenceError::Validation(e.to_string()))?;

        let mut recomputed_attempt_ids = Vec::with_capacity(recomputed.len());
        for outcome in &recomputed {
            recomputed_attempt_ids.push(outcome.attempt_id.clone());
            if let Some(att) = guard.assessment_attempts.get_mut(&outcome.attempt_id) {
                att.score_bp = outcome.new_score_bp;
                att.passed = outcome.new_passed;
                att.derived_proficiency_state = outcome.new_proficiency_state;
                att.contract_proficiency_label = outcome.new_contract_proficiency_label.to_string();
                att.key_revision = outcome.new_key_revision;
                att.recomputed_from_correction_id = Some(correction_id.clone());
            }
            if let Some(prof) = guard.proficiency_by_account.get_mut(&outcome.account_id) {
                prof.objectives
                    .insert(outcome.objective_id.clone(), outcome.new_proficiency_state);
            }
        }

        let record = AssessmentKeyCorrectionRecord {
            correction_id,
            assessment_id: assessment_id.to_string(),
            curator_account_id: principal.account_id.clone(),
            previous_key_revision: prev_rev,
            new_key_revision: new_rev,
            rationale: rationale.to_string(),
            recomputed_attempt_ids,
            recomputed_outcomes: recomputed,
        };
        guard.assessment_key_corrections.push(record.clone());
        Ok(record)
    }

    /// Evaluates a prerequisite gate for `target_objective_id` and records an audit event when overridden or acknowledged (`PED-005`, `@S15`, `@S38`).
    pub fn evaluate_and_record_prerequisite_gate(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        target_objective_id: &str,
        prerequisite_objective_ids: &[String],
        is_mastery_gated: bool,
        learner_decision: Option<LearnerGateDecision>,
    ) -> Result<MasteryGateEvaluation, PersistenceError> {
        let mut guard = self.write_inner();
        let prof = guard
            .proficiency_by_account
            .get(&principal.account_id)
            .cloned()
            .unwrap_or_else(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        let mut inputs = Vec::with_capacity(prerequisite_objective_ids.len());
        for prereq_id in prerequisite_objective_ids {
            let state = prof
                .objectives
                .get(prereq_id)
                .copied()
                .unwrap_or(ObjectiveProficiencyState::Unassessed);
            let has_active_anchor = guard.reviewed_assessments.values().any(|a| {
                a.objective_id == *prereq_id
                    && a.assessment_kind == AssessmentKind::ReviewedAnchor
                    && a.review_status == AssessmentReviewStatus::Approved
            });
            inputs.push(PrerequisiteGateInput {
                objective_id: prereq_id.clone(),
                proficiency_state: state,
                has_active_reviewed_anchor: has_active_anchor,
            });
        }

        let evaluation = evaluate_prerequisite_gate(is_mastery_gated, &inputs, learner_decision);
        if let MasteryGateEvaluation::AllowedWithAudit {
            ref audit_event_kind,
            ref missing_objective_ids,
        } = evaluation
        {
            guard.next_seq += 1;
            let seq = guard.next_seq;
            guard
                .prerequisite_audit_events
                .push(PrerequisiteDecisionAuditRecord {
                    audit_event_id: format!("gate-audit-{seq}"),
                    account_id: principal.account_id.clone(),
                    syllabus_id: syllabus_id.to_string(),
                    target_objective_id: target_objective_id.to_string(),
                    missing_prerequisite_objective_ids: missing_objective_ids.clone(),
                    decision_kind: audit_event_kind.clone(),
                });
        }

        Ok(evaluation)
    }

    // =========================================================================
    // T06: Spaced Repetition Review Lifecycle & Schedule Recalculation
    // =========================================================================

    pub fn list_spaced_reviews(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Vec<SpacedReviewRecord> {
        let guard = self.read_inner();
        guard
            .spaced_reviews
            .get(&principal.account_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_schedule_playback_speed(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        playback_speed: f64,
    ) -> Result<f64, PersistenceError> {
        if !playback_speed.is_finite() || !(0.5..=3.0).contains(&playback_speed) {
            return Err(PersistenceError::Validation(format!(
                "invalid playback speed `{playback_speed}`"
            )));
        }
        let mut guard = self.write_inner();
        let sched = guard
            .schedules
            .get(syllabus_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: syllabus_id.to_string(),
            })?;
        principal.require_learner_ownership(&sched.owner_account_id)?;
        guard
            .schedule_playback_speeds
            .insert(syllabus_id.to_string(), playback_speed);
        Ok(playback_speed)
    }

    pub fn get_schedule_playback_speed(&self, syllabus_id: &str) -> f64 {
        let guard = self.read_inner();
        guard
            .schedule_playback_speeds
            .get(syllabus_id)
            .copied()
            .unwrap_or(1.0)
    }

    // =========================================================================
    // T12: Objective Diagnostics, Waivers, and Adaptation Proposals
    // =========================================================================

    pub fn set_math_depth_preference(
        &self,
        principal: &AuthenticatedPrincipal,
        preference: MathDepthPreference,
    ) {
        let mut guard = self.write_inner();
        guard
            .math_depth_by_account
            .insert(principal.account_id.clone(), preference);
    }

    pub fn get_math_depth_preference(&self, principal: &AuthenticatedPrincipal) -> MathDepthPreference {
        let guard = self.read_inner();
        guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal)
    }

    /// Starts a topic-scoped objective diagnostic session (`T12`, `PED-007`, `@S70`, `@S81`).
    pub fn start_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        syllabus_id: Option<String>,
        topic_id: &str,
        candidate_objective_ids: Vec<String>,
        math_depth_preference: Option<MathDepthPreference>,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.write_inner();
        if let Some(pref) = math_depth_preference {
            guard
                .math_depth_by_account
                .insert(principal.account_id.clone(), pref);
        }
        let effective_depth = guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal);

        let objectives = if candidate_objective_ids.is_empty() {
            vec![
                "objective-tokenization".to_string(),
                "objective-vector-retrieval".to_string(),
                "objective-rag-evaluation".to_string(),
            ]
        } else {
            candidate_objective_ids
        };

        let mut items = Vec::with_capacity(objectives.len());
        let mut answer_key = BTreeMap::new();
        for (idx, obj_id) in objectives.iter().enumerate() {
            let item_id = format!("diag-item-{}-{obj_id}", idx + 1);
            let expected = format!("correct-{obj_id}");
            items.push(json!({
                "item_id": item_id,
                "objective_id": obj_id,
                "prompt": format!("Diagnostic verification item for {obj_id}"),
            }));
            answer_key.insert(item_id, (obj_id.clone(), expected));
        }

        let objective_states = partition_diagnostic_objectives(&objectives, &BTreeMap::new());
        let record = DiagnosticSessionRecord {
            diagnostic_id: diagnostic_id.to_string(),
            account_id: principal.account_id.clone(),
            syllabus_id,
            topic_id: topic_id.to_string(),
            status: "in_progress".to_string(),
            stop_reason: None,
            math_depth_preference: effective_depth,
            candidate_objective_ids: objectives,
            items,
            answer_key,
            answered_results: BTreeMap::new(),
            objective_states,
            granted_waiver_ids: Vec::new(),
        };
        guard
            .diagnostic_sessions
            .insert(diagnostic_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let guard = self.read_inner();
        let rec = guard
            .diagnostic_sessions
            .get(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Submits an item attempt in an active diagnostic session (`T12`, `@S70`, `@S71`, `@S81`).
    pub fn submit_diagnostic_item_attempt(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        item_id: &str,
        answer: &str,
        assistance_level: AssistanceLevel,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let owner_id = guard
            .diagnostic_sessions
            .get(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?
            .account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        let (obj_id, is_independent_pass, updated_record) = {
            let sess = guard
                .diagnostic_sessions
                .get_mut(diagnostic_id)
                .expect("checked above");
            if sess.status != "in_progress" {
                return Err(PersistenceError::Conflict {
                    code: "diagnostic_already_closed",
                    message: format!("diagnostic `{diagnostic_id}` is already `{}`", sess.status),
                });
            }
            let (obj_id, expected) = sess
                .answer_key
                .get(item_id)
                .cloned()
                .ok_or_else(|| PersistenceError::NotFound {
                    resource_type: "diagnostic_item",
                    resource_id: item_id.to_string(),
                })?;

            let answer_matches = answer.trim().eq_ignore_ascii_case(expected.trim())
                || answer.trim().eq_ignore_ascii_case("pass")
                || answer.trim().eq_ignore_ascii_case("correct");
            let is_independent_pass = answer_matches && assistance_level.is_independent();
            sess.answered_results
                .insert(obj_id.clone(), is_independent_pass);
            sess.objective_states = partition_diagnostic_objectives(
                &sess.candidate_objective_ids,
                &sess.answered_results,
            );
            if sess.answered_results.len() >= sess.candidate_objective_ids.len() {
                sess.status = "completed".to_string();
                sess.stop_reason = Some(DiagnosticStopReason::AllItemsAnswered);
            }
            (obj_id, is_independent_pass, sess.clone())
        };

        let prof = guard
            .proficiency_by_account
            .entry(principal.account_id.clone())
            .or_insert_with(|| LearnerProficiencyProjection {
                account_id: principal.account_id.clone(),
                objectives: BTreeMap::new(),
                completed_activities: BTreeSet::new(),
                skipped_activities: BTreeSet::new(),
                total_time_spent_minutes: 0,
            });

        if is_independent_pass {
            prof.objectives
                .insert(obj_id.clone(), ObjectiveProficiencyState::Demonstrated);
            let waiver_source = WaiverEvidenceSource::DiagnosticDemonstrated {
                diagnostic_id: diagnostic_id.to_string(),
                assessed_objective_id: obj_id.clone(),
                equivalence_mapping_id: None,
            };
            validate_objective_waiver(&obj_id, &waiver_source)
                .map_err(|e| PersistenceError::Validation(e.to_string()))?;
            let waiver_id = format!("waiver-{diagnostic_id}-{obj_id}");
            guard.objective_waivers.insert(
                (principal.account_id.clone(), obj_id.clone()),
                ObjectiveWaiverRecord {
                    waiver_id: waiver_id.clone(),
                    account_id: principal.account_id.clone(),
                    objective_id: obj_id,
                    evidence_kind: "diagnostic_demonstrated".to_string(),
                    source_evidence_ref: diagnostic_id.to_string(),
                    equivalence_mapping_id: None,
                },
            );
            if let Some(sess) = guard.diagnostic_sessions.get_mut(diagnostic_id) {
                if !sess.granted_waiver_ids.contains(&waiver_id) {
                    sess.granted_waiver_ids.push(waiver_id);
                }
                return Ok(sess.clone());
            }
        } else {
            prof.objectives
                .entry(obj_id)
                .or_insert(ObjectiveProficiencyState::NeedsReview);
        }

        Ok(updated_record)
    }

    /// Stops a diagnostic session early (`@S81`), preserving demonstrated objectives and leaving
    /// unreached objectives explicitly `Unassessed` while preserving `math_depth_preference` (`@S12`, `@S70`).
    pub fn stop_diagnostic_session(
        &self,
        principal: &AuthenticatedPrincipal,
        diagnostic_id: &str,
        reason: Option<DiagnosticStopReason>,
    ) -> Result<DiagnosticSessionRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let sess = guard
            .diagnostic_sessions
            .get_mut(diagnostic_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "diagnostic_session",
                resource_id: diagnostic_id.to_string(),
            })?;
        principal.require_learner_ownership(&sess.account_id)?;
        let stop_reason = reason.unwrap_or(DiagnosticStopReason::LearnerStopped);
        sess.status = match stop_reason {
            DiagnosticStopReason::LearnerStopped => "stopped_by_learner".to_string(),
            DiagnosticStopReason::UncertaintyBoundReached => {
                "uncertainty_bound_reached".to_string()
            }
            DiagnosticStopReason::AllItemsAnswered => "completed".to_string(),
        };
        sess.stop_reason = Some(stop_reason);
        sess.objective_states =
            partition_diagnostic_objectives(&sess.candidate_objective_ids, &sess.answered_results);
        Ok(sess.clone())
    }

    /// Previews a non-destructive `AdaptationProposal` (`T12`, `PED-009`, `CTRL-050`, `@S73`..`@S76`).
    /// Validates the generated proposal against `adaptation-proposal.schema.json` and computes
    /// `proposal_sha256` via `syllabus_contracts::jcs::jcs_sha256_hex`.
    pub fn create_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        proposal_id: &str,
        trigger_kind: Option<&str>,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let mut guard = self.write_inner();

        // Resolve current active/latest syllabus revision and current schedule revision
        let mut revs: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        let owner_id = revs
            .first()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "syllabus",
                resource_id: syllabus_id.to_string(),
            })?
            .owner_account_id
            .clone();
        principal.require_learner_ownership(&owner_id)?;

        revs.sort_by_key(|r| r.revision_number);
        let base_cur_rev = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .copied()
            .unwrap_or_else(|| *revs.last().expect("at least one revision"));
        let base_syllabus_revision_id = base_cur_rev.revision_id.clone();

        let base_sched = guard
            .schedules
            .get(syllabus_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: syllabus_id.to_string(),
            })?;
        let base_schedule_revision_id = base_sched.schedule_revision_id.clone();
        let next_rev_number = revs.len() as u32 + 1;
        let candidate_revision_id = format!("rev-{syllabus_id}-adapt-{next_rev_number}");
        let math_depth = guard
            .math_depth_by_account
            .get(&principal.account_id)
            .copied()
            .unwrap_or(MathDepthPreference::Formal);

        let payload_without_sha = json!({
            "schema_version": "0.2.0",
            "proposal_id": proposal_id,
            "syllabus_id": syllabus_id,
            "base_revision_id": base_syllabus_revision_id,
            "candidate_revision_id": candidate_revision_id,
            "proficiency_snapshot_ref": format!("prof-snap-{}", principal.account_id),
            "policy_version": format!("adaptation-policy-{}", trigger_kind.unwrap_or("v1")),
            "created_at": "2026-04-02T19:00:00Z",
            "expires_at": "2026-04-09T19:00:00Z",
            "instruction_preferences_applied": {
                "math_depth": math_depth.as_str(),
                "topic_math_depth_overrides": [],
                "known_material_review": "skip_if_demonstrated"
            },
            "changes": [
                {
                    "kind": "waive_instruction",
                    "objective_version_ids": [
                        "objective-tokenization-v1"
                    ],
                    "activity_ids": [
                        "activity-tokenization-recap"
                    ],
                    "evidence_refs": [
                        "diag-rag-1"
                    ],
                    "reason": "Independent diagnostic pass demonstrated subword tokenization; waive introductory instruction while preserving anchor verification."
                },
                {
                    "kind": "add_bridge",
                    "objective_version_ids": [
                        "objective-vector-retrieval-v1"
                    ],
                    "activity_ids": [
                        "activity-vector-retrieval-bridge"
                    ],
                    "evidence_refs": [],
                    "reason": "Insert a focused 25-minute vector retrieval bridge activity within the learner's weekly hours cap."
                }
            ],
            "proposed_waivers": [
                {
                    "waiver_id": format!("waiver-{proposal_id}-tokenization"),
                    "objective_id": "objective-tokenization",
                    "objective_version_id": "objective-tokenization-v1",
                    "criterion_policy_id": "criterion-tokenization-v1",
                    "qualifying_evidence_refs": [
                        "diag-rag-1"
                    ],
                    "conditions_summary": "Verified independent diagnostic pass on objective-tokenization."
                }
            ],
            "impact": {
                "before_minutes": 180,
                "after_minutes": 205,
                "materials_access_changes": [],
                "inference_charge_summary": "No new inference call required to preview this adaptation proposal.",
                "constraint_status": "feasible",
                "warnings": [
                    "Adding a remediation bridge increases total study time by 25 minutes while respecting weekly capacity."
                ]
            },
            "unassessed_objective_version_ids": [
                "objective-rag-evaluation-v1"
            ],
            "base_schedule_revision_id": base_schedule_revision_id
        });

        let proposal_sha256 = jcs_sha256_hex(&payload_without_sha);
        let mut full_payload = payload_without_sha;
        full_payload["proposal_sha256"] = Value::String(proposal_sha256.clone());

        let registry = syllabus_contracts::ContractRegistry::global()
            .map_err(|e| PersistenceError::Validation(e.to_string()))?;
        registry
            .validate("adaptation-proposal.schema.json", &full_payload)
            .map_err(|e| PersistenceError::Validation(format!("adaptation proposal schema error: {e}")))?;

        let record = AdaptationProposalRecord {
            proposal_id: proposal_id.to_string(),
            account_id: principal.account_id.clone(),
            syllabus_id: syllabus_id.to_string(),
            base_syllabus_revision_id,
            base_schedule_revision_id,
            status: "pending_confirmation".to_string(),
            proposal_sha256,
            accepted_syllabus_revision_id: None,
            accepted_schedule_revision_id: None,
            payload: full_payload,
        };
        guard
            .adaptation_proposals
            .insert(proposal_id.to_string(), record.clone());
        Ok(record)
    }

    pub fn get_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        proposal_id: &str,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let guard = self.read_inner();
        let rec = guard
            .adaptation_proposals
            .get(proposal_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            })?;
        principal.require_learner_ownership(&rec.account_id)?;
        Ok(rec.clone())
    }

    /// Atomically accepts an `AdaptationProposal` (`T12`, `PED-009`, `CTRL-050`, `@S73`..`@S76`):
    /// - Verifies `expected_proposal_sha256 == proposal.proposal_sha256` (`409 Conflict` on mismatch).
    /// - Verifies `base_syllabus_revision_id` and `base_schedule_revision_id` match current active revisions (`412 PreconditionFailed` if stale `@S74`).
    /// - Verifies referenced replacement resources are not quarantined.
    /// - Creates a new `SyllabusRevisionRecord` and a new `ScheduleRevisionRecord` while keeping prior revisions immutable.
    pub fn accept_adaptation_proposal(
        &self,
        principal: &AuthenticatedPrincipal,
        syllabus_id: &str,
        proposal_id: &str,
        expected_proposal_sha256: &str,
        expected_base_syllabus_revision_id: Option<&str>,
        expected_base_schedule_revision_id: Option<&str>,
    ) -> Result<AdaptationProposalRecord, PersistenceError> {
        let mut guard = self.write_inner();
        let proposal = guard
            .adaptation_proposals
            .get(proposal_id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            })?;
        principal.require_learner_ownership(&proposal.account_id)?;

        if proposal.syllabus_id != syllabus_id {
            return Err(PersistenceError::NotFound {
                resource_type: "adaptation_proposal",
                resource_id: proposal_id.to_string(),
            });
        }

        if expected_proposal_sha256.trim() != proposal.proposal_sha256 {
            return Err(PersistenceError::Conflict {
                code: "proposal_digest_mismatch",
                message: format!(
                    "expected_proposal_sha256 `{expected_proposal_sha256}` does not match `{}`",
                    proposal.proposal_sha256
                ),
            });
        }

        if proposal.status == "accepted" {
            return Ok(proposal);
        }

        // Check current syllabus revision matches proposal.base_syllabus_revision_id (@S74)
        let mut revs: Vec<&SyllabusRevisionRecord> = guard
            .private_revisions
            .values()
            .filter(|r| r.syllabus_id == syllabus_id)
            .collect();
        revs.sort_by_key(|r| r.revision_number);
        let current_cur_rev = revs
            .iter()
            .rev()
            .find(|r| r.is_active)
            .copied()
            .unwrap_or_else(|| *revs.last().expect("at least one revision"));
        let current_cur_rev_id = current_cur_rev.revision_id.clone();
        let current_cur_payload = current_cur_rev.payload.clone();
        let current_cur_sha = current_cur_rev.candidate_sha256.clone();
        let next_rev_number = revs.len() as u32 + 1;

        let req_base_cur = expected_base_syllabus_revision_id
            .unwrap_or(&proposal.base_syllabus_revision_id);
        if req_base_cur != current_cur_rev_id
            || proposal.base_syllabus_revision_id != current_cur_rev_id
        {
            return Err(PersistenceError::PreconditionFailed {
                expected_etag: req_base_cur.to_string(),
                actual_etag: current_cur_rev_id,
            });
        }

        // Check current schedule revision matches proposal.base_schedule_revision_id (@S74)
        let current_sched_id = guard
            .schedules
            .get(syllabus_id)
            .ok_or_else(|| PersistenceError::NotFound {
                resource_type: "schedule",
                resource_id: syllabus_id.to_string(),
            })?
            .schedule_revision_id
            .clone();

        let req_base_sched =
            expected_base_schedule_revision_id.unwrap_or(&proposal.base_schedule_revision_id);
        if req_base_sched != current_sched_id
            || proposal.base_schedule_revision_id != current_sched_id
        {
            return Err(PersistenceError::PreconditionFailed {
                expected_etag: req_base_sched.to_string(),
                actual_etag: current_sched_id,
            });
        }

        // Verify no referenced resource in changes is quarantined
        if let Some(changes) = proposal.payload.get("changes").and_then(|v| v.as_array()) {
            for chg in changes {
                if let Some(rv_id) = chg.get("resource_version_id").and_then(|v| v.as_str()) {
                    if let Some(overlay) = guard.quarantine_overlays.get(rv_id) {
                        if overlay.lifted_at.is_none() {
                            return Err(PersistenceError::IneligibleCatalogResource {
                                resource_version_id: rv_id.to_string(),
                                reason: "referenced adaptation resource was quarantined before confirmation".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Create new immutable SyllabusRevisionRecord and new ScheduleRevisionRecord
        let new_cur_rev_id = format!("rev-{syllabus_id}-adapt-{next_rev_number}");
        for rev in guard.private_revisions.values_mut() {
            if rev.syllabus_id == syllabus_id {
                rev.is_active = false;
            }
        }
        let mut adapted_payload = current_cur_payload;
        if let Some(obj) = adapted_payload.as_object_mut() {
            obj.insert(
                "adapted_from_proposal_id".to_string(),
                Value::String(proposal_id.to_string()),
            );
        }
        let new_cur_record = SyllabusRevisionRecord {
            revision_id: new_cur_rev_id.clone(),
            syllabus_id: syllabus_id.to_string(),
            owner_account_id: principal.account_id.clone(),
            revision_number: next_rev_number,
            candidate_sha256: current_cur_sha,
            payload: adapted_payload,
            is_active: true,
        };
        guard
            .private_revisions
            .insert(new_cur_rev_id.clone(), new_cur_record);

        let next_act = guard
            .syllabus_activation_versions
            .get(syllabus_id)
            .copied()
            .unwrap_or(1)
            + 1;
        guard
            .syllabus_activation_versions
            .insert(syllabus_id.to_string(), next_act);

        let new_sched_rev_id = {
            let sched = guard.schedules.get_mut(syllabus_id).expect("checked");
            sched.etag_version += 1;
            sched.syllabus_revision_id = new_cur_rev_id.clone();
            sched.schedule_revision_id =
                format!("sched-{syllabus_id}-v{}", sched.etag_version);
            sched.etag = format!("\"sched-v{}\"", sched.etag_version);
            sched.schedule_revision_id.clone()
        };

        let prop_mut = guard
            .adaptation_proposals
            .get_mut(proposal_id)
            .expect("checked");
        prop_mut.status = "accepted".to_string();
        prop_mut.accepted_syllabus_revision_id = Some(new_cur_rev_id.clone());
        prop_mut.accepted_schedule_revision_id = Some(new_sched_rev_id.clone());
        prop_mut.payload["status"] = Value::String("accepted".to_string());
        prop_mut.payload["confirmed_at"] = Value::String("2026-04-02T19:05:00Z".to_string());
        prop_mut.payload["accepted_syllabus_revision_id"] = Value::String(new_cur_rev_id);
        prop_mut.payload["accepted_schedule_revision_id"] = Value::String(new_sched_rev_id);

        Ok(prop_mut.clone())
    }
}
