//! Reminder scheduling & DST policy, account deletion impact, pedagogical evaluation benchmarks, and native alarm boundaries.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::DomainError;

// =============================================================================
// T08: Notification Preferences, DST Resolution & Reminder Scheduling Policy
// =============================================================================

/// DST resolution policy applied when converting local wall-clock time to UTC (`REM-002`, `T08`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DstResolutionPolicy {
    ExactLocalTime,
    SpringForwardShifted,
    FallBackFirstOccurrence,
}

impl DstResolutionPolicy {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            DstResolutionPolicy::ExactLocalTime => "exact_local_time",
            DstResolutionPolicy::SpringForwardShifted => "spring_forward_shifted",
            DstResolutionPolicy::FallBackFirstOccurrence => "fall_back_first_occurrence",
        }
    }
}

/// Input parameters for `compute_next_reminder_utc` (`REM-001`..`REM-005`, `NFR-007`, `@S27`, `@S33`, `@S34`, `@S60`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReminderScheduleInput {
    pub enabled: bool,
    pub iana_timezone: String,
    pub local_date_yyyy_mm_dd: String,
    pub local_time_hhmm: String,
    pub quiet_hours_start_hhmm: Option<String>,
    pub quiet_hours_end_hhmm: Option<String>,
    pub today_study_completed: bool,
    pub now_utc_epoch_seconds: i64,
}

/// Deterministic decision returned by `compute_next_reminder_utc` (`T08`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum ReminderScheduleDecision {
    Scheduled {
        scheduled_utc_epoch: i64,
        scheduled_utc_iso: String,
        expires_utc_epoch: i64,
        expires_utc_iso: String,
        dst_resolution_policy: DstResolutionPolicy,
        deferred_for_quiet_hours: bool,
    },
    SuppressedDisabled,
    SuppressedStudyCompletedToday,
    SuppressedExpiredBacklog,
}

/// Computes the next UTC reminder instant for a learner (`REM-001`..`REM-005`, `NFR-007`, `@S27`, `@S33`, `@S34`, `@S60`):
/// - Opt-in disabled -> `SuppressedDisabled`.
/// - Today's scheduled study already completed -> `SuppressedStudyCompletedToday` (`@S27`, `@S33`).
/// - Resolves IANA timezone (`UTC`, `America/New_York`, `America/Chicago`, `America/Los_Angeles`,
///   `Europe/London`, `Europe/Berlin`, `Asia/Tokyo`):
///   - Spring-forward nonexistent local time (e.g. `2026-03-08` `02:30` in `America/New_York`)
///     shifts forward to the first valid local instant after the gap (`03:00 EDT` = `07:00:00Z`)
///     with `DstResolutionPolicy::SpringForwardShifted`.
///   - Fall-back ambiguous local time (e.g. `2026-11-01` `01:30` in `America/New_York`)
///     selects the first occurrence (`01:30 EDT` = `05:30:00Z`) with `DstResolutionPolicy::FallBackFirstOccurrence`.
/// - Quiet-hours window defers the reminder to `quiet_hours_end_hhmm`.
/// - If the resulting reminder window (`scheduled_utc + 12h`) has already expired relative to `now_utc_epoch_seconds`,
///   returns `SuppressedExpiredBacklog` so reconnecting clients are never spammed with expired reminders (`@S34`, `@S60`).
pub fn compute_next_reminder_utc(
    input: &ReminderScheduleInput,
) -> Result<ReminderScheduleDecision, DomainError> {
    if !input.enabled {
        return Ok(ReminderScheduleDecision::SuppressedDisabled);
    }
    if input.today_study_completed {
        return Ok(ReminderScheduleDecision::SuppressedStudyCompletedToday);
    }

    let (year, month, day) = parse_yyyy_mm_dd(&input.local_date_yyyy_mm_dd)?;
    let (mut hour, mut minute) = parse_hhmm(&input.local_time_hhmm)?;

    let mut deferred_for_quiet_hours = false;
    if let (Some(q_start), Some(q_end)) = (
        input.quiet_hours_start_hhmm.as_deref(),
        input.quiet_hours_end_hhmm.as_deref(),
    ) {
        let (qs_h, qs_m) = parse_hhmm(q_start)?;
        let (qe_h, qe_m) = parse_hhmm(q_end)?;
        let target_mins = hour * 60 + minute;
        let start_mins = qs_h * 60 + qs_m;
        let end_mins = qe_h * 60 + qe_m;
        let in_quiet = if start_mins <= end_mins {
            target_mins >= start_mins && target_mins < end_mins
        } else {
            target_mins >= start_mins || target_mins < end_mins
        };
        if in_quiet {
            hour = qe_h;
            minute = qe_m;
            deferred_for_quiet_hours = true;
        }
    }

    let (offset_seconds, adj_hour, adj_minute, dst_policy) =
        resolve_iana_local_offset_seconds(&input.iana_timezone, year, month, day, hour, minute)?;

    let local_epoch = civil_date_time_to_epoch_seconds(year, month, day, adj_hour, adj_minute, 0);
    let scheduled_utc_epoch = local_epoch - (offset_seconds as i64);
    let expires_utc_epoch = scheduled_utc_epoch + 12 * 3600;

    if input.now_utc_epoch_seconds > expires_utc_epoch {
        return Ok(ReminderScheduleDecision::SuppressedExpiredBacklog);
    }

    Ok(ReminderScheduleDecision::Scheduled {
        scheduled_utc_epoch,
        scheduled_utc_iso: format_epoch_utc_iso(scheduled_utc_epoch),
        expires_utc_epoch,
        expires_utc_iso: format_epoch_utc_iso(expires_utc_epoch),
        dst_resolution_policy: dst_policy,
        deferred_for_quiet_hours,
    })
}

fn parse_yyyy_mm_dd(s: &str) -> Result<(i32, u32, u32), DomainError> {
    let parts: Vec<&str> = s.trim().split('-').collect();
    if parts.len() != 3 {
        return Err(DomainError::ReminderScheduleError(format!(
            "invalid date `{s}` (expected YYYY-MM-DD)"
        )));
    }
    let y = parts[0]
        .parse::<i32>()
        .map_err(|_| DomainError::ReminderScheduleError(format!("invalid year in `{s}`")))?;
    let m = parts[1]
        .parse::<u32>()
        .map_err(|_| DomainError::ReminderScheduleError(format!("invalid month in `{s}`")))?;
    let d = parts[2]
        .parse::<u32>()
        .map_err(|_| DomainError::ReminderScheduleError(format!("invalid day in `{s}`")))?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(DomainError::ReminderScheduleError(format!(
            "out-of-range month/day in `{s}`"
        )));
    }
    Ok((y, m, d))
}

fn parse_hhmm(s: &str) -> Result<(u32, u32), DomainError> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 2 {
        return Err(DomainError::ReminderScheduleError(format!(
            "invalid time `{s}` (expected HH:MM)"
        )));
    }
    let h = parts[0]
        .parse::<u32>()
        .map_err(|_| DomainError::ReminderScheduleError(format!("invalid hour in `{s}`")))?;
    let m = parts[1]
        .parse::<u32>()
        .map_err(|_| DomainError::ReminderScheduleError(format!("invalid minute in `{s}`")))?;
    if h > 23 || m > 59 {
        return Err(DomainError::ReminderScheduleError(format!(
            "out-of-range hour/minute in `{s}`"
        )));
    }
    Ok((h, m))
}

/// Resolves IANA timezone offset in seconds east of UTC, plus adjusted `(hour, minute, DstResolutionPolicy)`.
fn resolve_iana_local_offset_seconds(
    tz: &str,
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
) -> Result<(i32, u32, u32, DstResolutionPolicy), DomainError> {
    let (std_offset_hours, uses_us_dst, uses_eu_dst) = match tz.trim() {
        "UTC" | "Etc/UTC" => (0, false, false),
        "America/New_York" => (-5, true, false),
        "America/Chicago" => (-6, true, false),
        "America/Denver" => (-7, true, false),
        "America/Los_Angeles" => (-8, true, false),
        "Europe/London" => (0, false, true),
        "Europe/Berlin" | "Europe/Paris" => (1, false, true),
        "Asia/Tokyo" => (9, false, false),
        other => {
            return Err(DomainError::ReminderScheduleError(format!(
                "unsupported or invalid IANA timezone `{other}`"
            )))
        }
    };

    if uses_us_dst {
        // US DST: starts 2nd Sunday in March at 02:00 local -> 03:00 local;
        // ends 1st Sunday in November at 02:00 local -> 01:00 local.
        let march_second_sunday = nth_sunday_of_month(year, 3, 2);
        let nov_first_sunday = nth_sunday_of_month(year, 11, 1);

        if month == 3 && day == march_second_sunday {
            if hour == 2 {
                // Nonexistent spring-forward hour [02:00, 02:59] -> shift forward to 03:00 DST
                return Ok((
                    (std_offset_hours + 1) * 3600,
                    3,
                    0,
                    DstResolutionPolicy::SpringForwardShifted,
                ));
            } else if hour >= 3 {
                return Ok((
                    (std_offset_hours + 1) * 3600,
                    hour,
                    minute,
                    DstResolutionPolicy::ExactLocalTime,
                ));
            } else {
                return Ok((
                    std_offset_hours * 3600,
                    hour,
                    minute,
                    DstResolutionPolicy::ExactLocalTime,
                ));
            }
        }

        if month == 11 && day == nov_first_sunday {
            if hour == 1 {
                // Ambiguous fall-back fold [01:00, 01:59] -> select first occurrence (DST offset)
                return Ok((
                    (std_offset_hours + 1) * 3600,
                    hour,
                    minute,
                    DstResolutionPolicy::FallBackFirstOccurrence,
                ));
            } else if hour == 0 {
                return Ok((
                    (std_offset_hours + 1) * 3600,
                    hour,
                    minute,
                    DstResolutionPolicy::ExactLocalTime,
                ));
            } else {
                return Ok((
                    std_offset_hours * 3600,
                    hour,
                    minute,
                    DstResolutionPolicy::ExactLocalTime,
                ));
            }
        }

        let in_dst = (month > 3 && month < 11)
            || (month == 3 && day > march_second_sunday)
            || (month == 11 && day < nov_first_sunday);
        let offset = if in_dst {
            (std_offset_hours + 1) * 3600
        } else {
            std_offset_hours * 3600
        };
        return Ok((offset, hour, minute, DstResolutionPolicy::ExactLocalTime));
    }

    if uses_eu_dst {
        let march_last_sunday = last_sunday_of_month(year, 3);
        let oct_last_sunday = last_sunday_of_month(year, 10);
        let in_dst = (month > 3 && month < 10)
            || (month == 3 && day >= march_last_sunday)
            || (month == 10 && day < oct_last_sunday);
        let offset = if in_dst {
            (std_offset_hours + 1) * 3600
        } else {
            std_offset_hours * 3600
        };
        return Ok((offset, hour, minute, DstResolutionPolicy::ExactLocalTime));
    }

    Ok((
        std_offset_hours * 3600,
        hour,
        minute,
        DstResolutionPolicy::ExactLocalTime,
    ))
}

fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = y as i64 - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m = m as u64;
    let d = d as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + (doe as i64) - 719468
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    (y as i32, m as u32, d as u32)
}

fn civil_date_time_to_epoch_seconds(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> i64 {
    let days = days_from_civil(year, month, day);
    days * 86_400 + (hour as i64) * 3600 + (minute as i64) * 60 + (second as i64)
}

/// Formats epoch seconds as RFC 3339 UTC string `YYYY-MM-DDTHH:MM:SSZ`.
#[must_use]
pub fn format_epoch_utc_iso(epoch_seconds: i64) -> String {
    let days = epoch_seconds.div_euclid(86_400);
    let secs_of_day = epoch_seconds.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn weekday_sun0(y: i32, m: u32, d: u32) -> u32 {
    let days = days_from_civil(y, m, d);
    // 1970-01-01 was Thursday (4)
    (days + 4).rem_euclid(7) as u32
}

fn nth_sunday_of_month(y: i32, m: u32, nth: u32) -> u32 {
    let first_wday = weekday_sun0(y, m, 1);
    let first_sunday = if first_wday == 0 {
        1
    } else {
        1 + (7 - first_wday)
    };
    first_sunday + (nth - 1) * 7
}

fn last_sunday_of_month(y: i32, m: u32) -> u32 {
    let last_day = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    };
    let wday = weekday_sun0(y, m, last_day);
    last_day - wday
}

// =============================================================================


// =============================================================================
// T09: Account Deletion Impact & Tombstone Policy
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountDeletionImpact {
    pub deleted_account_id: String,
    pub withdrawn_publication_ids: Vec<String>,
    pub preserved_adopter_syllabus_ids: Vec<String>,
    pub tombstone_keys: Vec<String>,
}

pub fn evaluate_account_deletion_impact(
    account_id: &str,
    owned_publication_ids: &[String],
    adopter_syllabus_ids: &[String],
) -> Result<AccountDeletionImpact, DomainError> {
    if account_id.trim().is_empty() {
        return Err(DomainError::AccountLifecycleInvariantViolation(
            "account_id cannot be empty".to_string(),
        ));
    }
    let mut tombstone_keys = vec![format!("account:{account_id}")];
    for pub_id in owned_publication_ids {
        tombstone_keys.push(format!("publication:{pub_id}"));
    }
    Ok(AccountDeletionImpact {
        deleted_account_id: account_id.to_string(),
        withdrawn_publication_ids: owned_publication_ids.to_vec(),
        preserved_adopter_syllabus_ids: adopter_syllabus_ids.to_vec(),
        tombstone_keys,
    })
}

// =============================================================================
// T11: Pedagogical Evaluation Workstream & Benchmark Harness (`NFR-008`, `PROG-006`)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetrievalBenchmarkCase {
    pub query_id: String,
    pub retrieved_resource_ids: Vec<String>,
    pub relevant_resource_ids: Vec<String>,
    pub unlicensed_or_broken_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetrievalBenchmarkSummary {
    pub mean_precision_bp: u32,
    pub mean_recall_bp: u32,
    pub zero_unlicensed_or_broken: bool,
    pub passed: bool,
}

/// Evaluates Part 1 of the Pedagogical Evaluation Workstream: Retrieval Benchmark (`@S42`, `@S62`).
pub fn evaluate_retrieval_benchmark(
    cases: &[RetrievalBenchmarkCase],
    min_precision_bp: u32,
    min_recall_bp: u32,
) -> Result<RetrievalBenchmarkSummary, DomainError> {
    if cases.is_empty() {
        return Err(DomainError::PedagogicalEvaluationViolation(
            "retrieval benchmark requires at least one case".to_string(),
        ));
    }
    let mut total_precision_bp: u64 = 0;
    let mut total_recall_bp: u64 = 0;
    let mut zero_unlicensed_or_broken = true;

    for case in cases {
        if case.retrieved_resource_ids.is_empty() || case.relevant_resource_ids.is_empty() {
            return Err(DomainError::PedagogicalEvaluationViolation(format!(
                "retrieval benchmark case `{}` cannot have empty retrieved or relevant sets",
                case.query_id
            )));
        }
        if case.unlicensed_or_broken_count > 0 {
            zero_unlicensed_or_broken = false;
        }
        let relevant_set: BTreeSet<&String> = case.relevant_resource_ids.iter().collect();
        let hits = case
            .retrieved_resource_ids
            .iter()
            .filter(|id| relevant_set.contains(id))
            .count() as u64;
        let p_bp = (hits * 10_000) / (case.retrieved_resource_ids.len() as u64);
        let r_bp = (hits * 10_000) / (case.relevant_resource_ids.len() as u64);
        total_precision_bp += p_bp;
        total_recall_bp += r_bp;
    }

    let mean_precision_bp = (total_precision_bp / (cases.len() as u64)) as u32;
    let mean_recall_bp = (total_recall_bp / (cases.len() as u64)) as u32;
    let passed = zero_unlicensed_or_broken
        && mean_precision_bp >= min_precision_bp
        && mean_recall_bp >= min_recall_bp;

    Ok(RetrievalBenchmarkSummary {
        mean_precision_bp,
        mean_recall_bp,
        zero_unlicensed_or_broken,
        passed,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusExpertRubricScore {
    pub rater_id: String,
    pub prerequisite_coherence_bp: u32,
    pub workload_realism_bp: u32,
    pub pedagogical_triad_bp: u32,
    pub citation_grounding_bp: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyllabusExpertRubricEvaluation {
    pub composite_score_bp: u32,
    pub inter_rater_spread_bp: u32,
    pub passed: bool,
}

/// Evaluates Part 2 of the Pedagogical Evaluation Workstream: Syllabus Generation Expert Rubric (`@S42`).
pub fn evaluate_syllabus_expert_rubric(
    scores: &[SyllabusExpertRubricScore],
    min_composite_bp: u32,
    max_inter_rater_spread_bp: u32,
) -> Result<SyllabusExpertRubricEvaluation, DomainError> {
    if scores.len() < 2 {
        return Err(DomainError::PedagogicalEvaluationViolation(
            "syllabus expert rubric requires at least two independent raters".to_string(),
        ));
    }
    let mut rater_averages = Vec::with_capacity(scores.len());
    for s in scores {
        let avg = (s.prerequisite_coherence_bp
            + s.workload_realism_bp
            + s.pedagogical_triad_bp
            + s.citation_grounding_bp)
            / 4;
        rater_averages.push(avg);
    }
    let min_rater = *rater_averages.iter().min().unwrap_or(&0);
    let max_rater = *rater_averages.iter().max().unwrap_or(&0);
    let inter_rater_spread_bp = max_rater.saturating_sub(min_rater);
    let sum: u64 = rater_averages.iter().map(|v| *v as u64).sum();
    let composite_score_bp = (sum / (rater_averages.len() as u64)) as u32;
    let passed = composite_score_bp >= min_composite_bp
        && inter_rater_spread_bp <= max_inter_rater_spread_bp;

    Ok(SyllabusExpertRubricEvaluation {
        composite_score_bp,
        inter_rater_spread_bp,
        passed,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorAssessmentPsychometricInput {
    pub item_id: String,
    pub sample_size: u32,
    pub difficulty_p_bp: u32,
    pub discrimination_r_pb_bp: i32,
    pub open_defect_reports: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorAssessmentPsychometricEvaluation {
    pub item_id: String,
    pub calibration_healthy: bool,
    pub quarantine_recommended: bool,
    pub reason: String,
}

/// Evaluates Part 3 of the Pedagogical Evaluation Workstream: Assessment Item Review & Psychometrics (`@S42`, `@S50`).
pub fn evaluate_anchor_item_psychometrics(
    input: &AnchorAssessmentPsychometricInput,
) -> Result<AnchorAssessmentPsychometricEvaluation, DomainError> {
    if input.sample_size == 0 || input.difficulty_p_bp > 10_000 {
        return Err(DomainError::PedagogicalEvaluationViolation(format!(
            "invalid psychometric parameters for item `{}`",
            input.item_id
        )));
    }
    if input.open_defect_reports > 0 || input.discrimination_r_pb_bp < 0 {
        return Ok(AnchorAssessmentPsychometricEvaluation {
            item_id: input.item_id.clone(),
            calibration_healthy: false,
            quarantine_recommended: true,
            reason: "negative discrimination or open answer-key defect report".to_string(),
        });
    }
    let difficulty_ok = (1_500..=9_000).contains(&input.difficulty_p_bp);
    let discrimination_ok = input.discrimination_r_pb_bp >= 2_000;
    let calibration_healthy = difficulty_ok && discrimination_ok;
    Ok(AnchorAssessmentPsychometricEvaluation {
        item_id: input.item_id.clone(),
        calibration_healthy,
        quarantine_recommended: !calibration_healthy,
        reason: if calibration_healthy {
            "item within acceptable difficulty (0.15..=0.90) and point-biserial (>= 0.20) bounds"
                .to_string()
        } else {
            "item outside target difficulty or discrimination bounds; flag for curator review"
                .to_string()
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelayedRetentionTransferCohortMetrics {
    pub cohort_id: String,
    pub sample_size: u32,
    pub delayed_7d_retention_bp: u32,
    pub delayed_30d_retention_bp: u32,
    pub far_transfer_pass_rate_bp: u32,
    pub includes_control_comparison: bool,
    pub conflates_completion_or_upvotes_with_mastery: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelayedRetentionStudyEvaluation {
    pub cohort_id: String,
    pub retention_and_transfer_verified: bool,
    pub allowed_claim_scope: String,
}

/// Evaluates Part 4 of the Pedagogical Evaluation Workstream: Delayed Retention & Far-Transfer Study (`NFR-008`, `@S44`, `@S50`, `@S62`).
pub fn evaluate_delayed_retention_and_transfer_study(
    metrics: &DelayedRetentionTransferCohortMetrics,
) -> Result<DelayedRetentionStudyEvaluation, DomainError> {
    if metrics.conflates_completion_or_upvotes_with_mastery {
        return Err(DomainError::PedagogicalEvaluationViolation(
            "pedagogical study cannot conflate activity completion, self-report, or upvotes with demonstrated mastery (@S44, @S50, @S62)".to_string(),
        ));
    }
    if metrics.sample_size < 10 {
        return Err(DomainError::PedagogicalEvaluationViolation(
            "delayed retention and transfer study requires sample_size >= 10".to_string(),
        ));
    }
    let retention_and_transfer_verified = metrics.delayed_7d_retention_bp >= 7_000
        && metrics.delayed_30d_retention_bp >= 6_500
        && metrics.far_transfer_pass_rate_bp >= 6_000;

    let allowed_claim_scope = if retention_and_transfer_verified && metrics.includes_control_comparison {
        "controlled_delayed_retention_and_transfer_demonstrated".to_string()
    } else if retention_and_transfer_verified {
        "observational_delayed_retention_and_transfer_without_causal_superiority_claim".to_string()
    } else {
        "exploratory_pilot_below_retention_threshold".to_string()
    };

    Ok(DelayedRetentionStudyEvaluation {
        cohort_id: metrics.cohort_id.clone(),
        retention_and_transfer_verified,
        allowed_claim_scope,
    })
}

// =============================================================================
// T10: Native Clients & Precise OS Alarms Capability Boundary (`NOT-005`, `@S35`, `@S54`)
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientRuntimeKind {
    WebPwa,
    NativeIos,
    NativeAndroid,
    NativeDesktop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "capability_status", rename_all = "snake_case")]
pub enum AlarmCapabilityEvaluation {
    SupportedNativeExactAlarm {
        runtime: ClientRuntimeKind,
    },
    UnsupportedWebPwaExactAlarm {
        disclosure_code: String,
        fallback_channels: Vec<String>,
    },
    StandardReminderChannelsOnly {
        runtime: ClientRuntimeKind,
        channels: Vec<String>,
    },
}

/// Enforces the capability boundary between Web/PWA reminder channels and native OS exact alarms (`NOT-005`, `@S35`, `@S54`).
pub fn validate_native_alarm_capability_boundary(
    runtime: ClientRuntimeKind,
    requests_exact_os_alarm: bool,
) -> Result<AlarmCapabilityEvaluation, DomainError> {
    if !requests_exact_os_alarm {
        return Ok(AlarmCapabilityEvaluation::StandardReminderChannelsOnly {
            runtime,
            channels: vec![
                "in_app".to_string(),
                "web_push".to_string(),
                "email_digest".to_string(),
            ],
        });
    }
    match runtime {
        ClientRuntimeKind::WebPwa => Ok(AlarmCapabilityEvaluation::UnsupportedWebPwaExactAlarm {
            disclosure_code: "unsupported_on_web_pwa_without_native_companion".to_string(),
            fallback_channels: vec![
                "in_app".to_string(),
                "web_push".to_string(),
                "email_digest".to_string(),
            ],
        }),
        ClientRuntimeKind::NativeIos
        | ClientRuntimeKind::NativeAndroid
        | ClientRuntimeKind::NativeDesktop => {
            Ok(AlarmCapabilityEvaluation::SupportedNativeExactAlarm { runtime })
        }
    }
}
