//! Operational readiness reporting and dynamic traceability gate evaluation (`T09`, `OPS-004`, `OPS-006`, `@S40`..`@S45`).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use syllabus_contracts::generated::CANONICAL_SPEC_SHA256;
use syllabus_persistence::PersistenceError;
use syllabus_security::ReleaseFeatureGates;

/// Operational readiness report capturing spec version and active feature gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemReadinessReport {
    pub status: String,
    pub release_tier: String,
    pub canonical_spec_sha256: String,
    pub release_gates: ReleaseFeatureGates,
}

/// Builds the system operational readiness report.
#[must_use]
pub fn build_readiness_report(gates: ReleaseFeatureGates) -> SystemReadinessReport {
    SystemReadinessReport {
        status: "ok".to_string(),
        release_tier: "private_alpha_t00".to_string(),
        canonical_spec_sha256: CANONICAL_SPEC_SHA256.to_string(),
        release_gates: gates,
    }
}

/// Single parsed requirement row from `specs/001-syllabus-platform/traceability.csv`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceabilityRequirementRow {
    pub requirement_id: String,
    pub priority: String,
    pub spec_section: String,
    pub schema_or_contract_artifact: String,
    pub test_level: String,
    pub acceptance_scenario_id: String,
    pub release_gate: String,
}

/// Runtime evidence input for the dynamic `P0` release readiness gate (`T09`, `@S40`..`@S45`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicReleaseGateInput {
    pub verified_requirement_ids: BTreeSet<String>,
    pub synthetic_fixtures_blocked_in_production: bool,
    pub open_critical_defects: u32,
    pub manual_accessibility_audit_passed: bool,
    pub pedagogical_evaluation_passed: bool,
    pub security_and_privacy_controls_verified: bool,
    pub backup_restore_and_tombstone_replay_verified: bool,
}

/// Evaluation result from the dynamic `P0` release readiness gate (`T09`, `@S40`..`@S45`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicReleaseReadinessEvaluation {
    pub release_ready: bool,
    pub total_requirements_parsed: usize,
    pub p0_requirements_discovered: usize,
    pub p0_requirements_verified: usize,
    pub missing_p0_requirement_ids: Vec<String>,
    pub incomplete_traceability_requirement_ids: Vec<String>,
    pub blocking_reasons: Vec<String>,
}

fn parse_csv_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                current.push('"');
                let _ = chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if c == ',' && !in_quotes {
            fields.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(c);
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// Parses `specs/001-syllabus-platform/traceability.csv` at runtime without hardcoding row counts (`@S40`..`@S45`).
pub fn parse_traceability_csv(
    csv_text: &str,
) -> Result<Vec<TraceabilityRequirementRow>, PersistenceError> {
    let mut rows = Vec::new();
    for (idx, raw_line) in csv_text.lines().enumerate() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let cols = parse_csv_fields(trimmed);
        if cols.first().map(String::as_str) == Some("requirement_id") {
            continue;
        }
        if cols.len() != 7 {
            return Err(PersistenceError::Validation(format!(
                "invalid traceability.csv row at line {}: expected 7 columns, found {}",
                idx + 1,
                cols.len()
            )));
        }
        rows.push(TraceabilityRequirementRow {
            requirement_id: cols[0].clone(),
            priority: cols[1].clone(),
            spec_section: cols[2].clone(),
            schema_or_contract_artifact: cols[3].clone(),
            test_level: cols[4].clone(),
            acceptance_scenario_id: cols[5].clone(),
            release_gate: cols[6].clone(),
        });
    }
    if rows.is_empty() {
        return Err(PersistenceError::Validation(
            "traceability.csv must contain at least one requirement row".to_string(),
        ));
    }
    Ok(rows)
}

/// Reads and parses `specs/001-syllabus-platform/traceability.csv` from the workspace root at runtime.
pub fn load_traceability_rows_from_workspace(
) -> Result<Vec<TraceabilityRequirementRow>, PersistenceError> {
    let path =
        syllabus_contracts::workspace_root().join("specs/001-syllabus-platform/traceability.csv");
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        PersistenceError::Validation(format!("failed to read traceability.csv: {e}"))
    })?;
    parse_traceability_csv(&raw)
}

/// Evaluates whether the release candidate satisfies every `priority == "P0"` requirement
/// discovered dynamically from `traceability.csv` and all operational readiness gates (`@S40`..`@S45`).
#[must_use]
pub fn evaluate_dynamic_release_readiness(
    rows: &[TraceabilityRequirementRow],
    input: &DynamicReleaseGateInput,
) -> DynamicReleaseReadinessEvaluation {
    let p0_rows: Vec<&TraceabilityRequirementRow> =
        rows.iter().filter(|r| r.priority == "P0").collect();
    let p0_requirements_discovered = p0_rows.len();

    let mut missing_p0_requirement_ids = Vec::new();
    let mut incomplete_traceability_requirement_ids = Vec::new();
    let mut p0_requirements_verified = 0usize;

    for row in &p0_rows {
        let trace_complete = !row.spec_section.is_empty()
            && !row.schema_or_contract_artifact.is_empty()
            && !row.test_level.is_empty()
            && !row.acceptance_scenario_id.is_empty()
            && !row.release_gate.is_empty();
        if !trace_complete {
            incomplete_traceability_requirement_ids.push(row.requirement_id.clone());
        }
        if input.verified_requirement_ids.contains(&row.requirement_id) && trace_complete {
            p0_requirements_verified += 1;
        } else {
            missing_p0_requirement_ids.push(row.requirement_id.clone());
        }
    }

    let mut blocking_reasons = Vec::new();
    if p0_requirements_discovered == 0 {
        blocking_reasons.push("no_p0_requirements_found_in_traceability_matrix".to_string());
    }
    if !missing_p0_requirement_ids.is_empty() {
        blocking_reasons.push(format!(
            "unverified_p0_requirements: {}",
            missing_p0_requirement_ids.join(", ")
        ));
    }
    if !incomplete_traceability_requirement_ids.is_empty() {
        blocking_reasons.push(format!(
            "incomplete_p0_traceability_rows: {}",
            incomplete_traceability_requirement_ids.join(", ")
        ));
    }
    if !input.synthetic_fixtures_blocked_in_production {
        blocking_reasons.push("synthetic_fixtures_not_blocked_in_production".to_string());
    }
    if input.open_critical_defects > 0 {
        blocking_reasons.push(format!(
            "open_critical_defects_remaining: {}",
            input.open_critical_defects
        ));
    }
    if !input.manual_accessibility_audit_passed {
        blocking_reasons.push("manual_wcag_2_2_aa_accessibility_audit_not_passed".to_string());
    }
    if !input.pedagogical_evaluation_passed {
        blocking_reasons.push("pedagogical_evaluation_workstream_not_passed".to_string());
    }
    if !input.security_and_privacy_controls_verified {
        blocking_reasons.push("security_and_privacy_controls_not_verified".to_string());
    }
    if !input.backup_restore_and_tombstone_replay_verified {
        blocking_reasons.push("backup_restore_and_tombstone_replay_not_verified".to_string());
    }

    DynamicReleaseReadinessEvaluation {
        release_ready: blocking_reasons.is_empty(),
        total_requirements_parsed: rows.len(),
        p0_requirements_discovered,
        p0_requirements_verified,
        missing_p0_requirement_ids,
        incomplete_traceability_requirement_ids,
        blocking_reasons,
    }
}
