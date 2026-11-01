//! Syllabus workload math, DAG validation, three-layer state separation, assessments, mastery gates, and key corrections.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::DomainError;

/// Bounds (`min_minutes <= point_minutes <= max_minutes`) for a single workload component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffortTriplet {
    pub min_minutes: u32,
    pub point_minutes: u32,
    pub max_minutes: u32,
}

impl EffortTriplet {
    pub fn validate(&self, component: &str) -> Result<(), DomainError> {
        if self.min_minutes <= self.point_minutes && self.point_minutes <= self.max_minutes {
            Ok(())
        } else {
            Err(DomainError::UnorderedComponentBounds {
                component: component.to_string(),
                min_minutes: self.min_minutes,
                point_minutes: self.point_minutes,
                max_minutes: self.max_minutes,
            })
        }
    }
}

/// Five-component effort breakdown per activity (`SCHED-001`, `@S20`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityComponentBreakdown {
    pub media: EffortTriplet,
    pub reading: EffortTriplet,
    pub practice: EffortTriplet,
    pub assessment: EffortTriplet,
    pub review: EffortTriplet,
}

impl ActivityComponentBreakdown {
    pub fn validate_bounds(&self) -> Result<(), DomainError> {
        self.media.validate("media")?;
        self.reading.validate("reading")?;
        self.practice.validate("practice")?;
        self.assessment.validate("assessment")?;
        self.review.validate("review")?;
        Ok(())
    }

    /// Computes adjusted `(min, point, max)` effort in integer minutes using the canonical
    /// ceiling formula (`SCHED-001`, `@S20`):
    /// `ceil(media / playback_speed + reading + practice + assessment + review)`
    /// Playback speed scales **only** `media` duration and never compresses reading,
    /// practice, assessment, or spaced review.
    pub fn adjusted_effort(&self, playback_speed: f64) -> Result<EffortTriplet, DomainError> {
        if !playback_speed.is_finite() || !(0.5..=3.0).contains(&playback_speed) {
            return Err(DomainError::InvalidPlaybackSpeed(format!(
                "{playback_speed}"
            )));
        }
        self.validate_bounds()?;

        let calc = |media: u32, reading: u32, practice: u32, assessment: u32, review: u32| -> u32 {
            let scaled_media = (media as f64) / playback_speed;
            let non_media = (reading + practice + assessment + review) as f64;
            (scaled_media + non_media).ceil() as u32
        };

        Ok(EffortTriplet {
            min_minutes: calc(
                self.media.min_minutes,
                self.reading.min_minutes,
                self.practice.min_minutes,
                self.assessment.min_minutes,
                self.review.min_minutes,
            ),
            point_minutes: calc(
                self.media.point_minutes,
                self.reading.point_minutes,
                self.practice.point_minutes,
                self.assessment.point_minutes,
                self.review.point_minutes,
            ),
            max_minutes: calc(
                self.media.max_minutes,
                self.reading.max_minutes,
                self.practice.max_minutes,
                self.assessment.max_minutes,
                self.review.max_minutes,
            ),
        })
    }
}

/// Validates that a directed graph `node -> prerequisites` has unique nodes,
/// resolvable prerequisite references, and zero cycles using Kahn's algorithm.
pub fn validate_dag_acyclic(edges: &[(String, Vec<String>)]) -> Result<Vec<String>, DomainError> {
    let mut node_set: BTreeSet<&str> = BTreeSet::new();
    for (node, _) in edges {
        if !node_set.insert(node.as_str()) {
            return Err(DomainError::DuplicateIdentifier(node.clone()));
        }
    }

    let mut in_degree: BTreeMap<&str, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<&str, Vec<&str>> = BTreeMap::new();

    for (node, prereqs) in edges {
        let node_str = node.as_str();
        in_degree.entry(node_str).or_insert(0);
        for prereq in prereqs {
            let prereq_str = prereq.as_str();
            if !node_set.contains(prereq_str) {
                return Err(DomainError::UnknownDependency {
                    node: node.clone(),
                    dependency: prereq.clone(),
                });
            }
            *in_degree.entry(node_str).or_insert(0) += 1;
            dependents.entry(prereq_str).or_default().push(node_str);
        }
    }

    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter_map(|(&k, &deg)| if deg == 0 { Some(k) } else { None })
        .collect();

    let mut topo_order = Vec::with_capacity(edges.len());
    while let Some(curr) = queue.pop_front() {
        topo_order.push(curr.to_string());
        if let Some(children) = dependents.get(curr) {
            for &child in children {
                if let Some(deg) = in_degree.get_mut(child) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(child);
                    }
                }
            }
        }
    }

    if topo_order.len() != edges.len() {
        let cycle_nodes: Vec<String> = in_degree
            .into_iter()
            .filter_map(|(n, deg)| if deg > 0 { Some(n.to_string()) } else { None })
            .collect();
        return Err(DomainError::GraphCycleDetected { cycle_nodes });
    }

    Ok(topo_order)
}

/// Layer 1: Activity execution state (`PROG-002`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityExecutionStatus {
    NotStarted,
    InProgress,
    SelfReportedCompleted,
    Completed,
    Waived,
}

/// Layer 2: Objective proficiency evidence state (`PED-004`, `PED-006`, `PROG-002`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveProficiencyState {
    Unassessed,
    SelfReported,
    InProgress,
    NeedsReview,
    Demonstrated,
}

/// Evidence source attempting to update objective proficiency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceOrigin {
    SelfReportedActivityCompletion,
    FormativePracticeCompletion,
    UnverifiedDiagnosticClaim,
    ReviewedAnchorAssessmentPass { independent_performance: bool },
}

/// Enforces the canonical separation between activity completion and objective proficiency:
/// neither `self_reported_completed` nor formative practice can ever yield `Demonstrated`.
pub fn derive_proficiency_transition(
    current: ObjectiveProficiencyState,
    origin: EvidenceOrigin,
) -> Result<ObjectiveProficiencyState, DomainError> {
    match origin {
        EvidenceOrigin::SelfReportedActivityCompletion => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            ObjectiveProficiencyState::NeedsReview => ObjectiveProficiencyState::NeedsReview,
            ObjectiveProficiencyState::InProgress => ObjectiveProficiencyState::InProgress,
            ObjectiveProficiencyState::Unassessed | ObjectiveProficiencyState::SelfReported => {
                ObjectiveProficiencyState::SelfReported
            }
        }),
        EvidenceOrigin::FormativePracticeCompletion => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            ObjectiveProficiencyState::NeedsReview => ObjectiveProficiencyState::NeedsReview,
            _ => ObjectiveProficiencyState::InProgress,
        }),
        EvidenceOrigin::UnverifiedDiagnosticClaim => Ok(match current {
            ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
            _ => ObjectiveProficiencyState::SelfReported,
        }),
        EvidenceOrigin::ReviewedAnchorAssessmentPass {
            independent_performance: true,
        } => Ok(ObjectiveProficiencyState::Demonstrated),
        EvidenceOrigin::ReviewedAnchorAssessmentPass {
            independent_performance: false,
        } => Ok(ObjectiveProficiencyState::InProgress),
    }
}

/// Layer 3: Spaced review schedule item (`PED-005`, `PROG-002`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewScheduleItem {
    pub review_item_id: String,
    pub objective_id: String,
    pub interval_days: u32,
    pub due_at_iso: String,
    pub is_completed: bool,
}

/// Validates that a non-waived objective has complete pedagogical triad coverage
/// (`instruction`, `practice`, and `assessment`) (`PED-001`, `@S10`, `@S13`).
pub fn validate_pedagogical_triad_coverage(
    objective_id: &str,
    has_instruction: bool,
    has_practice: bool,
    has_assessment: bool,
) -> Result<(), DomainError> {
    let mut missing = Vec::new();
    if !has_instruction {
        missing.push("instruction".to_string());
    }
    if !has_practice {
        missing.push("practice".to_string());
    }
    if !has_assessment {
        missing.push("assessment".to_string());
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(DomainError::MissingPedagogicalTriadCoverage {
            objective_id: objective_id.to_string(),
            missing_kinds: missing,
        })
    }
}

// =============================================================================
// T05: Practice, Reviewed Anchor Assessments, Assistance Levels, and Mastery Gates
// =============================================================================

/// Level of assistance used during an assessment or practice attempt (`PED-003`, `@S80`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistanceLevel {
    Independent,
    HintUsed,
    SolutionStudied,
}

impl AssistanceLevel {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AssistanceLevel::Independent => "independent",
            AssistanceLevel::HintUsed => "hint_used",
            AssistanceLevel::SolutionStudied => "solution_studied",
        }
    }

    pub fn from_wire(value: &str) -> Result<Self, DomainError> {
        match value.trim() {
            "independent" | "none" => Ok(AssistanceLevel::Independent),
            "hint_used" | "hint" | "guided" => Ok(AssistanceLevel::HintUsed),
            "solution_studied" | "solution_viewed" | "worked_solution" => {
                Ok(AssistanceLevel::SolutionStudied)
            }
            other => Err(DomainError::AssessmentInvariantViolation(format!(
                "unknown assistance level `{other}`"
            ))),
        }
    }

    #[must_use]
    pub fn is_independent(self) -> bool {
        matches!(self, AssistanceLevel::Independent)
    }

    /// Escalates assistance monotonically within an attempt (`SolutionStudied > HintUsed > Independent`).
    #[must_use]
    pub fn escalate(self, other: AssistanceLevel) -> AssistanceLevel {
        match (self, other) {
            (AssistanceLevel::SolutionStudied, _) | (_, AssistanceLevel::SolutionStudied) => {
                AssistanceLevel::SolutionStudied
            }
            (AssistanceLevel::HintUsed, _) | (_, AssistanceLevel::HintUsed) => {
                AssistanceLevel::HintUsed
            }
            _ => AssistanceLevel::Independent,
        }
    }
}

/// Distinguishes unreviewed AI formative practice from curator-reviewed anchor assessments (`PED-002`, `PED-004`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentKind {
    ReviewedAnchor,
    AiPractice,
}

impl AssessmentKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AssessmentKind::ReviewedAnchor => "reviewed_anchor",
            AssessmentKind::AiPractice => "ai_practice",
        }
    }
}

/// Review and operational status of an assessment (`PED-004`, `CTRL-021`, `CTRL-022`, `@S40`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentReviewStatus {
    Approved,
    Quarantined,
    Suspended,
    Retired,
    UnreviewedPractice,
}

impl AssessmentReviewStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AssessmentReviewStatus::Approved => "approved",
            AssessmentReviewStatus::Quarantined => "quarantined",
            AssessmentReviewStatus::Suspended => "suspended",
            AssessmentReviewStatus::Retired => "retired",
            AssessmentReviewStatus::UnreviewedPractice => "unreviewed_practice",
        }
    }
}

/// Outcome of evaluating an assessment attempt (`PED-002`, `PED-003`, `PED-004`, `@S14`, `@S16`, `@S40`, `@S80`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvaluatedAssessmentAttempt {
    pub passed: bool,
    pub score_bp: u32,
    pub assistance_level: AssistanceLevel,
    pub evidence_origin: EvidenceOrigin,
    pub derived_proficiency_state: ObjectiveProficiencyState,
    pub contract_proficiency_label: String,
}

/// Evaluates an attempt against `PED-002..PED-004`, `CTRL-021..CTRL-022`, `@S14`, `@S16`, `@S40`, `@S80`:
/// - `AiPractice` or non-`Approved` assessments can never produce `Demonstrated` proficiency.
/// - Only an `Independent` pass (`score_bp >= mastery_threshold_bp`) on an `Approved` `ReviewedAnchor`
///   assessment yields `ObjectiveProficiencyState::Demonstrated` (`"demonstrated"`).
/// - Assisted passes (`HintUsed` or `SolutionStudied`) yield `ObjectiveProficiencyState::InProgress`
///   (`"assisted_progress"` in contract projection) and never satisfy mastery gates (`@S80`).
pub fn evaluate_assessment_attempt(
    kind: AssessmentKind,
    review_status: AssessmentReviewStatus,
    assistance_level: AssistanceLevel,
    score_bp: u32,
    mastery_threshold_bp: u32,
    current_state: ObjectiveProficiencyState,
) -> Result<EvaluatedAssessmentAttempt, DomainError> {
    if score_bp > 10_000 || mastery_threshold_bp == 0 || mastery_threshold_bp > 10_000 {
        return Err(DomainError::AssessmentInvariantViolation(format!(
            "invalid basis points score={score_bp}, threshold={mastery_threshold_bp}"
        )));
    }

    let passed = score_bp >= mastery_threshold_bp;

    match (kind, review_status) {
        (AssessmentKind::AiPractice, _) | (_, AssessmentReviewStatus::UnreviewedPractice) => {
            let next = derive_proficiency_transition(
                current_state,
                EvidenceOrigin::FormativePracticeCompletion,
            )?;
            Ok(EvaluatedAssessmentAttempt {
                passed,
                score_bp,
                assistance_level,
                evidence_origin: EvidenceOrigin::FormativePracticeCompletion,
                derived_proficiency_state: next,
                contract_proficiency_label: "practiced".to_string(),
            })
        }
        (
            AssessmentKind::ReviewedAnchor,
            AssessmentReviewStatus::Quarantined
            | AssessmentReviewStatus::Suspended
            | AssessmentReviewStatus::Retired,
        ) => Err(DomainError::AssessmentInvariantViolation(format!(
            "cannot award mastery credit on {:?} assessment",
            review_status
        ))),
        (AssessmentKind::ReviewedAnchor, AssessmentReviewStatus::Approved) => {
            if !passed {
                let next = match current_state {
                    ObjectiveProficiencyState::Demonstrated => {
                        ObjectiveProficiencyState::Demonstrated
                    }
                    _ => ObjectiveProficiencyState::NeedsReview,
                };
                let origin = if assistance_level.is_independent() {
                    EvidenceOrigin::FormativePracticeCompletion
                } else {
                    EvidenceOrigin::ReviewedAnchorAssessmentPass {
                        independent_performance: false,
                    }
                };
                return Ok(EvaluatedAssessmentAttempt {
                    passed: false,
                    score_bp,
                    assistance_level,
                    evidence_origin: origin,
                    derived_proficiency_state: next,
                    contract_proficiency_label: if matches!(
                        next,
                        ObjectiveProficiencyState::Demonstrated
                    ) {
                        "demonstrated".to_string()
                    } else {
                        "needs_review".to_string()
                    },
                });
            }

            let independent = assistance_level.is_independent();
            let origin = EvidenceOrigin::ReviewedAnchorAssessmentPass {
                independent_performance: independent,
            };
            let next = derive_proficiency_transition(current_state, origin)?;
            let label = if independent {
                "demonstrated"
            } else {
                "assisted_progress"
            };
            Ok(EvaluatedAssessmentAttempt {
                passed: true,
                score_bp,
                assistance_level,
                evidence_origin: origin,
                derived_proficiency_state: next,
                contract_proficiency_label: label.to_string(),
            })
        }
    }
}

/// Learner's explicit gate decision when prerequisites are not yet independently demonstrated (`PED-005`, `@S15`, `@S38`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LearnerGateDecision {
    PrerequisiteOverrideRecorded,
    UnverifiedPrerequisiteAcknowledged,
}

/// Prerequisite status input for `evaluate_prerequisite_gate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrerequisiteGateInput {
    pub objective_id: String,
    pub proficiency_state: ObjectiveProficiencyState,
    pub has_active_reviewed_anchor: bool,
}

/// Result of evaluating a mastery gate (`PED-005`, `@S15`, `@S38`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum MasteryGateEvaluation {
    Unlocked,
    BlockedMissingPrerequisite {
        missing_objective_ids: Vec<String>,
        remediation_required: bool,
        requires_unverified_acknowledgement: bool,
    },
    AllowedWithAudit {
        audit_event_kind: String,
        missing_objective_ids: Vec<String>,
    },
}

/// Pure prerequisite mastery gate policy (`PED-005`, `@S15`, `@S38`, `@S80`):
/// - Non-gated objectives are immediately `Unlocked`.
/// - Mastery-gated objectives require every prerequisite to be `ObjectiveProficiencyState::Demonstrated`.
/// - If any prerequisite is not `Demonstrated`:
///   - When a prerequisite has no active reviewed anchor assessment (`!has_active_reviewed_anchor`, `@S38`),
///     the learner may proceed only with `LearnerGateDecision::UnverifiedPrerequisiteAcknowledged`
///     (or `PrerequisiteOverrideRecorded`), emitting `"unverified_prerequisite_acknowledged"`.
///   - When active reviewed anchors exist (`@S15`), the learner is blocked until remediation OR explicit
///     `LearnerGateDecision::PrerequisiteOverrideRecorded`, emitting `"prerequisite_override_recorded"`.
#[must_use]
pub fn evaluate_prerequisite_gate(
    is_mastery_gated: bool,
    prerequisites: &[PrerequisiteGateInput],
    learner_decision: Option<LearnerGateDecision>,
) -> MasteryGateEvaluation {
    if !is_mastery_gated {
        return MasteryGateEvaluation::Unlocked;
    }

    let missing: Vec<&PrerequisiteGateInput> = prerequisites
        .iter()
        .filter(|p| p.proficiency_state != ObjectiveProficiencyState::Demonstrated)
        .collect();

    if missing.is_empty() {
        return MasteryGateEvaluation::Unlocked;
    }

    let missing_ids: Vec<String> = missing.iter().map(|p| p.objective_id.clone()).collect();
    let any_missing_active_anchor = missing.iter().any(|p| !p.has_active_reviewed_anchor);

    match learner_decision {
        Some(LearnerGateDecision::UnverifiedPrerequisiteAcknowledged)
            if any_missing_active_anchor =>
        {
            MasteryGateEvaluation::AllowedWithAudit {
                audit_event_kind: "unverified_prerequisite_acknowledged".to_string(),
                missing_objective_ids: missing_ids,
            }
        }
        Some(LearnerGateDecision::PrerequisiteOverrideRecorded) => {
            let kind = if any_missing_active_anchor
                && missing.iter().all(|p| !p.has_active_reviewed_anchor)
            {
                "unverified_prerequisite_acknowledged"
            } else {
                "prerequisite_override_recorded"
            };
            MasteryGateEvaluation::AllowedWithAudit {
                audit_event_kind: kind.to_string(),
                missing_objective_ids: missing_ids,
            }
        }
        _ => MasteryGateEvaluation::BlockedMissingPrerequisite {
            missing_objective_ids: missing_ids,
            remediation_required: missing.iter().any(|p| p.has_active_reviewed_anchor),
            requires_unverified_acknowledgement: any_missing_active_anchor,
        },
    }
}

/// Historical attempt snapshot for deterministic answer-key correction recomputation (`PED-004`, `@S40`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoricalAttemptForKeyCorrection {
    pub attempt_id: String,
    pub account_id: String,
    pub objective_id: String,
    pub assistance_level: AssistanceLevel,
    pub responses: BTreeMap<String, String>,
    pub previous_score_bp: u32,
    pub previous_passed: bool,
    pub previous_proficiency_state: ObjectiveProficiencyState,
}

/// Attributable result of recomputing a historical attempt after an answer-key correction (`PED-004`, `@S40`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecomputedAttemptOutcome {
    pub attempt_id: String,
    pub account_id: String,
    pub objective_id: String,
    pub new_score_bp: u32,
    pub new_passed: bool,
    pub new_proficiency_state: ObjectiveProficiencyState,
    pub new_contract_proficiency_label: String,
    pub new_key_revision: u32,
    pub correction_id: String,
}

/// Pure deterministic recalculation of historical attempts after a curator fixes a defective answer key (`PED-004`, `@S40`).
pub fn recalculate_attempts_for_key_correction(
    attempts: &[HistoricalAttemptForKeyCorrection],
    updated_answer_key: &BTreeMap<String, String>,
    mastery_threshold_bp: u32,
    new_key_revision: u32,
    correction_id: &str,
) -> Result<Vec<RecomputedAttemptOutcome>, DomainError> {
    if updated_answer_key.is_empty() {
        return Err(DomainError::AssessmentInvariantViolation(
            "updated answer key cannot be empty".to_string(),
        ));
    }
    let total_items = updated_answer_key.len() as u32;
    let mut outcomes = Vec::with_capacity(attempts.len());

    for attempt in attempts {
        let mut correct_count = 0u32;
        for (item_id, expected_answer) in updated_answer_key {
            if let Some(actual) = attempt.responses.get(item_id) {
                if actual.trim().eq_ignore_ascii_case(expected_answer.trim()) {
                    correct_count += 1;
                }
            }
        }
        let score_bp = (correct_count * 10_000) / total_items;
        let eval = evaluate_assessment_attempt(
            AssessmentKind::ReviewedAnchor,
            AssessmentReviewStatus::Approved,
            attempt.assistance_level,
            score_bp,
            mastery_threshold_bp,
            attempt.previous_proficiency_state,
        )?;
        outcomes.push(RecomputedAttemptOutcome {
            attempt_id: attempt.attempt_id.clone(),
            account_id: attempt.account_id.clone(),
            objective_id: attempt.objective_id.clone(),
            new_score_bp: eval.score_bp,
            new_passed: eval.passed,
            new_proficiency_state: eval.derived_proficiency_state,
            new_contract_proficiency_label: eval.contract_proficiency_label,
            new_key_revision,
            correction_id: correction_id.to_string(),
        });
    }

    Ok(outcomes)
}
