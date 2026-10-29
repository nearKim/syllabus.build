//! Official OpenAI, Anthropic, and Google Gemini HTTP provider adapters with SSRF egress validation and BYOK credential pinning.

use std::time::Duration;

use serde_json::Value;

use crate::{
    CandidateGenerationOutput, CandidateGenerationRequest, InferenceAuthMode, InferenceProvider,
    NormalizedUsageReport, ProviderCapabilities, ProviderError, StructuredOutputCapability,
    TokenLimits, UsageReportingCapability, build_no_redirect_http_client,
    handle_live_http_response, load_validated_canonical_candidate,
};

// =============================================================================
// T07A: Official OpenAI REST Provider (`OpenAiHttpProvider`) over `reqwest`
// =============================================================================

/// Canonical OpenAI Chat Completions endpoint (`D06`, `D12`, `T07A`).
pub const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

/// Allowed outbound DNS hosts for `OpenAiHttpProvider` (`@S31`).
pub const OPENAI_ALLOWED_EGRESS_HOSTS: [&str; 1] = ["api.openai.com"];

/// Default fast, cost-efficient OpenAI model for live E2E synthesis (`gpt-6-mini`).
pub const DEFAULT_CHEAP_OPENAI_MODEL: &str = "gpt-6-mini";

/// Default fast, cost-efficient Anthropic model for live E2E synthesis (`claude-haiku-5-5`).
pub const DEFAULT_CHEAP_ANTHROPIC_MODEL: &str = "claude-haiku-5-5";

/// Default fast, cost-efficient Google Gemini model for live E2E synthesis (`gemini-4-flash`).
pub const DEFAULT_CHEAP_GEMINI_MODEL: &str = "gemini-4-flash";

/// Official Google Gemini `generateContent` endpoint for the cheap default model (`gemini-4-flash`).
pub const GEMINI_CHEAP_GENERATE_CONTENT_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-flash:generateContent";

/// Resolves the canonical cheap, low-latency model identifier for a given provider ID.
#[must_use]
pub fn default_cheap_model_for_provider(provider_id: &str) -> &'static str {
    match provider_id.trim().to_ascii_lowercase().as_str() {
        "anthropic" => DEFAULT_CHEAP_ANTHROPIC_MODEL,
        "google" | "gemini" | "google-gemini" => DEFAULT_CHEAP_GEMINI_MODEL,
        _ => DEFAULT_CHEAP_OPENAI_MODEL,
    }
}

/// Pinned BYOK credential binding passed to HTTP providers (`BILL-001`, `BILL-007`, `@S28`, `@S66`, `@S67`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinnedByokBinding {
    pub account_id: String,
    pub credential_id: String,
    pub credential_version: u32,
    pub status: curriculum_domain::CredentialStatus,
    pub allow_hosted_fallback: bool,
}

/// Transport execution mode for HTTP providers (`D12`, `T07A`, `T07C`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAiTransportMode {
    /// Deterministic local/test response simulating a 200 OK from the provider with exact usage counts.
    Simulated200Ok {
        prompt_tokens: u32,
        completion_tokens: u32,
    },
    /// Simulated HTTP 401/403 authentication failure from the provider.
    Simulated401Unauthorized,
    /// Simulated HTTP 429 rate-limit / quota failure from the provider.
    Simulated429RateLimit,
    /// Live `reqwest::Client` execution against the provider endpoint.
    LiveHttp,
}

/// Provider-neutral alias for [`OpenAiTransportMode`].
pub type HttpTransportMode = OpenAiTransportMode;

fn validate_endpoint_egress(endpoint_url: &str, allowed_hosts: &[&str]) -> Result<(), ProviderError> {
    curriculum_domain::validate_outbound_egress_url(endpoint_url, allowed_hosts)
        .map(|_| ())
        .map_err(|e| ProviderError::UnsafeEndpointUrl {
            url: endpoint_url.to_string(),
            reason: e.to_string(),
        })
}

fn init_pinned_http_client(
    endpoint_url: &str,
    allowed_hosts: &[&str],
    timeout: Option<Duration>,
) -> Result<reqwest::Client, ProviderError> {
    validate_endpoint_egress(endpoint_url, allowed_hosts)?;
    build_no_redirect_http_client(timeout)
}

async fn send_pinned_live_http_request(
    endpoint_url: &str,
    allowed_hosts: &[&str],
    provider_display_name: &str,
    credential_id: &str,
    request_builder: reqwest::RequestBuilder,
    body: &Value,
) -> Result<Value, ProviderError> {
    validate_endpoint_egress(endpoint_url, allowed_hosts)?;
    let resp = request_builder
        .json(body)
        .send()
        .await
        .map_err(|_| ProviderError::AmbiguousTimeout)?;
    handle_live_http_response(resp, provider_display_name, credential_id).await
}

/// Official OpenAI REST API adapter (`D06`, `D12`, `T07A`, `BILL-001`..`BILL-008`, `@S28`, `@S31`, `@S66`, `@S67`, `@S68`).
#[derive(Debug, Clone)]
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
        let http_client = init_pinned_http_client(endpoint_url, &OPENAI_ALLOWED_EGRESS_HOSTS, None)?;

        Ok(Self {
            endpoint_url: endpoint_url.to_string(),
            capabilities: ProviderCapabilities {
                provider_id: "openai".to_string(),
                model_id: model_id.into(),
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

    /// Constructs a new `OpenAiHttpProvider` configured with [`DEFAULT_CHEAP_OPENAI_MODEL`] (`gpt-6-mini`).
    pub fn new_cheap_default(
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        Self::new(
            OPENAI_CHAT_COMPLETIONS_URL,
            DEFAULT_CHEAP_OPENAI_MODEL,
            pinned_binding,
            transport_mode,
        )
    }

    #[must_use]
    pub fn endpoint_url(&self) -> &str {
        &self.endpoint_url
    }

    #[must_use]
    pub fn pinned_binding(&self) -> &PinnedByokBinding {
        &self.pinned_binding
    }

    /// Builds the official OpenAI `/v1/chat/completions` JSON request body with `response_format: json_schema`.
    #[must_use]
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
        let body = self.build_openai_request_body(request);
        let req = self
            .http_client
            .post(&self.endpoint_url)
            .bearer_auth(resolved_api_key.trim());
        send_pinned_live_http_request(
            &self.endpoint_url,
            &OPENAI_ALLOWED_EGRESS_HOSTS,
            "OpenAI",
            &self.pinned_binding.credential_id,
            req,
            &body,
        )
        .await
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
            self.transport_mode,
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
    validate_endpoint_egress(endpoint_url, allowed_hosts)?;

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
            let (raw_candidate_json, candidate_sha256, parsed_candidate) =
                load_validated_canonical_candidate()?;

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
        let http_client = init_pinned_http_client(
            &endpoint_url,
            &ANTHROPIC_ALLOWED_EGRESS_HOSTS,
            Some(Duration::from_secs(30)),
        )?;

        if pinned_binding.allow_hosted_fallback {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

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

    /// Constructs a new `AnthropicHttpProvider` configured with [`DEFAULT_CHEAP_ANTHROPIC_MODEL`] (`claude-haiku-5-5`).
    pub fn new_cheap_default(
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        Self::new(
            ANTHROPIC_MESSAGES_URL,
            DEFAULT_CHEAP_ANTHROPIC_MODEL,
            pinned_binding,
            transport_mode,
        )
    }

    #[must_use]
    pub fn endpoint_url(&self) -> &str {
        &self.endpoint_url
    }

    #[must_use]
    pub fn pinned_binding(&self) -> &PinnedByokBinding {
        &self.pinned_binding
    }

    /// Builds the official Anthropic `/v1/messages` JSON request body using tool-call schema output.
    #[must_use]
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
        let body = self.build_anthropic_request_body(request);
        let req = self
            .http_client
            .post(&self.endpoint_url)
            .header("x-api-key", resolved_api_key.trim())
            .header("anthropic-version", "2023-06-01");
        send_pinned_live_http_request(
            &self.endpoint_url,
            &ANTHROPIC_ALLOWED_EGRESS_HOSTS,
            "Anthropic",
            &self.pinned_binding.credential_id,
            req,
            &body,
        )
        .await
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
            self.transport_mode,
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
        let http_client = init_pinned_http_client(
            &endpoint_url,
            &GEMINI_ALLOWED_EGRESS_HOSTS,
            Some(Duration::from_secs(30)),
        )?;

        if pinned_binding.allow_hosted_fallback {
            return Err(ProviderError::ForbiddenHostedFallback);
        }

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

    /// Constructs a new `GeminiHttpProvider` configured with [`DEFAULT_CHEAP_GEMINI_MODEL`] (`gemini-4-flash`).
    pub fn new_cheap_default(
        pinned_binding: PinnedByokBinding,
        transport_mode: OpenAiTransportMode,
    ) -> Result<Self, ProviderError> {
        Self::new(
            GEMINI_CHEAP_GENERATE_CONTENT_URL,
            DEFAULT_CHEAP_GEMINI_MODEL,
            pinned_binding,
            transport_mode,
        )
    }

    #[must_use]
    pub fn endpoint_url(&self) -> &str {
        &self.endpoint_url
    }

    #[must_use]
    pub fn pinned_binding(&self) -> &PinnedByokBinding {
        &self.pinned_binding
    }

    /// Builds the official Google Gemini `generateContent` JSON request body with native JSON schema config.
    #[must_use]
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
        let body = self.build_gemini_request_body(request);
        let req = self
            .http_client
            .post(&self.endpoint_url)
            .header("x-goog-api-key", resolved_api_key.trim());
        send_pinned_live_http_request(
            &self.endpoint_url,
            &GEMINI_ALLOWED_EGRESS_HOSTS,
            "Gemini",
            &self.pinned_binding.credential_id,
            req,
            &body,
        )
        .await
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
            self.transport_mode,
            request,
        )
    }
}
