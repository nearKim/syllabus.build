//! Transactional PostgreSQL persistence boundary, SQL migration registry, tenant-isolated
//! repositories, separate private/public revision namespaces, HTTP concurrency engine
//! (`Idempotency-Key`, `If-Match`, append-only event deduplication), and post-restore
//! deletion tombstone replay (`T01`, `CTRL-002`, `CTRL-030`, `CTRL-070`, `NFR-001`, `NFR-006`, `NFR-007`).

pub use syllabus_domain::{
    advance_spaced_review_item, authorize_credit_reservation, compute_next_reminder_utc,
    compute_partial_adoption_closure, compute_reservation_settlement,
    derive_proficiency_transition, evaluate_account_deletion_impact,
    evaluate_ambiguous_timeout_reconciliation, evaluate_anchor_item_psychometrics,
    evaluate_assessment_attempt, evaluate_delayed_retention_and_transfer_study,
    evaluate_prerequisite_gate, evaluate_retrieval_benchmark, evaluate_syllabus_expert_rubric,
    format_epoch_utc_iso, partition_diagnostic_objectives, recalculate_attempts_for_key_correction,
    recalculate_schedule_plan, schedule_initial_spaced_review, validate_byok_credential_usable,
    validate_native_alarm_capability_boundary, validate_objective_waiver,
    validate_outbound_egress_url, validate_pedagogical_triad_coverage, AccountDeletionImpact,
    AcquisitionPermission, ActivityComponentBreakdown, ActivityExecutionStatus,
    AdoptionOriginBinding, AlarmCapabilityEvaluation, AmbiguousProviderOutcome,
    AnchorAssessmentPsychometricEvaluation, AnchorAssessmentPsychometricInput, AssessmentKind,
    AssessmentReviewStatus, AssistanceLevel, BillingModeKind, CatalogAccessModel,
    ClientRuntimeKind, CostBucketKind, CredentialStatus, CreditReservation,
    DelayedRetentionStudyEvaluation, DelayedRetentionTransferCohortMetrics, DiagnosticStopReason,
    DomainError, DstResolutionPolicy, EffortTriplet, EvaluatedAssessmentAttempt, EvidenceOrigin,
    FourCostBucketBreakdown, GoalSpecification, HistoricalAttemptForKeyCorrection,
    LearnerGateDecision, LedgerEntry, LedgerEntryKind, MasteryGateEvaluation, MathDepthPreference,
    ModerationVisibilityState, MoneyMinorUnits, ObjectiveProficiencyState, PartialAdoptionClosure,
    PrerequisiteGateInput, PublicSnapshotSanitizer, PublicationPreviewDigest,
    RecalculatedScheduleSummary, RecomputedAttemptOutcome, ReminderScheduleDecision,
    ReminderScheduleInput, ReservationStatus, ResourceFreshnessState, ResourceOperationKind,
    ResourceReviewStatus, RetrievalBenchmarkCase, RetrievalBenchmarkSummary, ReviewScheduleItem,
    ReviewScheduleStatus, ScheduleRecalculationInput, SpacedReviewRecord,
    SyllabusExpertRubricEvaluation, SyllabusExpertRubricScore, UsageQuote, WaiverEvidenceSource,
};

pub use serde_json;

pub mod migrations;
pub mod models;
pub mod pg_backend;
pub mod store;
mod store_auth;
mod store_billing;
mod store_catalog;
mod store_learning;
mod store_lifecycle;
mod store_manual_resources;
mod store_sharing;
mod store_syllabus;

pub use migrations::*;
pub use models::*;
pub use pg_backend::{
    apply_migrations_to_postgres, enqueue_pg_outbox_job, run_pg_outbox_worker_tick,
    PgOutboxTickReport,
};
pub use store::*;

#[cfg(test)]
mod tests;
