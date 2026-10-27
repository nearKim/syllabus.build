//! Spaced repetition lifecycle, schedule recalculation math, adaptive diagnostics, and objective waivers.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    ActivityComponentBreakdown, DomainError, EffortTriplet, ObjectiveProficiencyState,
    format_epoch_utc_iso,
};

// =============================================================================
// T06: Spaced Repetition Lifecycle & Schedule Recalculation Math
// =============================================================================

/// Canonical spaced repetition intervals in days (`PED-006`, `@S17`..`@S19`).
pub const CANONICAL_SPACED_INTERVAL_DAYS: [u32; 5] = [1, 3, 7, 14, 30];

/// Status lifecycle for a spaced review item (`PED-006`, `T06`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewScheduleStatus {
    Scheduled,
    Due,
    Completed,
    Overdue,
    Rescheduled,
}

impl ReviewScheduleStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ReviewScheduleStatus::Scheduled => "scheduled",
            ReviewScheduleStatus::Due => "due",
            ReviewScheduleStatus::Completed => "completed",
            ReviewScheduleStatus::Overdue => "overdue",
            ReviewScheduleStatus::Rescheduled => "rescheduled",
        }
    }
}

/// Full spaced repetition review schedule item bound to a distinct future study session (`PED-006`, `@S17`, `@S19`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpacedReviewRecord {
    pub review_item_id: String,
    pub objective_id: String,
    pub source_session_id: String,
    pub scheduled_session_id: String,
    pub interval_index: usize,
    pub interval_days: u32,
    pub interval_policy_version: String,
    pub status: ReviewScheduleStatus,
    pub due_at_epoch_seconds: i64,
    pub due_at_iso: String,
    pub completed_at_iso: Option<String>,
}

/// Creates the initial spaced review item after an independent assessment pass,
/// enforcing that `scheduled_session_id != source_session_id` (`PED-006`, `@S17`, `@S19`).
pub fn schedule_initial_spaced_review(
    review_item_id: &str,
    objective_id: &str,
    source_session_id: &str,
    scheduled_session_id: &str,
    passed_at_epoch_seconds: i64,
) -> Result<SpacedReviewRecord, DomainError> {
    if source_session_id.trim().is_empty() || scheduled_session_id.trim().is_empty() {
        return Err(DomainError::SpacedReviewInvariantViolation(
            "source_session_id and scheduled_session_id must be non-empty".to_string(),
        ));
    }
    if source_session_id.trim() == scheduled_session_id.trim() {
        return Err(DomainError::SpacedReviewInvariantViolation(format!(
            "spaced review for `{objective_id}` must be scheduled in a distinct study session (`{source_session_id}` == `{scheduled_session_id}`)"
        )));
    }
    let interval_days = CANONICAL_SPACED_INTERVAL_DAYS[0];
    let due_at_epoch_seconds = passed_at_epoch_seconds + (interval_days as i64) * 86_400;
    Ok(SpacedReviewRecord {
        review_item_id: review_item_id.to_string(),
        objective_id: objective_id.to_string(),
        source_session_id: source_session_id.to_string(),
        scheduled_session_id: scheduled_session_id.to_string(),
        interval_index: 0,
        interval_days,
        interval_policy_version: "spaced-v1".to_string(),
        status: ReviewScheduleStatus::Scheduled,
        due_at_epoch_seconds,
        due_at_iso: format_epoch_utc_iso(due_at_epoch_seconds),
        completed_at_iso: None,
    })
}

/// Evaluates or advances a spaced review item across `scheduled -> due -> overdue -> rescheduled / completed` (`@S17`..`@S19`).
pub fn advance_spaced_review_item(
    current: &SpacedReviewRecord,
    now_epoch_seconds: i64,
    review_attempt_session_id: Option<&str>,
    independent_pass: Option<bool>,
    reschedule_to_session_id: Option<&str>,
) -> Result<(SpacedReviewRecord, Option<SpacedReviewRecord>), DomainError> {
    let mut updated = current.clone();

    if let Some(passed) = independent_pass {
        let session_id = review_attempt_session_id.ok_or_else(|| {
            DomainError::SpacedReviewInvariantViolation(
                "review attempt requires a study session_id".to_string(),
            )
        })?;
        if session_id.trim() == current.source_session_id.trim() {
            return Err(DomainError::SpacedReviewInvariantViolation(
                "same-session quiz cannot count as spaced repetition".to_string(),
            ));
        }

        if passed {
            updated.status = ReviewScheduleStatus::Completed;
            updated.completed_at_iso = Some(format_epoch_utc_iso(now_epoch_seconds));
            let next_index = (current.interval_index + 1).min(CANONICAL_SPACED_INTERVAL_DAYS.len() - 1);
            let next_days = CANONICAL_SPACED_INTERVAL_DAYS[next_index];
            let next_due = now_epoch_seconds + (next_days as i64) * 86_400;
            let next_session = reschedule_to_session_id
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{session_id}-next-{}", next_index + 1));
            let follow_up = SpacedReviewRecord {
                review_item_id: format!("{}-r{}", current.review_item_id, next_index + 1),
                objective_id: current.objective_id.clone(),
                source_session_id: session_id.to_string(),
                scheduled_session_id: next_session,
                interval_index: next_index,
                interval_days: next_days,
                interval_policy_version: current.interval_policy_version.clone(),
                status: ReviewScheduleStatus::Scheduled,
                due_at_epoch_seconds: next_due,
                due_at_iso: format_epoch_utc_iso(next_due),
                completed_at_iso: None,
            };
            return Ok((updated, Some(follow_up)));
        } else {
            // Failed spaced review resets interval to index 0 (`1 day`) and marks item rescheduled (`@S18`)
            let reset_days = CANONICAL_SPACED_INTERVAL_DAYS[0];
            let next_due = now_epoch_seconds + (reset_days as i64) * 86_400;
            updated.interval_index = 0;
            updated.interval_days = reset_days;
            updated.status = ReviewScheduleStatus::Rescheduled;
            updated.source_session_id = session_id.to_string();
            updated.scheduled_session_id = reschedule_to_session_id
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{session_id}-reset"));
            updated.due_at_epoch_seconds = next_due;
            updated.due_at_iso = format_epoch_utc_iso(next_due);
            return Ok((updated, None));
        }
    }

    if let Some(new_session) = reschedule_to_session_id {
        if new_session.trim() == current.source_session_id.trim() {
            return Err(DomainError::SpacedReviewInvariantViolation(
                "rescheduled session must be distinct from source_session_id".to_string(),
            ));
        }
        updated.scheduled_session_id = new_session.to_string();
        updated.status = ReviewScheduleStatus::Rescheduled;
        if now_epoch_seconds >= updated.due_at_epoch_seconds {
            updated.due_at_epoch_seconds = now_epoch_seconds + 86_400;
            updated.due_at_iso = format_epoch_utc_iso(updated.due_at_epoch_seconds);
        }
        return Ok((updated, None));
    }

    if updated.status != ReviewScheduleStatus::Completed {
        if now_epoch_seconds > updated.due_at_epoch_seconds + 86_400 {
            updated.status = ReviewScheduleStatus::Overdue;
        } else if now_epoch_seconds >= updated.due_at_epoch_seconds {
            updated.status = ReviewScheduleStatus::Due;
        }
    }

    Ok((updated, None))
}

/// Input for pure schedule recalculation (`SCH-001`..`SCH-005`, `@S20`..`@S22`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScheduleRecalculationInput {
    pub weekly_hours: f64,
    pub preferred_playback_speed: f64,
    pub target_horizon_weeks: u32,
    pub missed_sessions_count: u32,
    pub remaining_activities: Vec<(String, ActivityComponentBreakdown)>,
}

/// Output of pure schedule recalculation (`SCH-001`..`SCH-005`, `@S20`..`@S22`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecalculatedScheduleSummary {
    pub weekly_cap_minutes: u32,
    pub total_effort: EffortTriplet,
    pub projected_weeks: u32,
    pub weekly_allocations: Vec<Vec<String>>,
    pub is_feasible_within_horizon: bool,
    pub feasibility_warning: Option<String>,
}

/// Pure schedule recalculation (`SCH-001`..`SCH-005`, `@S20`..`@S22`):
/// - Scales only media by `preferred_playback_speed`.
/// - Respects `weekly_cap_minutes = round(weekly_hours * 60)` without silently exceeding weekly capacity (`@S21`).
/// - Shifts missed sessions forward and computes whether `projected_weeks <= target_horizon_weeks` (`@S22`).
pub fn recalculate_schedule_plan(
    input: &ScheduleRecalculationInput,
) -> Result<RecalculatedScheduleSummary, DomainError> {
    if !input.weekly_hours.is_finite() || input.weekly_hours <= 0.0 || input.weekly_hours > 80.0 {
        return Err(DomainError::SpacedReviewInvariantViolation(format!(
            "invalid weekly_hours: {}",
            input.weekly_hours
        )));
    }
    let weekly_cap_minutes = (input.weekly_hours * 60.0).round() as u32;
    if weekly_cap_minutes == 0 {
        return Err(DomainError::SpacedReviewInvariantViolation(
            "weekly_cap_minutes must be > 0".to_string(),
        ));
    }

    let mut total_min = 0u32;
    let mut total_point = 0u32;
    let mut total_max = 0u32;

    let mut weekly_allocations: Vec<Vec<String>> = Vec::new();
    let mut current_week: Vec<String> = Vec::new();
    let mut current_week_minutes = 0u32;

    for (activity_id, breakdown) in &input.remaining_activities {
        let adjusted = breakdown.adjusted_effort(input.preferred_playback_speed)?;
        total_min += adjusted.min_minutes;
        total_point += adjusted.point_minutes;
        total_max += adjusted.max_minutes;

        if !current_week.is_empty()
            && current_week_minutes + adjusted.point_minutes > weekly_cap_minutes
        {
            weekly_allocations.push(current_week);
            current_week = Vec::new();
            current_week_minutes = 0;
        }
        current_week.push(activity_id.clone());
        current_week_minutes += adjusted.point_minutes;
    }

    if !current_week.is_empty() {
        weekly_allocations.push(current_week);
    }

    let base_weeks = if total_point == 0 {
        0
    } else {
        total_point.div_ceil(weekly_cap_minutes).max(weekly_allocations.len() as u32)
    };
    let missed_week_penalty = input.missed_sessions_count.div_ceil(3);
    let projected_weeks = base_weeks + missed_week_penalty;
    let is_feasible_within_horizon = projected_weeks <= input.target_horizon_weeks.max(1);
    let feasibility_warning = if is_feasible_within_horizon {
        None
    } else {
        Some(format!(
            "Projected duration ({projected_weeks} weeks at {} min/week cap) exceeds target horizon ({} weeks). Increase weekly hours, extend deadline, or reduce scope.",
            weekly_cap_minutes,
            input.target_horizon_weeks
        ))
    };

    Ok(RecalculatedScheduleSummary {
        weekly_cap_minutes,
        total_effort: EffortTriplet {
            min_minutes: total_min,
            point_minutes: total_point,
            max_minutes: total_max,
        },
        projected_weeks,
        weekly_allocations,
        is_feasible_within_horizon,
        feasibility_warning,
    })
}

// =============================================================================
// T12: Objective Diagnostics, Waivers, and Orthogonal Math Depth
// =============================================================================

/// Learner's preferred mathematical presentation depth (`PED-010`, `@S12`).
/// Stored independently from objective proficiency so demonstrating mastery in one topic
/// never overwrites the learner's presentation preference in another topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MathDepthPreference {
    Formal,
    Intuitive,
    Applied,
}

impl MathDepthPreference {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            MathDepthPreference::Formal => "formal",
            MathDepthPreference::Intuitive => "intuitive",
            MathDepthPreference::Applied => "applied",
        }
    }

    pub fn from_wire(value: &str) -> Result<Self, DomainError> {
        match value.trim() {
            "formal" | "proof_heavy" => Ok(MathDepthPreference::Formal),
            "intuitive" | "intuition_first" => Ok(MathDepthPreference::Intuitive),
            "applied" | "application_focused" => Ok(MathDepthPreference::Applied),
            other => Err(DomainError::ProficiencyInvariantViolation(format!(
                "invalid math_depth_preference `{other}`"
            ))),
        }
    }
}

/// Reason a diagnostic session concluded (`PED-007`, `@S70`, `@S81`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticStopReason {
    AllItemsAnswered,
    LearnerStopped,
    UncertaintyBoundReached,
}

impl DiagnosticStopReason {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            DiagnosticStopReason::AllItemsAnswered => "all_items_answered",
            DiagnosticStopReason::LearnerStopped => "learner_stopped",
            DiagnosticStopReason::UncertaintyBoundReached => "uncertainty_bound_reached",
        }
    }
}

/// Evaluated objective evidence from a diagnostic session (`PED-007`, `@S70`, `@S81`).
/// Unreached objectives remain explicitly `ObjectiveProficiencyState::Unassessed`.
#[must_use]
pub fn partition_diagnostic_objectives(
    candidate_objective_ids: &[String],
    answered_independent_results: &BTreeMap<String, bool>,
) -> BTreeMap<String, ObjectiveProficiencyState> {
    let mut states = BTreeMap::new();
    for obj_id in candidate_objective_ids {
        let state = match answered_independent_results.get(obj_id) {
            Some(true) => ObjectiveProficiencyState::Demonstrated,
            Some(false) => ObjectiveProficiencyState::NeedsReview,
            None => ObjectiveProficiencyState::Unassessed,
        };
        states.insert(obj_id.clone(), state);
    }
    states
}

/// Evidence presented to request an `ObjectiveWaiver` (`PED-008`, `CTRL-023`, `@S71`, `@S72`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WaiverEvidenceSource {
    DiagnosticDemonstrated {
        diagnostic_id: String,
        assessed_objective_id: String,
        equivalence_mapping_id: Option<String>,
    },
    ReviewedAnchorPassed {
        attempt_id: String,
        assessed_objective_id: String,
        independent: bool,
        equivalence_mapping_id: Option<String>,
    },
    EquivalentReviewedCredential {
        credential_ref: String,
        assessed_objective_id: String,
        equivalence_mapping_id: Option<String>,
    },
    SelfReportedClaim,
    ActivityCompletionOnly,
    CommunityUpvote,
    UnreviewedAiGrade,
}

/// Validates whether an objective can be waived (`PED-008`, `CTRL-023`, `@S71`, `@S72`):
/// - Rejects self-report, completion-only, community upvotes, assisted attempts, and unreviewed AI grades.
/// - Requires exact objective match OR an explicit `equivalence_mapping_id`.
pub fn validate_objective_waiver(
    target_objective_id: &str,
    evidence: &WaiverEvidenceSource,
) -> Result<(), DomainError> {
    let check_match = |assessed_id: &str, eq_map: &Option<String>| -> Result<(), DomainError> {
        if assessed_id == target_objective_id {
            return Ok(());
        }
        if let Some(mapping) = eq_map {
            if !mapping.trim().is_empty() {
                return Ok(());
            }
        }
        Err(DomainError::WaiverInvariantViolation {
            objective_id: target_objective_id.to_string(),
            reason: format!(
                "assessed objective `{assessed_id}` does not match `{target_objective_id}` and has no explicit equivalence_mapping_id"
            ),
        })
    };

    match evidence {
        WaiverEvidenceSource::DiagnosticDemonstrated {
            diagnostic_id,
            assessed_objective_id,
            equivalence_mapping_id,
        } => {
            if diagnostic_id.trim().is_empty() {
                return Err(DomainError::WaiverInvariantViolation {
                    objective_id: target_objective_id.to_string(),
                    reason: "diagnostic_id cannot be empty".to_string(),
                });
            }
            check_match(assessed_objective_id, equivalence_mapping_id)
        }
        WaiverEvidenceSource::ReviewedAnchorPassed {
            attempt_id,
            assessed_objective_id,
            independent,
            equivalence_mapping_id,
        } => {
            if !independent {
                return Err(DomainError::WaiverInvariantViolation {
                    objective_id: target_objective_id.to_string(),
                    reason: "assisted anchor attempts cannot waive objectives".to_string(),
                });
            }
            if attempt_id.trim().is_empty() {
                return Err(DomainError::WaiverInvariantViolation {
                    objective_id: target_objective_id.to_string(),
                    reason: "attempt_id cannot be empty".to_string(),
                });
            }
            check_match(assessed_objective_id, equivalence_mapping_id)
        }
        WaiverEvidenceSource::EquivalentReviewedCredential {
            credential_ref,
            assessed_objective_id,
            equivalence_mapping_id,
        } => {
            if credential_ref.trim().is_empty() {
                return Err(DomainError::WaiverInvariantViolation {
                    objective_id: target_objective_id.to_string(),
                    reason: "credential_ref cannot be empty".to_string(),
                });
            }
            check_match(assessed_objective_id, equivalence_mapping_id)
        }
        WaiverEvidenceSource::SelfReportedClaim
        | WaiverEvidenceSource::ActivityCompletionOnly
        | WaiverEvidenceSource::CommunityUpvote
        | WaiverEvidenceSource::UnreviewedAiGrade => Err(DomainError::WaiverInvariantViolation {
            objective_id: target_objective_id.to_string(),
            reason: "unverified self-report, completion, upvote, or unreviewed AI grade cannot waive objectives (`CTRL-023`)".to_string(),
        }),
    }
}
