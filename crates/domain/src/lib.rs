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
    #[error("assessment invariant violation: {0}")]
    AssessmentInvariantViolation(String),
    #[error("spaced review invariant violation: {0}")]
    SpacedReviewInvariantViolation(String),
    #[error("waiver invariant violation for objective `{objective_id}`: {reason}")]
    WaiverInvariantViolation {
        objective_id: String,
        reason: String,
    },
    #[error("byok credential policy violation: {0}")]
    ByokPolicyViolation(String),
    #[error("reminder schedule error: {0}")]
    ReminderScheduleError(String),
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
    pub fn as_str(&self) -> &'static str {
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

    pub fn is_independent(&self) -> bool {
        matches!(self, AssistanceLevel::Independent)
    }

    /// Escalates assistance monotonically within an attempt (`SolutionStudied > HintUsed > Independent`).
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
    pub fn as_str(&self) -> &'static str {
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
    pub fn as_str(&self) -> &'static str {
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
        (AssessmentKind::AiPractice, _)
        | (_, AssessmentReviewStatus::UnreviewedPractice) => {
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
                    ObjectiveProficiencyState::Demonstrated => ObjectiveProficiencyState::Demonstrated,
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
            let kind = if any_missing_active_anchor && missing.iter().all(|p| !p.has_active_reviewed_anchor) {
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
    pub fn as_str(&self) -> &'static str {
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
    pub fn as_str(&self) -> &'static str {
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
    pub fn as_str(&self) -> &'static str {
        match self {
            DiagnosticStopReason::AllItemsAnswered => "all_items_answered",
            DiagnosticStopReason::LearnerStopped => "learner_stopped",
            DiagnosticStopReason::UncertaintyBoundReached => "uncertainty_bound_reached",
        }
    }
}

/// Evaluated objective evidence from a diagnostic session (`PED-007`, `@S70`, `@S81`).
/// Unreached objectives remain explicitly `ObjectiveProficiencyState::Unassessed`.
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

// =============================================================================
// T07A: BYOK Credential Custody & Usage Accounting Policy
// =============================================================================

/// Lifecycle status of a BYOK provider credential (`BILL-002`..`BILL-007`, `@S28`, `@S66`, `@S67`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Active,
    Revoked,
    Invalid,
}

impl CredentialStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            CredentialStatus::Active => "active",
            CredentialStatus::Revoked => "revoked",
            CredentialStatus::Invalid => "invalid",
        }
    }
}

/// Validates that a BYOK credential can be used for inference and never falls back to a hosted platform key (`@S28`, `@S66`, `@S67`).
pub fn validate_byok_credential_usable(
    status: CredentialStatus,
    allow_hosted_fallback: bool,
) -> Result<(), DomainError> {
    if allow_hosted_fallback {
        return Err(DomainError::ByokPolicyViolation(
            "silent fallback to hosted platform credentials is forbidden in BYOK mode (`BILL-006`, `@S66`)"
                .to_string(),
        ));
    }
    match status {
        CredentialStatus::Active => Ok(()),
        CredentialStatus::Revoked => Err(DomainError::ByokPolicyViolation(
            "BYOK credential has been revoked; re-authentication or a new key is required (`@S67`)"
                .to_string(),
        )),
        CredentialStatus::Invalid => Err(DomainError::ByokPolicyViolation(
            "BYOK credential is invalid or rejected by provider (`@S28`)".to_string(),
        )),
    }
}

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
    pub fn as_str(&self) -> &'static str {
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

    #[test]
    fn t05_s14_s15_s38_s40_s80_assessment_and_prerequisite_gate_invariants() {
        // @S14: AI practice never yields Demonstrated
        let ai_practice = evaluate_assessment_attempt(
            AssessmentKind::AiPractice,
            AssessmentReviewStatus::UnreviewedPractice,
            AssistanceLevel::Independent,
            10_000,
            8_000,
            ObjectiveProficiencyState::Unassessed,
        )
        .unwrap();
        assert_eq!(
            ai_practice.derived_proficiency_state,
            ObjectiveProficiencyState::InProgress
        );
        assert_eq!(ai_practice.contract_proficiency_label, "practiced");

        // @S80: Hint-assisted or solution-studied reviewed anchor pass yields AssistedProgress / InProgress, not Demonstrated
        let hint_eval = evaluate_assessment_attempt(
            AssessmentKind::ReviewedAnchor,
            AssessmentReviewStatus::Approved,
            AssistanceLevel::HintUsed,
            9_500,
            8_000,
            ObjectiveProficiencyState::Unassessed,
        )
        .unwrap();
        assert_eq!(
            hint_eval.derived_proficiency_state,
            ObjectiveProficiencyState::InProgress
        );
        assert_eq!(hint_eval.contract_proficiency_label, "assisted_progress");

        // @S15: Prerequisite gate blocks when prerequisite is only InProgress (e.g. assisted pass)
        let prereqs = vec![PrerequisiteGateInput {
            objective_id: "obj-prereq-1".to_string(),
            proficiency_state: hint_eval.derived_proficiency_state,
            has_active_reviewed_anchor: true,
        }];
        let gate_blocked = evaluate_prerequisite_gate(true, &prereqs, None);
        assert!(matches!(
            gate_blocked,
            MasteryGateEvaluation::BlockedMissingPrerequisite {
                remediation_required: true,
                ..
            }
        ));

        // Explicit learner override records `prerequisite_override_recorded`
        let gate_override = evaluate_prerequisite_gate(
            true,
            &prereqs,
            Some(LearnerGateDecision::PrerequisiteOverrideRecorded),
        );
        assert_eq!(
            gate_override,
            MasteryGateEvaluation::AllowedWithAudit {
                audit_event_kind: "prerequisite_override_recorded".to_string(),
                missing_objective_ids: vec!["obj-prereq-1".to_string()],
            }
        );

        // @S38: Missing/suspended reviewed anchor requires `unverified_prerequisite_acknowledged`
        let unverified_prereq = vec![PrerequisiteGateInput {
            objective_id: "obj-prereq-unverified".to_string(),
            proficiency_state: ObjectiveProficiencyState::SelfReported,
            has_active_reviewed_anchor: false,
        }];
        let ack_eval = evaluate_prerequisite_gate(
            true,
            &unverified_prereq,
            Some(LearnerGateDecision::UnverifiedPrerequisiteAcknowledged),
        );
        assert_eq!(
            ack_eval,
            MasteryGateEvaluation::AllowedWithAudit {
                audit_event_kind: "unverified_prerequisite_acknowledged".to_string(),
                missing_objective_ids: vec!["obj-prereq-unverified".to_string()],
            }
        );
    }

    #[test]
    fn t06_s17_s18_s19_spaced_review_distinct_session_and_interval_progression() {
        // @S19: Reject same-session spaced review
        let same_session_err = schedule_initial_spaced_review(
            "rev-1",
            "obj-linear-independence",
            "sess-1",
            "sess-1",
            1_775_000_000,
        );
        assert!(same_session_err.is_err());

        // @S17: Distinct future session succeeds with 1-day initial interval
        let rev = schedule_initial_spaced_review(
            "rev-1",
            "obj-linear-independence",
            "sess-1",
            "sess-2",
            1_775_000_000,
        )
        .unwrap();
        assert_eq!(rev.interval_days, 1);
        assert_eq!(rev.status, ReviewScheduleStatus::Scheduled);

        // Advance to Due when due_at reached
        let (due_item, _) =
            advance_spaced_review_item(&rev, rev.due_at_epoch_seconds, None, None, None).unwrap();
        assert_eq!(due_item.status, ReviewScheduleStatus::Due);

        // @S18: Completing review independently advances to 3-day follow-up in a new session
        let (completed, next_opt) = advance_spaced_review_item(
            &due_item,
            rev.due_at_epoch_seconds + 60,
            Some("sess-2"),
            Some(true),
            Some("sess-3"),
        )
        .unwrap();
        assert_eq!(completed.status, ReviewScheduleStatus::Completed);
        let next = next_opt.expect("follow-up scheduled");
        assert_eq!(next.interval_days, 3);
        assert_eq!(next.scheduled_session_id, "sess-3");
    }

    #[test]
    fn t12_s70_s71_s72_s81_diagnostic_partition_and_waiver_invariants() {
        let candidates = vec![
            "obj-linear-algebra".to_string(),
            "obj-matrix-calculus".to_string(),
            "obj-probability".to_string(),
        ];
        let mut results = BTreeMap::new();
        results.insert("obj-linear-algebra".to_string(), true);
        // @S70, @S81: Early stop or topic-scoped diagnostic leaves unreached objectives Unassessed
        let partitioned = partition_diagnostic_objectives(&candidates, &results);
        assert_eq!(
            partitioned.get("obj-linear-algebra"),
            Some(&ObjectiveProficiencyState::Demonstrated)
        );
        assert_eq!(
            partitioned.get("obj-matrix-calculus"),
            Some(&ObjectiveProficiencyState::Unassessed)
        );
        assert_eq!(
            partitioned.get("obj-probability"),
            Some(&ObjectiveProficiencyState::Unassessed)
        );

        // @S71, @S72: Self-report, completion, upvotes, and unreviewed AI grades cannot waive
        assert!(validate_objective_waiver(
            "obj-linear-algebra",
            &WaiverEvidenceSource::SelfReportedClaim
        )
        .is_err());
        assert!(validate_objective_waiver(
            "obj-linear-algebra",
            &WaiverEvidenceSource::UnreviewedAiGrade
        )
        .is_err());

        // Mismatched objective without equivalence mapping is rejected
        assert!(validate_objective_waiver(
            "obj-matrix-calculus",
            &WaiverEvidenceSource::DiagnosticDemonstrated {
                diagnostic_id: "diag-1".to_string(),
                assessed_objective_id: "obj-linear-algebra".to_string(),
                equivalence_mapping_id: None,
            }
        )
        .is_err());

        // Exact match with independent diagnostic demonstration succeeds
        assert!(validate_objective_waiver(
            "obj-linear-algebra",
            &WaiverEvidenceSource::DiagnosticDemonstrated {
                diagnostic_id: "diag-1".to_string(),
                assessed_objective_id: "obj-linear-algebra".to_string(),
                equivalence_mapping_id: None,
            }
        )
        .is_ok());
    }

    #[test]
    fn t08_s27_s33_s34_s60_dst_and_reminder_suppression_rules() {
        // Spring-forward gap: 2026-03-08 is 2nd Sunday of March 2026. 02:30 local in America/New_York shifts to 03:00 EDT (07:00Z).
        let spring_decision = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: "America/New_York".to_string(),
            local_date_yyyy_mm_dd: "2026-03-08".to_string(),
            local_time_hhmm: "02:30".to_string(),
            quiet_hours_start_hhmm: None,
            quiet_hours_end_hhmm: None,
            today_study_completed: false,
            now_utc_epoch_seconds: 1_772_900_000,
        })
        .unwrap();
        assert_eq!(
            spring_decision,
            ReminderScheduleDecision::Scheduled {
                scheduled_utc_epoch: 1_772_953_200,
                scheduled_utc_iso: "2026-03-08T07:00:00Z".to_string(),
                expires_utc_epoch: 1_772_996_400,
                expires_utc_iso: "2026-03-08T19:00:00Z".to_string(),
                dst_resolution_policy: DstResolutionPolicy::SpringForwardShifted,
                deferred_for_quiet_hours: false,
            }
        );

        // Fall-back fold: 2026-11-01 is 1st Sunday of November 2026. 01:30 local selects first occurrence (EDT -04:00 -> 05:30Z).
        let fall_decision = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: "America/New_York".to_string(),
            local_date_yyyy_mm_dd: "2026-11-01".to_string(),
            local_time_hhmm: "01:30".to_string(),
            quiet_hours_start_hhmm: None,
            quiet_hours_end_hhmm: None,
            today_study_completed: false,
            now_utc_epoch_seconds: 1_793_500_000,
        })
        .unwrap();
        assert_eq!(
            fall_decision,
            ReminderScheduleDecision::Scheduled {
                scheduled_utc_epoch: 1_793_511_000,
                scheduled_utc_iso: "2026-11-01T05:30:00Z".to_string(),
                expires_utc_epoch: 1_793_554_200,
                expires_utc_iso: "2026-11-01T17:30:00Z".to_string(),
                dst_resolution_policy: DstResolutionPolicy::FallBackFirstOccurrence,
                deferred_for_quiet_hours: false,
            }
        );

        // @S27, @S33: Suppressed when today's scheduled study is already completed
        let completed_suppressed = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: "UTC".to_string(),
            local_date_yyyy_mm_dd: "2026-04-02".to_string(),
            local_time_hhmm: "19:00".to_string(),
            quiet_hours_start_hhmm: None,
            quiet_hours_end_hhmm: None,
            today_study_completed: true,
            now_utc_epoch_seconds: 1_775_100_000,
        })
        .unwrap();
        assert_eq!(
            completed_suppressed,
            ReminderScheduleDecision::SuppressedStudyCompletedToday
        );

        // @S34, @S60: Expired reminders are suppressed rather than replayed on reconnect
        let expired_suppressed = compute_next_reminder_utc(&ReminderScheduleInput {
            enabled: true,
            iana_timezone: "UTC".to_string(),
            local_date_yyyy_mm_dd: "2026-04-01".to_string(),
            local_time_hhmm: "08:00".to_string(),
            quiet_hours_start_hhmm: None,
            quiet_hours_end_hhmm: None,
            today_study_completed: false,
            now_utc_epoch_seconds: 1_775_200_000,
        })
        .unwrap();
        assert_eq!(
            expired_suppressed,
            ReminderScheduleDecision::SuppressedExpiredBacklog
        );
    }
}
