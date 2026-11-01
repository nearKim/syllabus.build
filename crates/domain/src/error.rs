//! Domain error types and invariant violations.

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
    #[error("billing ledger invariant violation: {0}")]
    BillingLedgerInvariantViolation(String),
    #[error("public sharing invariant violation: {0}")]
    PublicSharingInvariantViolation(String),
    #[error("account lifecycle invariant violation: {0}")]
    AccountLifecycleInvariantViolation(String),
    #[error("pedagogical evaluation invariant violation: {0}")]
    PedagogicalEvaluationViolation(String),
    #[error("native capability boundary violation: {0}")]
    NativeCapabilityBoundaryViolation(String),
}
