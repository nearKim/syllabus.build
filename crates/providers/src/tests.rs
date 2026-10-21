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

    #[test]
    fn t07c_s28_s31_s66_s67_s82_anthropic_and_gemini_http_providers_enforce_allowlist_and_pinned_byok()
    {
        let anthropic_binding = PinnedByokBinding {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            credential_id: "cred-anthropic-1".to_string(),
            credential_version: 1,
            status: curriculum_domain::CredentialStatus::Active,
            allow_hosted_fallback: false,
        };

        // Non-allowlisted host rejected (@S31)
        assert!(AnthropicHttpProvider::new(
            "https://api.openai.com/v1/messages",
            "claude-3-5-sonnet-20241022",
            anthropic_binding.clone(),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1200,
                completion_tokens: 900,
            },
        )
        .is_err());

        let anthropic = AnthropicHttpProvider::new(
            ANTHROPIC_MESSAGES_URL,
            "claude-3-5-sonnet-20241022",
            anthropic_binding,
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1200,
                completion_tokens: 900,
            },
        )
        .expect("valid AnthropicHttpProvider");
        assert_eq!(anthropic.capabilities().provider_id, "anthropic");
        assert_eq!(
            anthropic.capabilities().model_id,
            "claude-3-5-sonnet-20241022"
        );
        assert_eq!(
            anthropic.capabilities().structured_output,
            StructuredOutputCapability::ToolCallSchema
        );

        let anthropic_req = CandidateGenerationRequest {
            request_id: "req-anthropic-1".to_string(),
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            goal_id: "goal-rag-python".to_string(),
            auth_mode: InferenceAuthMode::Byok {
                credential_id: "cred-anthropic-1".to_string(),
                credential_version: 1,
            },
            allow_hosted_fallback: false,
            max_output_tokens: 4_096,
        };
        let anthropic_body = anthropic.build_anthropic_request_body(&anthropic_req);
        assert_eq!(
            anthropic_body["tool_choice"]["name"].as_str(),
            Some("curriculum_candidate")
        );
        let anthropic_out = anthropic
            .generate_curriculum_candidate(&anthropic_req)
            .expect("Anthropic generation succeeds");
        assert_eq!(anthropic_out.usage.input_tokens, 1200);
        assert_eq!(anthropic_out.usage.output_tokens, 900);
        assert_eq!(anthropic_out.usage.hosted_credits_charged_minor_units, 0);

        // Gemini provider (@S31, @S66, @S82)
        let gemini_binding = PinnedByokBinding {
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            credential_id: "cred-gemini-1".to_string(),
            credential_version: 3,
            status: curriculum_domain::CredentialStatus::Active,
            allow_hosted_fallback: false,
        };
        assert!(GeminiHttpProvider::new(
            "https://evil.example.com/v1beta/models/gemini-2.5-pro:generateContent",
            "gemini-2.5-pro",
            gemini_binding.clone(),
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1800,
                completion_tokens: 1000,
            },
        )
        .is_err());

        let gemini = GeminiHttpProvider::new(
            GEMINI_GENERATE_CONTENT_URL,
            "gemini-2.5-pro",
            gemini_binding,
            OpenAiTransportMode::Simulated200Ok {
                prompt_tokens: 1800,
                completion_tokens: 1000,
            },
        )
        .expect("valid GeminiHttpProvider");
        assert_eq!(gemini.capabilities().provider_id, "google-gemini");
        assert_eq!(gemini.capabilities().model_id, "gemini-2.5-pro");
        assert_eq!(
            gemini.capabilities().structured_output,
            StructuredOutputCapability::NativeJsonSchema
        );

        let gemini_req = CandidateGenerationRequest {
            request_id: "req-gemini-1".to_string(),
            account_id: "00000000-0000-4000-8000-000000000001".to_string(),
            goal_id: "goal-rag-python".to_string(),
            auth_mode: InferenceAuthMode::Byok {
                credential_id: "cred-gemini-1".to_string(),
                credential_version: 3,
            },
            allow_hosted_fallback: false,
            max_output_tokens: 4_096,
        };
        let gemini_body = gemini.build_gemini_request_body(&gemini_req);
        assert_eq!(
            gemini_body["generationConfig"]["responseMimeType"].as_str(),
            Some("application/json")
        );
        let gemini_out = gemini
            .generate_curriculum_candidate(&gemini_req)
            .expect("Gemini generation succeeds");
        assert_eq!(gemini_out.usage.input_tokens, 1800);
        assert_eq!(gemini_out.usage.output_tokens, 1000);
        assert_eq!(gemini_out.usage.hosted_credits_charged_minor_units, 0);
    }
