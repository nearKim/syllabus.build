//! BYOK credential policy, hosted credit wallet, quotes, reservations, double-entry ledger, and timeout reconciliation.

use serde::{Deserialize, Serialize};

use crate::DomainError;

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
    #[must_use]
    pub fn as_str(self) -> &'static str {
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

// T07B & T07D: Hosted Inference Credit Ledger, Quotes, Reservations & Reconciliation
// =============================================================================

/// Monetary amount in minor currency units (e.g., USD cents or micro-cents) (`BILL-001`, `BILL-003`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyMinorUnits {
    pub currency: String,
    pub amount_minor_units: i64,
}

impl MoneyMinorUnits {
    #[must_use]
    pub fn usd(amount_minor_units: i64) -> Self {
        Self {
            currency: "USD".to_string(),
            amount_minor_units,
        }
    }

    pub fn validate_non_negative(&self) -> Result<(), DomainError> {
        if self.currency != "USD" {
            return Err(DomainError::BillingLedgerInvariantViolation(format!(
                "unsupported currency `{}` (expected USD)",
                self.currency
            )));
        }
        if self.amount_minor_units < 0 {
            return Err(DomainError::BillingLedgerInvariantViolation(format!(
                "monetary amount must be non-negative, got {}",
                self.amount_minor_units
            )));
        }
        Ok(())
    }
}

/// Four distinct, non-conflatable cost buckets (`BILL-004`, `@S06`, `@S28`, `@S52`, `@S59`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostBucketKind {
    ServiceAccess,
    HostedAiInference,
    ExternalByokEstimate,
    LearningMaterialsAndExams,
}

impl CostBucketKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ServiceAccess => "service_access",
            Self::HostedAiInference => "hosted_ai_inference",
            Self::ExternalByokEstimate => "external_byok_estimate",
            Self::LearningMaterialsAndExams => "learning_materials_and_exams",
        }
    }
}

/// Explicit four-bucket cost presentation ensuring service access, hosted AI inference,
/// external BYOK estimates, and learning materials/exams are never conflated (`BILL-004`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FourCostBucketBreakdown {
    pub currency: String,
    pub service_access_minor_units: i64,
    pub hosted_ai_inference_minor_units: i64,
    pub external_byok_estimate_minor_units: i64,
    pub learning_materials_and_exams_minor_units: i64,
}

impl FourCostBucketBreakdown {
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.currency != "USD" {
            return Err(DomainError::BillingLedgerInvariantViolation(format!(
                "unsupported currency `{}` in four-bucket breakdown",
                self.currency
            )));
        }
        if self.service_access_minor_units < 0
            || self.hosted_ai_inference_minor_units < 0
            || self.external_byok_estimate_minor_units < 0
            || self.learning_materials_and_exams_minor_units < 0
        {
            return Err(DomainError::BillingLedgerInvariantViolation(
                "cost bucket amounts must be non-negative".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingModeKind {
    HostedCredits,
    Byok,
}

impl BillingModeKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HostedCredits => "hosted_credits",
            Self::Byok => "byok",
        }
    }
}

/// Pre-execution usage quote bounding the maximum reservable & settlable hosted charge (`BILL-003`, `@S30`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageQuote {
    pub quote_id: String,
    pub account_id: String,
    pub operation_kind: String,
    pub billing_mode: BillingModeKind,
    pub provider_id: String,
    pub model_id: String,
    pub currency: String,
    pub estimated_minor_units: i64,
    pub max_reservable_minor_units: i64,
    pub external_byok_estimated_minor_units: i64,
    pub learning_materials_estimated_minor_units: i64,
    pub pricing_snapshot_version: String,
    pub expires_at_epoch_seconds: i64,
}

impl UsageQuote {
    pub fn validate(&self, now_epoch_seconds: i64) -> Result<(), DomainError> {
        if self.estimated_minor_units < 0 || self.max_reservable_minor_units < 0 {
            return Err(DomainError::BillingLedgerInvariantViolation(
                "quote minor units cannot be negative".to_string(),
            ));
        }
        if self.max_reservable_minor_units < self.estimated_minor_units {
            return Err(DomainError::BillingLedgerInvariantViolation(format!(
                "quote max_reservable_minor_units ({}) cannot be less than estimated_minor_units ({})",
                self.max_reservable_minor_units, self.estimated_minor_units
            )));
        }
        if self.billing_mode == BillingModeKind::Byok && self.max_reservable_minor_units != 0 {
            return Err(DomainError::BillingLedgerInvariantViolation(
                "BYOK quote must have zero hosted reservable minor units".to_string(),
            ));
        }
        if now_epoch_seconds > self.expires_at_epoch_seconds {
            return Err(DomainError::BillingLedgerInvariantViolation(format!(
                "usage quote `{}` expired at {}",
                self.quote_id, self.expires_at_epoch_seconds
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReservationStatus {
    Reserved,
    Settled,
    Released,
    Expired,
}

impl ReservationStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Settled => "settled",
            Self::Released => "released",
            Self::Expired => "expired",
        }
    }
}

/// Pre-execution credit reservation against a wallet (`BILL-005`, `BILL-008`, `@S28`, `@S68`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreditReservation {
    pub reservation_id: String,
    pub account_id: String,
    pub quote_id: String,
    pub idempotency_key: String,
    pub operation_kind: String,
    pub provider_id: String,
    pub model_id: String,
    pub currency: String,
    pub reserved_minor_units: i64,
    pub settled_minor_units: i64,
    pub released_minor_units: i64,
    pub status: ReservationStatus,
    pub expires_at_epoch_seconds: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerEntryKind {
    TopUpCredit,
    ReservationHold,
    ReservationSettlement,
    ReservationRelease,
    RefundDebit,
    ChargebackDebit,
    ReconciliationRelease,
}

impl LedgerEntryKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TopUpCredit => "top_up_credit",
            Self::ReservationHold => "reservation_hold",
            Self::ReservationSettlement => "reservation_settlement",
            Self::ReservationRelease => "reservation_release",
            Self::RefundDebit => "refund_debit",
            Self::ChargebackDebit => "chargeback_debit",
            Self::ReconciliationRelease => "reconciliation_release",
        }
    }
}

/// Immutable double-entry ledger line item (`BILL-001`, `BILL-005`, `NFR-006`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub ledger_entry_id: String,
    pub account_id: String,
    pub entry_kind: LedgerEntryKind,
    pub cost_bucket: CostBucketKind,
    pub currency: String,
    pub delta_available_minor_units: i64,
    pub delta_reserved_minor_units: i64,
    pub balance_after_available_minor_units: i64,
    pub balance_after_reserved_minor_units: i64,
    pub quote_id: Option<String>,
    pub reservation_id: Option<String>,
    pub checkout_session_id: Option<String>,
    pub webhook_event_id: Option<String>,
    pub description: String,
    pub created_at_iso: String,
}

/// Validates and computes `(new_available, new_reserved)` when placing a pre-execution hold.
pub fn authorize_credit_reservation(
    available_minor_units: i64,
    reserved_minor_units: i64,
    quote: &UsageQuote,
    requested_reserve_minor_units: i64,
    now_epoch_seconds: i64,
) -> Result<(i64, i64), DomainError> {
    quote.validate(now_epoch_seconds)?;
    if quote.billing_mode != BillingModeKind::HostedCredits {
        return Err(DomainError::BillingLedgerInvariantViolation(
            "credit reservations are only permitted for hosted_credits quotes".to_string(),
        ));
    }
    if requested_reserve_minor_units <= 0 {
        return Err(DomainError::BillingLedgerInvariantViolation(
            "requested reservation minor units must be positive".to_string(),
        ));
    }
    if requested_reserve_minor_units > quote.max_reservable_minor_units {
        return Err(DomainError::BillingLedgerInvariantViolation(format!(
            "requested reservation ({}) exceeds quote max_reservable_minor_units ({})",
            requested_reserve_minor_units, quote.max_reservable_minor_units
        )));
    }
    if available_minor_units < requested_reserve_minor_units {
        return Err(DomainError::BillingLedgerInvariantViolation(format!(
            "insufficient available hosted credits: available={}, required={}",
            available_minor_units, requested_reserve_minor_units
        )));
    }
    Ok((
        available_minor_units - requested_reserve_minor_units,
        reserved_minor_units + requested_reserve_minor_units,
    ))
}

/// Computes `(settled_minor_units, released_minor_units)` capped strictly at `reserved_minor_units`
/// so settled charges never exceed the pre-authorized quote/reservation (`BILL-003`, `BILL-005`, `@S30`).
pub fn compute_reservation_settlement(
    reserved_minor_units: i64,
    actual_usage_minor_units: i64,
) -> Result<(i64, i64), DomainError> {
    if reserved_minor_units < 0 || actual_usage_minor_units < 0 {
        return Err(DomainError::BillingLedgerInvariantViolation(
            "reserved and actual usage minor units must be non-negative".to_string(),
        ));
    }
    let settled = actual_usage_minor_units.min(reserved_minor_units);
    let released = reserved_minor_units - settled;
    Ok((settled, released))
}

/// Outcome observed when reconciling an in-flight or timed-out provider call (`BILL-008`, `NFR-006`, `@S43`, `@S68`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmbiguousProviderOutcome {
    ProviderConfirmedNoOutput,
    UnconfirmedTimeoutWithoutCommittedOutput,
    ProviderConfirmedCompleted { actual_usage_minor_units: i64 },
}

/// Evaluates whether an ambiguous/timed-out reservation should be released or settled.
/// Invariant (`BILL-008`, `@S43`, `@S68`): Never settle a charge unless the committed syllabus/revision
/// artifact was durably persisted AND the provider confirmed completion.
pub fn evaluate_ambiguous_timeout_reconciliation(
    reserved_minor_units: i64,
    committed_artifact_persisted: bool,
    outcome: AmbiguousProviderOutcome,
) -> Result<(ReservationStatus, i64, i64), DomainError> {
    if reserved_minor_units < 0 {
        return Err(DomainError::BillingLedgerInvariantViolation(
            "reserved_minor_units cannot be negative".to_string(),
        ));
    }
    match (committed_artifact_persisted, outcome) {
        (
            true,
            AmbiguousProviderOutcome::ProviderConfirmedCompleted {
                actual_usage_minor_units,
            },
        ) => {
            let (settled, released) =
                compute_reservation_settlement(reserved_minor_units, actual_usage_minor_units)?;
            Ok((ReservationStatus::Settled, settled, released))
        }
        _ => Ok((ReservationStatus::Released, 0, reserved_minor_units)),
    }
}
