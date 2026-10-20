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
    #[error("unsafe provider endpoint URL `{url}` rejected: {reason}")]
    UnsafeEndpointUrl { url: String, reason: String },
    #[error("BYOK credential binding mismatch or revoked: {message}")]
    CredentialBindingInvalid { message: String },
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

// =============================================================================
// T07A: Official OpenAI REST Provider (`OpenAiHttpProvider`) over `reqwest`
// =============================================================================

/// Canonical OpenAI Chat Completions endpoint (`D06`, `D12`, `T07A`).
pub const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

/// Allowed outbound DNS hosts for `OpenAiHttpProvider` (`@S31`).
pub const OPENAI_ALLOWED_EGRESS_HOSTS: [&str; 1] = ["api.openai.com"];

/// Pinned BYOK credential binding passed to `OpenAiHttpProvider` (`BILL-001`, `BILL-007`, `@S28`, `@S66`, `@S67`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinnedByokBinding {
    pub account_id: String,
    pub credential_id: String,
    pub credential_version: u32,
    pub status: curriculum_domain::CredentialStatus,
    pub allow_hosted_fallback: bool,
}

/// Transport execution mode for `OpenAiHttpProvider` (`D12`, `T07A`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiTransportMode {
    /// Deterministic local/test response simulating a 200 OK from `api.openai.com` with exact usage counts.
    Simulated200Ok {
        prompt_tokens: u32,
        completion_tokens: u32,
    },
    /// Simulated HTTP 401/403 authentication failure from `api.openai.com`.
    Simulated401Unauthorized,
    /// Simulated HTTP 429 rate-limit / quota failure from `api.openai.com`.
    Simulated429RateLimit,
    /// Live `reqwest::Client` execution against `https://api.openai.com/v1/chat/completions`.
    LiveHttp,
}

/// Official OpenAI REST API adapter (`D06`, `D12`, `T07A`, `BILL-001`..`BILL-008`, `@S28`, `@S31`, `@S66`, `@S67`, `@S68`).
pub struct OpenAiHttpProvider {
    endpoint_url: String,
    capabilities: ProviderCapabilities,
    pinned_binding: PinnedByokBinding,
    transport_mode: OpenAiTransportMode,
    http_client: reqwest::Client,
}

impl OpenAiHttpProvider {
    /// Constructs a new `OpenAiHttpProvider`, validating `endpoint_url` against `OPENAI_ALLOWED_EGRESS_HOSTS`
    /// via `curriculum_domain::validate_outbound_egress_url` (`@S31`).
    pub fn new(
        endpoint_url: &str,
        model_id: impl Into<String>,
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        curriculum_domain::validate_outbound_egress_url(endpoint_url, &OPENAI_ALLOWED_EGRESS_HOSTS)
            .map_err(|e| ProviderError::UnsafeEndpointUrl {
                url: endpoint_url.to_string(),
                reason: e.to_string(),
            })?;

        let model_id = model_id.into();
        let http_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ProviderError::InvalidCandidateOutput {
                message: format!("failed to build reqwest client: {e}"),
            })?;

        Ok(Self {
            endpoint_url: endpoint_url.to_string(),
            capabilities: ProviderCapabilities {
                provider_id: "openai".to_string(),
                model_id,
                structured_output: StructuredOutputCapability::NativeJsonSchema,
                streaming: true,
                output_limit: TokenLimits {
                    max_context_tokens: 128_000,
                    max_output_tokens: 16_384,
                },
                usage_reporting: UsageReportingCapability::ExactTokenCounts,
                supports_cooperative_cancellation: true,
            },
            pinned_binding,
            transport_mode,
            http_client,
        })
    }

    pub fn endpoint_url(&self) -> &str {
        &self.endpoint_url
    }

    pub fn pinned_binding(&self) -> &PinnedByokBinding {
        &self.pinned_binding
    }

    /// Builds the official OpenAI `/v1/chat/completions` JSON request body with `response_format: json_schema`.
    pub fn build_openai_request_body(&self, request: &CandidateGenerationRequest) -> Value {
        serde_json::json!({
            "model": self.capabilities.model_id,
            "max_completion_tokens": request.max_output_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "curriculum_candidate",
                    "strict": true
                }
            },
            "messages": [
                {
                    "role": "system",
                    "content": "Generate a schema-valid curriculum candidate JSON object grounded only in approved catalog resource versions."
                },
                {
                    "role": "user",
                    "content": format!("request_id={} goal_id={}", request.request_id, request.goal_id)
                }
            ]
        })
    }

    /// Executes an async HTTP request via `reqwest::Client` against `https://api.openai.com/v1/chat/completions`.
    pub async fn execute_live_http_request(
        &self,
        request: &CandidateGenerationRequest,
        resolved_api_key: &str,
    ) -> Result<Value, ProviderError> {
        curriculum_domain::validate_outbound_egress_url(
            &self.endpoint_url,
            &OPENAI_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: self.endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        let body = self.build_openai_request_body(request);
        let resp = self
            .http_client
            .post(&self.endpoint_url)
            .bearer_auth(resolved_api_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|_| ProviderError::AmbiguousTimeout)?;

        let status = resp.status().as_u16();
        if status == 401 || status == 403 {
            return Err(ProviderError::AuthenticationFailure {
                mode: "byok".to_string(),
                message: format!(
                    "OpenAI rejected BYOK credential `{}` (HTTP {status}); no hosted fallback performed",
                    self.pinned_binding.credential_id
                ),
            });
        }
        if status == 429 {
            return Err(ProviderError::QuotaOrRateLimit {
                mode: "byok".to_string(),
                message: "OpenAI rate limit or quota exceeded (HTTP 429)".to_string(),
            });
        }
        if !resp.status().is_success() {
            return Err(ProviderError::InvalidCandidateOutput {
                message: format!("OpenAI returned non-success HTTP {status}"),
            });
        }

        resp.json::<Value>()
            .await
            .map_err(|e| ProviderError::InvalidCandidateOutput {
                message: format!("invalid JSON from OpenAI: {e}"),
            })
    }
}

impl InferenceProvider for OpenAiHttpProvider {
    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn generate_curriculum_candidate(
        &self,
        request: &CandidateGenerationRequest,
    ) -> Result<CandidateGenerationOutput, ProviderError> {
        // 1. Validate outbound endpoint allowlist (`@S31`)
        curriculum_domain::validate_outbound_egress_url(
            &self.endpoint_url,
            &OPENAI_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: self.endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        // 2. Enforce BYOK no-silent-fallback invariant (`BILL-001`, `BILL-006`, `@S28`, `@S66`)
        if request.allow_hosted_fallback || self.pinned_binding.allow_hosted_fallback {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

        // 3. Verify pinned `(credential_id, credential_version)` and active status (`BILL-007`, `@S67`)
        match &request.auth_mode {
            InferenceAuthMode::Byok {
                credential_id,
                credential_version,
            } => {
                if credential_id != &self.pinned_binding.credential_id
                    || *credential_version != self.pinned_binding.credential_version
                {
                    return Err(ProviderError::CredentialBindingInvalid {
                        message: format!(
                            "request auth binding ({credential_id}@v{credential_version}) does not match pinned provider binding ({}@v{})",
                            self.pinned_binding.credential_id,
                            self.pinned_binding.credential_version
                        ),
                    });
                }
            }
            _ => {
                return Err(ProviderError::CredentialBindingInvalid {
                    message: "OpenAiHttpProvider in BYOK mode requires InferenceAuthMode::Byok"
                        .to_string(),
                });
            }
        }

        curriculum_domain::validate_byok_credential_usable(
            self.pinned_binding.status,
            self.pinned_binding.allow_hosted_fallback,
        )
        .map_err(|e| ProviderError::AuthenticationFailure {
            mode: "byok".to_string(),
            message: e.to_string(),
        })?;

        if request.max_output_tokens > self.capabilities.output_limit.max_output_tokens {
            return Err(ProviderError::OutputLimitExceeded {
                requested: request.max_output_tokens,
                limit: self.capabilities.output_limit.max_output_tokens,
            });
        }

        match self.transport_mode {
            OpenAiTransportMode::Simulated401Unauthorized => {
                Err(ProviderError::AuthenticationFailure {
                    mode: "byok".to_string(),
                    message: "OpenAI rejected BYOK API key (HTTP 401); no hosted fallback performed"
                        .to_string(),
                })
            }
            OpenAiTransportMode::Simulated429RateLimit => Err(ProviderError::QuotaOrRateLimit {
                mode: "byok".to_string(),
                message: "OpenAI rate limit or quota exceeded (HTTP 429)".to_string(),
            }),
            OpenAiTransportMode::LiveHttp => Err(ProviderError::AmbiguousTimeout),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens,
                completion_tokens,
            } => {
                let root = curriculum_contracts::workspace_root();
                let candidate_path = root.join(
                    "specs/001-curriculum-platform/examples/curriculum-candidate.synthetic.json",
                );
                let raw_bytes =
                    std::fs::read(&candidate_path).expect("read canonical candidate fixture");
                let candidate_sha256 = sha256_bytes_hex(&raw_bytes);
                let raw_candidate_json =
                    String::from_utf8(raw_bytes).expect("canonical candidate is valid UTF-8");
                let parsed_candidate: Value =
                    serde_json::from_str(&raw_candidate_json).expect("valid candidate JSON");

                let registry = curriculum_contracts::ContractRegistry::load_from_root(&root)
                    .expect("load registry");
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
                        input_tokens: prompt_tokens,
                        output_tokens: completion_tokens,
                        reporting_fidelity: UsageReportingCapability::ExactTokenCounts,
                        hosted_credits_charged_minor_units: 0,
                    },
                })
            }
        }
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

    #[test]
    fn t07a_s31_s66_s67_s68_openai_http_provider_enforces_egress_allowlist_and_pinned_byok() {
        let binding = PinnedByokBinding {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            credential_id: "cred-openai-1".to_string(),
            credential_version: 2,
            status: curriculum_domain::CredentialStatus::Active,
            allow_hosted_fallback: false,
        };

        // @S31: Reject non-allowlisted or internal SSRF URLs
        assert!(OpenAiHttpProvider::new(
            "https://evil.example.com/v1/chat/completions",
            "gpt-4o-2024-08-06",
            binding.clone(),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1500,
                completion_tokens: 1100,
            },
        )
        .is_err());
        assert!(OpenAiHttpProvider::new(
            "https://169.254.169.254/latest/meta-data",
            "gpt-4o-2024-08-06",
            binding.clone(),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1500,
                completion_tokens: 1100,
            },
        )
        .is_err());

        // Official endpoint succeeds
        let provider = OpenAiHttpProvider::new(
            OPENAI_CHAT_COMPLETIONS_URL,
            "gpt-4o-2024-08-06",
            binding.clone(),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1500,
                completion_tokens: 1100,
            },
        )
        .expect("valid OpenAiHttpProvider");

        assert_eq!(provider.capabilities().provider_id, "openai");
        assert_eq!(
            provider.capabilities().structured_output,
            StructuredOutputCapability::NativeJsonSchema
        );

        let req = CandidateGenerationRequest {
            request_id: "req-openai-1".to_string(),
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            goal_id: "goal-rag-python".to_string(),
            auth_mode: InferenceAuthMode::Byok {
                credential_id: "cred-openai-1".to_string(),
                credential_version: 2,
            },
            allow_hosted_fallback: false,
            max_output_tokens: 4_096,
        };

        let out = provider
            .generate_curriculum_candidate(&req)
            .expect("pinned BYOK request succeeds");
        assert_eq!(out.usage.input_tokens, 1500);
        assert_eq!(out.usage.output_tokens, 1100);
        assert_eq!(out.usage.hosted_credits_charged_minor_units, 0);

        // Stale credential version is rejected
        let stale_req = CandidateGenerationRequest {
            auth_mode: InferenceAuthMode::Byok {
                credential_id: "cred-openai-1".to_string(),
                credential_version: 1,
            },
            ..req.clone()
        };
        assert!(matches!(
            provider
                .generate_curriculum_candidate(&stale_req)
                .unwrap_err(),
            ProviderError::CredentialBindingInvalid { .. }
        ));

        // @S67: Revoked credential fails closed without fallback
        let revoked_provider = OpenAiHttpProvider::new(
            OPENAI_CHAT_COMPLETIONS_URL,
            "gpt-4o-2024-08-06",
            PinnedByokBinding {
                status: curriculum_domain::CredentialStatus::Revoked,
                ..binding
            },
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1500,
                completion_tokens: 1100,
            },
        )
        .unwrap();
        assert!(matches!(
            revoked_provider
                .generate_curriculum_candidate(&req)
                .unwrap_err(),
            ProviderError::AuthenticationFailure { .. }
        ));
    }
}
