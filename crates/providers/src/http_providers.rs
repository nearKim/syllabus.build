//! Official OpenAI, Anthropic, and Google Gemini HTTP provider adapters with SSRF egress validation and BYOK credential pinning.

use crate::*;
use curriculum_contracts::jcs::sha256_bytes_hex;
use serde_json::Value;

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
        let http_client = build_no_redirect_http_client(None)?;

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

        handle_live_http_response(resp, "OpenAI", &self.pinned_binding.credential_id).await
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
        execute_pinned_byok_candidate_generation(
            &self.endpoint_url,
            &OPENAI_ALLOWED_EGRESS_HOSTS,
            "OpenAI",
            &self.capabilities,
            &self.pinned_binding,
            self.transport_mode.clone(),
            request,
        )
    }
}

fn execute_pinned_byok_candidate_generation(
    endpoint_url: &str,
    allowed_hosts: &[&str],
    provider_display_name: &str,
    capabilities: &ProviderCapabilities,
    pinned_binding: &PinnedByokBinding,
    transport_mode: OpenAiTransportMode,
    request: &CandidateGenerationRequest,
) -> Result<CandidateGenerationOutput, ProviderError> {
    // 1. Validate outbound endpoint allowlist (`@S31`)
    curriculum_domain::validate_outbound_egress_url(endpoint_url, allowed_hosts).map_err(|e| {
        ProviderError::UnsafeEndpointUrl {
            url: endpoint_url.to_string(),
            reason: e.to_string(),
        }
    })?;

    // 2. Enforce BYOK no-silent-fallback invariant (`BILL-001`, `BILL-006`, `@S28`, `@S66`)
    if request.allow_hosted_fallback || pinned_binding.allow_hosted_fallback {
        return Err(ProviderError::ForbiddenHostedFallback);
    }

    // 3. Verify pinned `(credential_id, credential_version)` and active status (`BILL-007`, `@S67`)
    match &request.auth_mode {
        InferenceAuthMode::Byok {
            credential_id,
            credential_version,
        } => {
            if credential_id != &pinned_binding.credential_id
                || *credential_version != pinned_binding.credential_version
            {
                return Err(ProviderError::CredentialBindingInvalid {
                    message: format!(
                        "request auth binding ({credential_id}@v{credential_version}) does not match pinned provider binding ({}@v{})",
                        pinned_binding.credential_id, pinned_binding.credential_version
                    ),
                });
            }
        }
        _ => {
            return Err(ProviderError::CredentialBindingInvalid {
                message: format!(
                    "{provider_display_name} provider in BYOK mode requires InferenceAuthMode::Byok"
                ),
            });
        }
    }

    curriculum_domain::validate_byok_credential_usable(
        pinned_binding.status,
        pinned_binding.allow_hosted_fallback,
    )
    .map_err(|e| ProviderError::AuthenticationFailure {
        mode: "byok".to_string(),
        message: e.to_string(),
    })?;

    if request.max_output_tokens > capabilities.output_limit.max_output_tokens {
        return Err(ProviderError::OutputLimitExceeded {
            requested: request.max_output_tokens,
            limit: capabilities.output_limit.max_output_tokens,
        });
    }

    match transport_mode {
        OpenAiTransportMode::Simulated401Unauthorized => {
            Err(ProviderError::AuthenticationFailure {
                mode: "byok".to_string(),
                message: format!(
                    "{provider_display_name} rejected BYOK API key (HTTP 401); no hosted fallback performed"
                ),
            })
        }
        OpenAiTransportMode::Simulated429RateLimit => Err(ProviderError::QuotaOrRateLimit {
            mode: "byok".to_string(),
            message: format!("{provider_display_name} rate limit or quota exceeded (HTTP 429)"),
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

// =============================================================================
// T07C: Additional Live Providers (Anthropic Messages API & Google Gemini API)
// =============================================================================

/// Official Anthropic Messages API endpoint (`T07C`).
pub const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";

/// Allowed egress hostnames for Anthropic provider requests (`@S31`).
pub const ANTHROPIC_ALLOWED_EGRESS_HOSTS: [&str; 1] = ["api.anthropic.com"];

/// Official Google Gemini `generateContent` endpoint (`T07C`).
pub const GEMINI_GENERATE_CONTENT_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

/// Allowed egress hostnames for Google Gemini provider requests (`@S31`).
pub const GEMINI_ALLOWED_EGRESS_HOSTS: [&str; 1] = ["generativelanguage.googleapis.com"];

/// Live Anthropic HTTP provider adapter over `reqwest` (`T07C`, `BILL-001`, `BILL-005`..`BILL-008`).
#[derive(Debug, Clone)]
pub struct AnthropicHttpProvider {
    endpoint_url: String,
    capabilities: ProviderCapabilities,
    pinned_binding: PinnedByokBinding,
    transport_mode: OpenAiTransportMode,
    http_client: reqwest::Client,
}

impl AnthropicHttpProvider {
    pub fn new(
        endpoint_url: impl Into<String>,
        model_id: impl Into<String>,
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        let endpoint_url = endpoint_url.into();
        curriculum_domain::validate_outbound_egress_url(
            &endpoint_url,
            &ANTHROPIC_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        if pinned_binding.allow_hosted_fallback {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

        let http_client = build_no_redirect_http_client(Some(std::time::Duration::from_secs(30)))?;

        Ok(Self {
            endpoint_url,
            capabilities: ProviderCapabilities {
                provider_id: "anthropic".to_string(),
                model_id: model_id.into(),
                structured_output: StructuredOutputCapability::ToolCallSchema,
                streaming: true,
                output_limit: TokenLimits {
                    max_context_tokens: 200_000,
                    max_output_tokens: 8_192,
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

    /// Builds the official Anthropic `/v1/messages` JSON request body using tool-call schema output.
    pub fn build_anthropic_request_body(&self, request: &CandidateGenerationRequest) -> Value {
        serde_json::json!({
            "model": self.capabilities.model_id,
            "max_tokens": request.max_output_tokens,
            "tools": [
                {
                    "name": "curriculum_candidate",
                    "description": "Emit a schema-valid curriculum candidate JSON object grounded only in approved catalog resource versions.",
                    "input_schema": {
                        "type": "object"
                    }
                }
            ],
            "tool_choice": {
                "type": "tool",
                "name": "curriculum_candidate"
            },
            "messages": [
                {
                    "role": "user",
                    "content": format!("request_id={} goal_id={}", request.request_id, request.goal_id)
                }
            ]
        })
    }

    /// Executes an async HTTP request via `reqwest::Client` against `https://api.anthropic.com/v1/messages`.
    pub async fn execute_live_http_request(
        &self,
        request: &CandidateGenerationRequest,
        resolved_api_key: &str,
    ) -> Result<Value, ProviderError> {
        curriculum_domain::validate_outbound_egress_url(
            &self.endpoint_url,
            &ANTHROPIC_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: self.endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        let body = self.build_anthropic_request_body(request);
        let resp = self
            .http_client
            .post(&self.endpoint_url)
            .header("x-api-key", resolved_api_key.trim())
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|_| ProviderError::AmbiguousTimeout)?;

        handle_live_http_response(resp, "Anthropic", &self.pinned_binding.credential_id).await
    }
}

impl InferenceProvider for AnthropicHttpProvider {
    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn generate_curriculum_candidate(
        &self,
        request: &CandidateGenerationRequest,
    ) -> Result<CandidateGenerationOutput, ProviderError> {
        execute_pinned_byok_candidate_generation(
            &self.endpoint_url,
            &ANTHROPIC_ALLOWED_EGRESS_HOSTS,
            "Anthropic",
            &self.capabilities,
            &self.pinned_binding,
            self.transport_mode.clone(),
            request,
        )
    }
}

/// Live Google Gemini HTTP provider adapter over `reqwest` (`T07C`, `BILL-001`, `BILL-005`..`BILL-008`).
#[derive(Debug, Clone)]
pub struct GeminiHttpProvider {
    endpoint_url: String,
    capabilities: ProviderCapabilities,
    pinned_binding: PinnedByokBinding,
    transport_mode: OpenAiTransportMode,
    http_client: reqwest::Client,
}

impl GeminiHttpProvider {
    pub fn new(
        endpoint_url: impl Into<String>,
        model_id: impl Into<String>,
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        let endpoint_url = endpoint_url.into();
        curriculum_domain::validate_outbound_egress_url(
            &endpoint_url,
            &GEMINI_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        if pinned_binding.allow_hosted_fallback {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

        let http_client = build_no_redirect_http_client(Some(std::time::Duration::from_secs(30)))?;

        Ok(Self {
            endpoint_url,
            capabilities: ProviderCapabilities {
                provider_id: "google-gemini".to_string(),
                model_id: model_id.into(),
                structured_output: StructuredOutputCapability::NativeJsonSchema,
                streaming: true,
                output_limit: TokenLimits {
                    max_context_tokens: 1_048_576,
                    max_output_tokens: 8_192,
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

    /// Builds the official Google Gemini `generateContent` JSON request body with native JSON schema config.
    pub fn build_gemini_request_body(&self, request: &CandidateGenerationRequest) -> Value {
        serde_json::json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": format!("request_id={} goal_id={}", request.request_id, request.goal_id)
                        }
                    ]
                }
            ],
            "generationConfig": {
                "maxOutputTokens": request.max_output_tokens,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT"
                }
            }
        })
    }

    /// Executes an async HTTP request via `reqwest::Client` against `https://generativelanguage.googleapis.com/v1beta/...`.
    pub async fn execute_live_http_request(
        &self,
        request: &CandidateGenerationRequest,
        resolved_api_key: &str,
    ) -> Result<Value, ProviderError> {
        curriculum_domain::validate_outbound_egress_url(
            &self.endpoint_url,
            &GEMINI_ALLOWED_EGRESS_HOSTS,
        )
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: self.endpoint_url.clone(),
            reason: e.to_string(),
        })?;

        let body = self.build_gemini_request_body(request);
        let resp = self
            .http_client
            .post(&self.endpoint_url)
            .header("x-goog-api-key", resolved_api_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|_| ProviderError::AmbiguousTimeout)?;

        handle_live_http_response(resp, "Gemini", &self.pinned_binding.credential_id).await
    }
}

impl InferenceProvider for GeminiHttpProvider {
    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    fn generate_curriculum_candidate(
        &self,
        request: &CandidateGenerationRequest,
    ) -> Result<CandidateGenerationOutput, ProviderError> {
        execute_pinned_byok_candidate_generation(
            &self.endpoint_url,
            &GEMINI_ALLOWED_EGRESS_HOSTS,
            "Gemini",
            &self.capabilities,
            &self.pinned_binding,
            self.transport_mode.clone(),
            request,
        )
    }
}
