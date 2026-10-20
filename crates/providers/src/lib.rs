//! Provider-neutral AI inference boundary, explicit `ProviderCapabilities` model,
//! pinned authorization routing (`BILL-001`, `BILL-007`), and `DeterministicFakeProvider` (`D12`, `T00`).
//!
//! Architectural invariant (`D12`): Live providers (`OpenAiHttpProvider` in `T07A`,
//! `AnthropicHttpProvider` and `GeminiHttpProvider` in `T07C`) are implemented over
//! direct official REST APIs via `reqwest`. Provider-specific SDK or HTTP response
//! types must never enter `curriculum-domain`.

use curriculum_contracts::jcs::sha256_bytes_hex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Structured-output enforcement mechanism supported by a provider/model route (`D12`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StructuredOutputCapability {
    /// Provider enforces a strict JSON Schema grammar natively at decoding time.
    NativeJsonSchema,
    /// Provider enforces schema via strict tool/function call arguments.
    ToolCallSchema,
    /// Provider outputs JSON only via prompt instructions; backend validation remains mandatory in all cases.
    PromptValidatedOnly,
}

/// Token limit envelope for a provider/model route (`D12`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenLimits {
    pub max_context_tokens: u32,
    pub max_output_tokens: u32,
}

/// Fidelity of token/cost usage reporting returned by a provider (`D12`, `BILL-008`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageReportingCapability {
    /// Synchronous response includes exact prompt and completion token counts.
    ExactTokenCounts,
    /// Provider reports only partial/estimated usage; app must label as estimated.
    EstimatedOnly,
    /// Final usage requires asynchronous reconciliation poll.
    AsyncReconciled,
}

/// Explicit capability descriptor for an inference provider adapter (`D12`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub provider_id: String,
    pub model_id: String,
    pub structured_output: StructuredOutputCapability,
    pub streaming: bool,
    pub output_limit: TokenLimits,
    pub usage_reporting: UsageReportingCapability,
    pub supports_cooperative_cancellation: bool,
}

/// Pinned authorization mode for an inference operation (`BILL-001`, `BILL-007`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceAuthMode {
    /// Deterministic local/test execution requiring no external credential or billing.
    DeterministicFake,
    /// Learner-supplied BYOK credential resolved just-in-time (`allow_hosted_fallback` is always `false`).
    Byok {
        credential_id: String,
        credential_version: u32,
    },
    /// Hosted paid inference backed by an atomic reservation ID (`T07B`).
    HostedCredits { reservation_id: String },
}

/// Provider-neutral generation request envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateGenerationRequest {
    pub request_id: String,
    pub account_id: String,
    pub goal_id: String,
    pub auth_mode: InferenceAuthMode,
    /// Must always be `false` for BYOK requests (`D12`, `BILL-001`, `@S28`).
    pub allow_hosted_fallback: bool,
    pub max_output_tokens: u32,
}

/// Provider-neutral token usage report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedUsageReport {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub reporting_fidelity: UsageReportingCapability,
    /// Always `0` when `auth_mode` is `Byok` or `DeterministicFake` (`@S28`).
    pub hosted_credits_charged_minor_units: i64,
}

/// Provider-neutral generation response containing raw UTF-8 candidate JSON bytes
/// and their cryptographic SHA-256 digest prior to authoritative contract validation.
#[derive(Debug, Clone)]
pub struct CandidateGenerationOutput {
    pub raw_candidate_json: String,
    pub candidate_sha256: String,
    pub parsed_candidate: Value,
    pub usage: NormalizedUsageReport,
}

/// Normalized provider failure categories (`BILL-005`).
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProviderError {
    #[error("implicit hosted fallback is forbidden for BYOK requests (`BILL-001`, `@S28`)")]
    ForbiddenHostedFallback,
    #[error("requested max_output_tokens ({requested}) exceeds model limit ({limit})")]
    OutputLimitExceeded { requested: u32, limit: u32 },
    #[error("provider authentication failed for selected mode `{mode}`: {message}")]
    AuthenticationFailure { mode: String, message: String },
    #[error("provider quota or rate limit exceeded for mode `{mode}`: {message}")]
    QuotaOrRateLimit { mode: String, message: String },
    #[error("provider returned structurally invalid candidate output: {message}")]
    InvalidCandidateOutput { message: String },
    #[error("ambiguous provider timeout; outcome requires reconciliation before retry")]
    AmbiguousTimeout,
}

/// Provider-neutral inference trait (`D12`).
pub trait InferenceProvider: Send + Sync {
    fn capabilities(&self) -> &ProviderCapabilities;

    fn generate_curriculum_candidate(
        &self,
        request: &CandidateGenerationRequest,
    ) -> Result<CandidateGenerationOutput, ProviderError>;
}

/// Deterministic fault injection modes for `DeterministicFakeProvider`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FakeFaultInjection {
    None,
    ByokAuthRejected,
    QuotaExceeded,
    InvalidExecutableCandidate,
    AmbiguousTimeout,
}

/// First phase inference adapter (`D12`, `T00`) returning the canonical synthetic
/// `curriculum-candidate.synthetic.json` fixture deterministically.
pub struct DeterministicFakeProvider {
    capabilities: ProviderCapabilities,
    fault_mode: FakeFaultInjection,
}

impl Default for DeterministicFakeProvider {
    fn default() -> Self {
        Self::new(FakeFaultInjection::None)
    }
}

impl DeterministicFakeProvider {
    pub fn new(fault_mode: FakeFaultInjection) -> Self {
        Self {
            capabilities: ProviderCapabilities {
                provider_id: "deterministic-fake".to_string(),
                model_id: "fake-curriculum-v1".to_string(),
                structured_output: StructuredOutputCapability::NativeJsonSchema,
                streaming: false,
                output_limit: TokenLimits {
                    max_context_tokens: 32_768,
                    max_output_tokens: 8_192,
                },
                usage_reporting: UsageReportingCapability::ExactTokenCounts,
                supports_cooperative_cancellation: true,
            },
            fault_mode,
        }
    }
}

impl InferenceProvider for DeterministicFakeProvider {
    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn generate_curriculum_candidate(
        &self,
        request: &CandidateGenerationRequest,
    ) -> Result<CandidateGenerationOutput, ProviderError> {
        if matches!(request.auth_mode, InferenceAuthMode::Byok { .. })
            && request.allow_hosted_fallback
        {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

        if request.max_output_tokens > self.capabilities.output_limit.max_output_tokens {
            return Err(ProviderError::OutputLimitExceeded {
                requested: request.max_output_tokens,
                limit: self.capabilities.output_limit.max_output_tokens,
            });
        }

        match self.fault_mode {
            FakeFaultInjection::ByokAuthRejected => {
                return Err(ProviderError::AuthenticationFailure {
                    mode: "byok".to_string(),
                    message: "Simulated BYOK API key rejection; no hosted fallback performed"
                        .to_string(),
                });
            }
            FakeFaultInjection::QuotaExceeded => {
                return Err(ProviderError::QuotaOrRateLimit {
                    mode: "byok".to_string(),
                    message: "Simulated provider rate limit".to_string(),
                });
            }
            FakeFaultInjection::AmbiguousTimeout => {
                return Err(ProviderError::AmbiguousTimeout);
            }
            FakeFaultInjection::InvalidExecutableCandidate => {
                let root = curriculum_contracts::workspace_root();
                let valid_path = root
                    .join("specs/001-curriculum-platform/examples/curriculum-candidate.synthetic.json");
                let raw = std::fs::read_to_string(&valid_path).expect("read candidate fixture");
                let registry = curriculum_contracts::ContractRegistry::load_from_root(&root)
                    .expect("load registry");
                let mut parsed: Value = serde_json::from_str(&raw).expect("parse JSON");
                parsed["html"] = serde_json::json!("<script>alert(1)</script>");
                if let Err(e) =
                    registry.validate_def("curriculum.schema.json", "modelCandidate", &parsed)
                {
                    return Err(ProviderError::InvalidCandidateOutput {
                        message: e.to_string(),
                    });
                }
            }
            FakeFaultInjection::None => {}
        }

        let root = curriculum_contracts::workspace_root();
        let candidate_path =
            root.join("specs/001-curriculum-platform/examples/curriculum-candidate.synthetic.json");
        let raw_bytes = std::fs::read(&candidate_path).expect("read canonical candidate fixture");
        let candidate_sha256 = sha256_bytes_hex(&raw_bytes);
        let raw_candidate_json =
            String::from_utf8(raw_bytes).expect("canonical candidate is valid UTF-8");
        let parsed_candidate: Value =
            serde_json::from_str(&raw_candidate_json).expect("valid candidate JSON");

        // Authoritative backend schema check before returning candidate output
        let registry =
            curriculum_contracts::ContractRegistry::load_from_root(&root).expect("load registry");
        registry
            .validate_def(
                "curriculum.schema.json",
                "modelCandidate",
                &parsed_candidate,
            )
            .map_err(|e| ProviderError::InvalidCandidateOutput {
                message: e.to_string(),
            })?;

        Ok(CandidateGenerationOutput {
            raw_candidate_json,
            candidate_sha256,
            parsed_candidate,
            usage: NormalizedUsageReport {
                input_tokens: 1_240,
                output_tokens: 980,
                reporting_fidelity: UsageReportingCapability::ExactTokenCounts,
                hosted_credits_charged_minor_units: 0,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_fake_provider_returns_valid_candidate_matching_archive_sha256() {
        let provider = DeterministicFakeProvider::default();
        assert_eq!(
            provider.capabilities().structured_output,
            StructuredOutputCapability::NativeJsonSchema
        );

        let req = CandidateGenerationRequest {
            request_id: "req-001".to_string(),
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            goal_id: "goal-rag-python".to_string(),
            auth_mode: InferenceAuthMode::DeterministicFake,
            allow_hosted_fallback: false,
            max_output_tokens: 4_096,
        };

        let out = provider
            .generate_curriculum_candidate(&req)
            .expect("valid generation");
        assert_eq!(out.usage.hosted_credits_charged_minor_units, 0);

        let canonical_path = curriculum_contracts::workspace_root()
            .join("specs/001-curriculum-platform/examples/curriculum.synthetic.json");
        let canonical: Value =
            serde_json::from_str(&std::fs::read_to_string(canonical_path).unwrap()).unwrap();
        assert_eq!(
            out.candidate_sha256,
            canonical["provenance"]["candidate_sha256"]
                .as_str()
                .unwrap()
        );
    }

    #[test]
    fn s28_byok_mode_forbids_hosted_fallback_and_never_charges_hosted_credits_on_failure() {
        let provider = DeterministicFakeProvider::new(FakeFaultInjection::ByokAuthRejected);

        // 1. Attempting to enable hosted fallback with BYOK is rejected immediately
        let bad_req = CandidateGenerationRequest {
            request_id: "req-byok-fallback".to_string(),
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            goal_id: "goal-rag-python".to_string(),
            auth_mode: InferenceAuthMode::Byok {
                credential_id: "cred-1".to_string(),
                credential_version: 1,
            },
            allow_hosted_fallback: true,
            max_output_tokens: 4_096,
        };
        assert_eq!(
            provider.generate_curriculum_candidate(&bad_req).unwrap_err(),
            ProviderError::ForbiddenHostedFallback
        );

        // 2. When BYOK auth fails, an actionable AuthenticationFailure is returned with zero hosted fallback
        let valid_byok_req = CandidateGenerationRequest {
            allow_hosted_fallback: false,
            ..bad_req
        };
        let err = provider
            .generate_curriculum_candidate(&valid_byok_req)
            .unwrap_err();
        assert!(matches!(err, ProviderError::AuthenticationFailure { .. }));
    }
}
