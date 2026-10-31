//! Provider-neutral AI inference boundary, explicit `ProviderCapabilities` model,
//! pinned authorization routing (`BILL-001`, `BILL-007`), and `DeterministicFakeProvider` (`D12`, `T00`).
//!
//! Architectural invariant (`D12`): Live providers (`OpenAiHttpProvider` in `T07A`,
//! `AnthropicHttpProvider` and `GeminiHttpProvider` in `T07C`) are implemented over
//! direct official REST APIs via `reqwest`. Provider-specific SDK or HTTP response
//! types must never enter `syllabus-domain`.

use syllabus_contracts::jcs::sha256_bytes_hex;
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
    #[error("unsafe provider endpoint URL `{url}` rejected: {reason}")]
    UnsafeEndpointUrl { url: String, reason: String },
    #[error("BYOK credential binding mismatch or revoked: {message}")]
    CredentialBindingInvalid { message: String },
}

/// Provider-neutral inference trait (`D12`).
pub trait InferenceProvider: Send + Sync {
    fn capabilities(&self) -> &ProviderCapabilities;

    fn generate_syllabus_candidate(
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
/// `syllabus-candidate.synthetic.json` fixture deterministically.
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
    #[must_use]
    pub fn new(fault_mode: FakeFaultInjection) -> Self {
        Self {
            capabilities: ProviderCapabilities {
                provider_id: "deterministic-fake".to_string(),
                model_id: "fake-syllabus-v1".to_string(),
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

pub(crate) fn load_validated_canonical_candidate() -> Result<(String, String, Value), ProviderError> {
    let root = syllabus_contracts::workspace_root();
    let candidate_path =
        root.join("specs/001-syllabus-platform/examples/syllabus-candidate.synthetic.json");
    let raw_bytes =
        std::fs::read(&candidate_path).map_err(|e| ProviderError::InvalidCandidateOutput {
            message: format!("failed to read canonical candidate fixture: {e}"),
        })?;
    let candidate_sha256 = sha256_bytes_hex(&raw_bytes);
    let raw_candidate_json =
        String::from_utf8(raw_bytes).map_err(|e| ProviderError::InvalidCandidateOutput {
            message: format!("canonical candidate is not valid UTF-8: {e}"),
        })?;
    let parsed_candidate: Value =
        serde_json::from_str(&raw_candidate_json).map_err(|e| {
            ProviderError::InvalidCandidateOutput {
                message: format!("failed to parse canonical candidate JSON: {e}"),
            }
        })?;

    let registry = syllabus_contracts::ContractRegistry::global().map_err(|e| {
        ProviderError::InvalidCandidateOutput {
            message: e.to_string(),
        }
    })?;
    registry
        .validate_def(
            "syllabus.schema.json",
            "modelCandidate",
            &parsed_candidate,
        )
        .map_err(|e| ProviderError::InvalidCandidateOutput {
            message: e.to_string(),
        })?;

    Ok((raw_candidate_json, candidate_sha256, parsed_candidate))
}

impl InferenceProvider for DeterministicFakeProvider {
    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn generate_syllabus_candidate(
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
                let (_, _, mut parsed) = load_validated_canonical_candidate()?;
                parsed["html"] = serde_json::json!("<script>alert(1)</script>");
                let registry = syllabus_contracts::ContractRegistry::global().map_err(|e| {
                    ProviderError::InvalidCandidateOutput {
                        message: e.to_string(),
                    }
                })?;
                if let Err(e) =
                    registry.validate_def("syllabus.schema.json", "modelCandidate", &parsed)
                {
                    return Err(ProviderError::InvalidCandidateOutput {
                        message: e.to_string(),
                    });
                }
            }
            FakeFaultInjection::None => {}
        }

        let (raw_candidate_json, candidate_sha256, parsed_candidate) =
            load_validated_canonical_candidate()?;

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


pub mod http_providers;
pub use http_providers::*;

pub(crate) fn build_no_redirect_http_client(
    timeout: Option<std::time::Duration>,
) -> Result<reqwest::Client, ProviderError> {
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some(d) = timeout {
        builder = builder.timeout(d);
    }
    builder
        .build()
        .map_err(|e| ProviderError::InvalidCandidateOutput {
            message: format!("failed to build reqwest client: {e}"),
        })
}

pub(crate) async fn handle_live_http_response(
    resp: reqwest::Response,
    provider_display_name: &str,
    credential_id: &str,
) -> Result<Value, ProviderError> {
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err(ProviderError::AuthenticationFailure {
            mode: "byok".to_string(),
            message: format!(
                "{provider_display_name} rejected BYOK credential `{credential_id}` (HTTP {status}); no hosted fallback performed"
            ),
        });
    }
    if status == 429 {
        return Err(ProviderError::QuotaOrRateLimit {
            mode: "byok".to_string(),
            message: format!("{provider_display_name} rate limit or quota exceeded (HTTP 429)"),
        });
    }
    if !resp.status().is_success() {
        return Err(ProviderError::InvalidCandidateOutput {
            message: format!("{provider_display_name} returned non-success HTTP {status}"),
        });
    }

    resp.json::<Value>()
        .await
        .map_err(|e| ProviderError::InvalidCandidateOutput {
            message: format!("invalid JSON from {provider_display_name}: {e}"),
        })
}

#[cfg(test)]
mod tests;
