//! Pure domain invariants, DAG validation, workload duration math, and three-layer
//! state separation (`ActivityExecutionState`, `Proficiency`, `ReviewScheduleItem`).
//!
//! Architectural invariant (`D12`): No HTTP, database, or AI provider SDK types
//! are permitted in `curriculum-domain`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("invalid playback speed: {0} (must be finite and in 0.5..=3.0)")]
    InvalidPlaybackSpeed(String),
    #[error("component bounds unordered for `{component}`: min={min_minutes}, point={point_minutes}, max={max_minutes}")]
    UnorderedComponentBounds {
        component: String,
        min_minutes: u32,
        point_minutes: u32,
        max_minutes: u32,
    },
    #[error("unknown graph dependency `{dependency}` referenced by `{node}`")]
    UnknownDependency { node: String, dependency: String },
    #[error("cycle detected in directed acyclic graph involving nodes: {cycle_nodes:?}")]
    GraphCycleDetected { cycle_nodes: Vec<String> },
    #[error("duplicate identifier `{0}`")]
    DuplicateIdentifier(String),
    #[error("proficiency invariant violation: {0}")]
    ProficiencyInvariantViolation(String),
    #[error("unsafe outbound egress URL `{url}` rejected: {reason}")]
    UnsafeEgressUrl { url: String, reason: String },
    #[error("objective `{objective_id}` is missing required pedagogical triad coverage: {missing_kinds:?}")]
    MissingPedagogicalTriadCoverage {
        objective_id: String,
        missing_kinds: Vec<String>,
    },
}

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
pub fn validate_dag_acyclic(
    edges: &[(String, Vec<String>)],
) -> Result<Vec<String>, DomainError> {
    let mut node_set = BTreeSet::new();
    for (node, _) in edges {
        if !node_set.insert(node.clone()) {
            return Err(DomainError::DuplicateIdentifier(node.clone()));
        }
    }

    let mut in_degree: BTreeMap<String, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (node, prereqs) in edges {
        in_degree.entry(node.clone()).or_insert(0);
        for prereq in prereqs {
            if !node_set.contains(prereq) {
                return Err(DomainError::UnknownDependency {
                    node: node.clone(),
                    dependency: prereq.clone(),
                });
            }
            *in_degree.entry(node.clone()).or_insert(0) += 1;
            dependents
                .entry(prereq.clone())
                .or_default()
                .push(node.clone());
        }
    }

    let mut queue: VecDeque<String> = in_degree
        .iter()
        .filter_map(|(k, &deg)| if deg == 0 { Some(k.clone()) } else { None })
        .collect();

    let mut topo_order = Vec::with_capacity(edges.len());
    while let Some(curr) = queue.pop_front() {
        topo_order.push(curr.clone());
        if let Some(children) = dependents.get(&curr) {
            for child in children {
                if let Some(deg) = in_degree.get_mut(child) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(child.clone());
                    }
                }
            }
        }
    }

    if topo_order.len() != edges.len() {
        let cycle_nodes: Vec<String> = in_degree
            .into_iter()
            .filter_map(|(n, deg)| if deg > 0 { Some(n) } else { None })
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

/// Catalog access pricing model (`CAT-005`, `@S05`, `@S06`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogAccessModel {
    FreePublic,
    PaidPurchase,
    Subscription,
    FreemiumTrial,
    UnknownPrice,
}

/// Curator review lifecycle state for a catalog resource version (`CAT-002`, `@S04`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceReviewStatus {
    Approved,
    UnderReview,
    Quarantined,
    Rejected,
    Withdrawn,
    Deprecated,
}

/// Freshness state for a catalog resource version (`CAT-004`, `@S07`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceFreshnessState {
    Healthy,
    Degraded,
    Broken,
    Unchecked,
}

/// Operation attempted against a catalog resource (`CAT-003`, `@S05`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceOperationKind {
    Metadata,
    LinkOut,
    ShortExcerpt,
    FullTextStorage,
    Embedding,
    Redistribution,
}

impl ResourceOperationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResourceOperationKind::Metadata => "metadata",
            ResourceOperationKind::LinkOut => "link_out",
            ResourceOperationKind::ShortExcerpt => "short_excerpt",
            ResourceOperationKind::FullTextStorage => "full_text_storage",
            ResourceOperationKind::Embedding => "embedding",
            ResourceOperationKind::Redistribution => "redistribution",
        }
    }
}

/// Granular acquisition and rights permission matrix (`CAT-003`, `@S05`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcquisitionPermission {
    pub allow_metadata: bool,
    pub allow_link_out: bool,
    pub allow_short_excerpt: bool,
    pub allow_full_text_storage: bool,
    pub allow_embedding: bool,
    pub allow_redistribution: bool,
    pub license_spdx_or_custom: String,
    pub requires_attribution: bool,
    pub attribution_text: Option<String>,
    pub notes: Option<String>,
}

impl AcquisitionPermission {
    /// Pure domain policy evaluating whether `operation` is permitted by this rights record (`CAT-003`, `@S05`).
    pub fn permits(&self, operation: ResourceOperationKind) -> bool {
        match operation {
            ResourceOperationKind::Metadata => self.allow_metadata,
            ResourceOperationKind::LinkOut => self.allow_link_out,
            ResourceOperationKind::ShortExcerpt => self.allow_short_excerpt,
            ResourceOperationKind::FullTextStorage => self.allow_full_text_storage,
            ResourceOperationKind::Embedding => self.allow_embedding,
            ResourceOperationKind::Redistribution => self.allow_redistribution,
        }
    }
}

/// Normalized learner goal specification value object (`GOAL-001`..`GOAL-005`, `T03`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalSpecification {
    pub topic: String,
    pub target_role_or_outcome: String,
    pub prior_background_level: String,
    pub weekly_available_minutes: u32,
    pub horizon_weeks: u32,
    pub free_only: bool,
    pub budget_currency: String,
    pub max_budget_minor_units: u64,
    pub owned_subscription_ids: Vec<String>,
    pub allow_paid_fallback: bool,
    pub include_optional_certification: bool,
    pub clarifying_questions: Vec<String>,
    pub proposed_objectives: Vec<String>,
    pub feasibility_warning: Option<String>,
}

/// Single authoritative outbound URL egress validator enforcing HTTPS scheme,
/// rejection of userinfo credentials, loopback/private/link-local/metadata IP ranges,
/// and DNS host allowlist membership (`CAT-003`, `@S08`, `@S31`, `@S35`).
pub fn validate_outbound_egress_url(
    url: &str,
    allowed_hosts: &[&str],
) -> Result<String, DomainError> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "only https:// URLs are permitted for outbound catalog egress".to_string(),
        });
    }
    let after_scheme = &trimmed["https://".len()..];
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "missing URL host authority".to_string(),
        });
    }
    if authority.contains('@') {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "URL userinfo credentials are forbidden".to_string(),
        });
    }

    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .unwrap_or(authority)
            .trim_start_matches('[')
            .to_ascii_lowercase()
    } else {
        authority
            .split(':')
            .next()
            .unwrap_or(authority)
            .to_ascii_lowercase()
    };

    if host.is_empty() {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: "empty host in URL".to_string(),
        });
    }

    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host == "::1"
        || host == "0:0:0:0:0:0:0:1"
        || host.starts_with("fc")
        || host.starts_with("fd")
        || host.starts_with("fe80:")
        || host.contains(':')
    {
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("loopback, internal, or IPv6 literal host `{host}` is forbidden"),
        });
    }

    let ipv4_parts: Vec<&str> = host.split('.').collect();
    if ipv4_parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    {
        if ipv4_parts.len() == 4 {
            let octets: Result<Vec<u8>, _> = ipv4_parts.iter().map(|p| p.parse::<u8>()).collect();
            if let Ok(o) = octets {
                let (a, b) = (o[0], o[1]);
                let is_private_or_reserved = a == 0
                    || a == 10
                    || a == 127
                    || (a == 169 && b == 254)
                    || (a == 172 && (16..=31).contains(&b))
                    || (a == 192 && b == 168)
                    || (a == 100 && (64..=127).contains(&b))
                    || a >= 224;
                if is_private_or_reserved {
                    return Err(DomainError::UnsafeEgressUrl {
                        url: url.to_string(),
                        reason: format!(
                            "private, loopback, link-local, or metadata IPv4 `{host}` is forbidden"
                        ),
                    });
                }
            }
        }
        return Err(DomainError::UnsafeEgressUrl {
            url: url.to_string(),
            reason: format!("raw IP literal `{host}` is forbidden; use an allowlisted DNS host"),
        });
    }

    if !allowed_hosts.is_empty() {
        let host_allowed = allowed_hosts.iter().any(|allowed| {
            let allowed_lower = allowed.to_ascii_lowercase();
            if let Some(suffix) = allowed_lower.strip_prefix("*.") {
                host == suffix || host.ends_with(&format!(".{suffix}"))
            } else {
                host == allowed_lower
            }
        });
        if !host_allowed {
            return Err(DomainError::UnsafeEgressUrl {
                url: url.to_string(),
                reason: format!("host `{host}` is not in the outbound egress allowlist"),
            });
        }
    }

    Ok(host)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s20_playback_speed_scales_only_media_with_ceiling_rounding() {
        // @S20: 60m media + 50m reading + 45m practice + 30m assessment + 15m review = 200m at 1.0x
        // At 2.0x playback speed, media becomes 30m -> 170m total.
        let breakdown = ActivityComponentBreakdown {
            media: EffortTriplet {
                min_minutes: 50,
                point_minutes: 60,
                max_minutes: 70,
            },
            reading: EffortTriplet {
                min_minutes: 40,
                point_minutes: 50,
                max_minutes: 60,
            },
            practice: EffortTriplet {
                min_minutes: 35,
                point_minutes: 45,
                max_minutes: 60,
            },
            assessment: EffortTriplet {
                min_minutes: 20,
                point_minutes: 30,
                max_minutes: 40,
            },
            review: EffortTriplet {
                min_minutes: 10,
                point_minutes: 15,
                max_minutes: 20,
            },
        };

        let at_1x = breakdown.adjusted_effort(1.0).expect("valid 1.0x");
        assert_eq!(at_1x.point_minutes, 200);

        let at_2x = breakdown.adjusted_effort(2.0).expect("valid 2.0x");
        assert_eq!(at_2x.point_minutes, 170);
        assert_eq!(at_2x.min_minutes, 130);
        assert_eq!(at_2x.max_minutes, 215);
    }

    #[test]
    fn dag_validator_accepts_acyclic_and_rejects_cycles() {
        let acyclic = vec![
            ("obj-1".to_string(), vec![]),
            ("obj-2".to_string(), vec!["obj-1".to_string()]),
            ("obj-3".to_string(), vec!["obj-2".to_string()]),
        ];
        let order = validate_dag_acyclic(&acyclic).expect("acyclic graph should pass");
        assert_eq!(order, vec!["obj-1", "obj-2", "obj-3"]);

        let cyclic = vec![
            ("obj-1".to_string(), vec!["obj-3".to_string()]),
            ("obj-2".to_string(), vec!["obj-1".to_string()]),
            ("obj-3".to_string(), vec!["obj-2".to_string()]),
        ];
        let err = validate_dag_acyclic(&cyclic).expect_err("cycle must fail");
        assert!(matches!(err, DomainError::GraphCycleDetected { .. }));
    }

    #[test]
    fn self_reported_and_formative_completion_never_create_demonstrated_proficiency() {
        let s1 = derive_proficiency_transition(
            ObjectiveProficiencyState::Unassessed,
            EvidenceOrigin::SelfReportedActivityCompletion,
        )
        .unwrap();
        assert_eq!(s1, ObjectiveProficiencyState::SelfReported);

        let s2 = derive_proficiency_transition(s1, EvidenceOrigin::FormativePracticeCompletion)
            .unwrap();
        assert_eq!(s2, ObjectiveProficiencyState::InProgress);

        let assisted = derive_proficiency_transition(
            s2,
            EvidenceOrigin::ReviewedAnchorAssessmentPass {
                independent_performance: false,
            },
        )
        .unwrap();
        assert_eq!(assisted, ObjectiveProficiencyState::InProgress);

        let demonstrated = derive_proficiency_transition(
            assisted,
            EvidenceOrigin::ReviewedAnchorAssessmentPass {
                independent_performance: true,
            },
        )
        .unwrap();
        assert_eq!(demonstrated, ObjectiveProficiencyState::Demonstrated);
    }
}
