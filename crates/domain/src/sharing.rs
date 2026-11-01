//! Public templates, snapshot sanitization, preview digest, moderation state machine, and partial adoption closure.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::{validate_dag_acyclic, DomainError, ObjectiveProficiencyState};

// =============================================================================
// T13: Public Templates, Sanitization, Preview Digest, Moderation & Partial Adoption
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationVisibilityState {
    Private,
    Unlisted,
    Public,
    Withdrawn,
    Quarantined,
    Removed,
}

impl ModerationVisibilityState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Unlisted => "unlisted",
            Self::Public => "public",
            Self::Withdrawn => "withdrawn",
            Self::Quarantined => "quarantined",
            Self::Removed => "removed",
        }
    }

    pub fn from_wire(raw: &str) -> Result<Self, DomainError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "private" => Ok(Self::Private),
            "unlisted" => Ok(Self::Unlisted),
            "public" => Ok(Self::Public),
            "withdrawn" => Ok(Self::Withdrawn),
            "quarantined" => Ok(Self::Quarantined),
            "removed" => Ok(Self::Removed),
            other => Err(DomainError::PublicSharingInvariantViolation(format!(
                "unsupported moderation/publication visibility `{other}`"
            ))),
        }
    }

    #[must_use]
    pub fn is_listed_in_public_discovery(self) -> bool {
        matches!(self, Self::Public)
    }

    #[must_use]
    pub fn is_readable_via_direct_link(self) -> bool {
        matches!(self, Self::Public | Self::Unlisted)
    }
}

/// Pure domain sanitizer rules for public/unlisted syllabus snapshots (`SHARE-001`, `SHARE-002`, `SHARE-009`, `@S56`, `@S57`).
#[derive(Debug, Clone, Default)]
pub struct PublicSnapshotSanitizer;

impl PublicSnapshotSanitizer {
    pub const PRIVATE_LEARNER_FIELD_MARKERS: &'static [&'static str] = &[
        "account_id",
        "owner_account_id",
        "email",
        "private_notes",
        "learner_notes",
        "attempt_history",
        "attempts",
        "schedule_revisions",
        "reminder_preferences",
        "notification_preferences",
        "provider_credentials",
        "byok_credentials",
        "proficiency_records",
        "waivers",
        "diagnostic_sessions",
        "billing_wallet",
        "session_tokens",
    ];

    pub const RESTRICTED_RESOURCE_FIELD_MARKERS: &'static [&'static str] = &[
        "full_text_excerpt",
        "transcript_body",
        "embedded_body",
        "raw_content_excerpt",
    ];

    #[must_use]
    pub fn is_private_learner_field(field_name: &str) -> bool {
        Self::PRIVATE_LEARNER_FIELD_MARKERS.contains(&field_name)
    }

    #[must_use]
    pub fn is_restricted_third_party_field(field_name: &str) -> bool {
        Self::RESTRICTED_RESOURCE_FIELD_MARKERS.contains(&field_name)
    }

    /// Verifies that no private learner field keys remain and that any restricted third-party
    /// fields have been withheld as `null` rather than omitted (`@S57`, `@S63`).
    pub fn validate_sanitized_field_keys(
        present_field_keys: &[String],
        non_null_restricted_keys: &[String],
    ) -> Result<(), DomainError> {
        for key in present_field_keys {
            if Self::is_private_learner_field(key) {
                return Err(DomainError::PublicSharingInvariantViolation(format!(
                    "private learner field `{key}` must be stripped from public snapshot"
                )));
            }
        }
        if let Some(leaked) = non_null_restricted_keys.first() {
            return Err(DomainError::PublicSharingInvariantViolation(format!(
                "restricted third-party resource field `{leaked}` must be withheld as null"
            )));
        }
        Ok(())
    }
}

/// Preview digest and consent verifier for publication confirmation (`SHARE-001`, `SHARE-009`, `@S56`, `@S79`, `@S83`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationPreviewDigest {
    pub preview_sha256: String,
    pub content_sha256: String,
    pub visibility: String,
}

impl PublicationPreviewDigest {
    pub fn validate_publication_confirmation(
        &self,
        expected_preview_sha256: &str,
        current_computed_preview_sha256: &str,
        accept_publication_terms: bool,
    ) -> Result<(), DomainError> {
        if !accept_publication_terms {
            return Err(DomainError::PublicSharingInvariantViolation(
                "accept_publication_terms must be true to publish a syllabus template".to_string(),
            ));
        }
        if expected_preview_sha256.len() != 64
            || !expected_preview_sha256
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        {
            return Err(DomainError::PublicSharingInvariantViolation(
                "expected_preview_sha256 must be a 64-character hex SHA-256 digest".to_string(),
            ));
        }
        if expected_preview_sha256 != self.preview_sha256
            || expected_preview_sha256 != current_computed_preview_sha256
        {
            return Err(DomainError::PublicSharingInvariantViolation(format!(
                "stale or mismatched expected_preview_sha256: expected `{}`, preview was `{}`, current state computed `{}`",
                expected_preview_sha256, self.preview_sha256, current_computed_preview_sha256
            )));
        }
        Ok(())
    }
}

/// Provenance binding stored on an adopted private syllabus (`SHARE-004`, `@S59`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdoptionOriginBinding {
    pub source_publication_id: String,
    pub source_publication_revision_id: String,
    pub source_revision_number: u32,
    pub adopted_at_iso: String,
    pub selected_module_ids: Vec<String>,
    pub auto_included_prerequisite_module_ids: Vec<String>,
}

/// Result of computing the transitive prerequisite closure for full or partial template adoption
/// (`SHARE-004`, `ADAPT-005`, `@S59`, `@S72`, `@S73`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartialAdoptionClosure {
    pub ordered_module_ids: Vec<String>,
    pub auto_included_prerequisite_module_ids: Vec<String>,
    pub ordered_objective_ids: Vec<String>,
    pub initial_proficiency_states: BTreeMap<String, ObjectiveProficiencyState>,
}

/// Computes the transitive module and objective prerequisite closure for a selected subset
/// of modules (or all modules when `selected_module_ids` is empty), verifies DAG acyclicity,
/// and initializes every adopted objective to `ObjectiveProficiencyState::Unassessed` (`@S59`).
pub fn compute_partial_adoption_closure(
    module_edges: &[(String, Vec<String>)],
    module_objectives: &BTreeMap<String, Vec<String>>,
    objective_edges: &[(String, Vec<String>)],
    selected_module_ids: &[String],
) -> Result<PartialAdoptionClosure, DomainError> {
    let topological_modules = validate_dag_acyclic(module_edges)?;
    let topological_objectives = validate_dag_acyclic(objective_edges)?;

    let module_prereq_map: BTreeMap<&str, &[String]> = module_edges
        .iter()
        .map(|(node, prereqs)| (node.as_str(), prereqs.as_slice()))
        .collect();
    let objective_prereq_map: BTreeMap<&str, &[String]> = objective_edges
        .iter()
        .map(|(node, prereqs)| (node.as_str(), prereqs.as_slice()))
        .collect();

    let requested_set: BTreeSet<&str> = if selected_module_ids.is_empty() {
        module_prereq_map.keys().copied().collect()
    } else {
        let mut s = BTreeSet::new();
        for mid in selected_module_ids {
            let mid_str = mid.as_str();
            if !module_prereq_map.contains_key(mid_str) {
                return Err(DomainError::PublicSharingInvariantViolation(format!(
                    "unknown selected_module_id `{mid}` in partial adoption request"
                )));
            }
            s.insert(mid_str);
        }
        s
    };

    let mut closure_modules: BTreeSet<&str> = BTreeSet::new();
    let mut queue: VecDeque<&str> = requested_set.iter().copied().collect();
    while let Some(curr) = queue.pop_front() {
        if closure_modules.insert(curr) {
            if let Some(prereqs) = module_prereq_map.get(curr) {
                for prereq in *prereqs {
                    let prereq_str = prereq.as_str();
                    if !closure_modules.contains(prereq_str) {
                        queue.push_back(prereq_str);
                    }
                }
            }
        }
    }

    let auto_included_prerequisite_module_ids: Vec<String> = topological_modules
        .iter()
        .filter(|m| {
            let m_str = m.as_str();
            closure_modules.contains(m_str) && !requested_set.contains(m_str)
        })
        .cloned()
        .collect();

    let ordered_module_ids: Vec<String> = topological_modules
        .into_iter()
        .filter(|m| closure_modules.contains(m.as_str()))
        .collect();

    let mut closure_objectives: BTreeSet<&str> = BTreeSet::new();
    let mut obj_queue: VecDeque<&str> = VecDeque::new();
    for mid in &ordered_module_ids {
        if let Some(objs) = module_objectives.get(mid) {
            for oid in objs {
                obj_queue.push_back(oid.as_str());
            }
        }
    }
    while let Some(oid) = obj_queue.pop_front() {
        if closure_objectives.insert(oid) {
            if let Some(prereqs) = objective_prereq_map.get(oid) {
                for prereq in *prereqs {
                    let prereq_str = prereq.as_str();
                    if !closure_objectives.contains(prereq_str) {
                        obj_queue.push_back(prereq_str);
                    }
                }
            }
        }
    }

    let ordered_objective_ids: Vec<String> = topological_objectives
        .into_iter()
        .filter(|o| closure_objectives.contains(o.as_str()))
        .collect();

    let mut initial_proficiency_states = BTreeMap::new();
    for oid in &ordered_objective_ids {
        initial_proficiency_states.insert(oid.clone(), ObjectiveProficiencyState::Unassessed);
    }

    Ok(PartialAdoptionClosure {
        ordered_module_ids,
        auto_included_prerequisite_module_ids,
        ordered_objective_ids,
        initial_proficiency_states,
    })
}
