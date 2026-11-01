use super::*;
use std::collections::BTreeMap;

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

    let s2 =
        derive_proficiency_transition(s1, EvidenceOrigin::FormativePracticeCompletion).unwrap();
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

#[test]
fn t07b_t07d_quote_reservation_settlement_and_ambiguous_timeout_invariants() {
    let quote = UsageQuote {
        quote_id: "quote-001".to_string(),
        account_id: "acct-1".to_string(),
        operation_kind: "syllabus_generation".to_string(),
        billing_mode: BillingModeKind::HostedCredits,
        provider_id: "openai".to_string(),
        model_id: "gpt-4.1-mini".to_string(),
        currency: "USD".to_string(),
        estimated_minor_units: 120,
        max_reservable_minor_units: 150,
        external_byok_estimated_minor_units: 0,
        learning_materials_estimated_minor_units: 0,
        pricing_snapshot_version: "pricing-2026-03-v1".to_string(),
        expires_at_epoch_seconds: 1_800_000_000,
    };

    // Expired quote rejected (@S30)
    assert!(authorize_credit_reservation(500, 0, &quote, 150, 1_800_000_001).is_err());

    // Insufficient funds rejected (@S68)
    assert!(authorize_credit_reservation(100, 0, &quote, 150, 1_799_000_000).is_err());

    // Valid hold succeeds
    let (avail, res) = authorize_credit_reservation(500, 0, &quote, 150, 1_799_000_000).unwrap();
    assert_eq!((avail, res), (350, 150));

    // Settlement is capped at reserved_minor_units (@S30, @S68)
    let (settled, released) = compute_reservation_settlement(150, 220).unwrap();
    assert_eq!((settled, released), (150, 0));

    let (settled_under, released_under) = compute_reservation_settlement(150, 110).unwrap();
    assert_eq!((settled_under, released_under), (110, 40));

    // Ambiguous timeout without committed artifact releases 100% of reservation (@S43, @S68)
    let (status, s0, r0) = evaluate_ambiguous_timeout_reconciliation(
        150,
        false,
        AmbiguousProviderOutcome::UnconfirmedTimeoutWithoutCommittedOutput,
    )
    .unwrap();
    assert_eq!(status, ReservationStatus::Released);
    assert_eq!((s0, r0), (0, 150));
}

#[test]
fn t13_public_snapshot_sanitizer_preview_digest_and_partial_adoption_closure() {
    // Private field rejected
    assert!(PublicSnapshotSanitizer::validate_sanitized_field_keys(
        &["account_id".to_string()],
        &[]
    )
    .is_err());
    // Non-null restricted field rejected
    assert!(PublicSnapshotSanitizer::validate_sanitized_field_keys(
        &["title".to_string()],
        &["full_text_excerpt".to_string()]
    )
    .is_err());
    // Clean keys accepted
    assert!(PublicSnapshotSanitizer::validate_sanitized_field_keys(
        &["title".to_string(), "modules".to_string()],
        &[]
    )
    .is_ok());

    let digest = PublicationPreviewDigest {
        preview_sha256: "a".repeat(64),
        content_sha256: "b".repeat(64),
        visibility: "public".to_string(),
    };
    assert!(digest
        .validate_publication_confirmation(&"a".repeat(64), &"a".repeat(64), false)
        .is_err());
    assert!(digest
        .validate_publication_confirmation(&"c".repeat(64), &"a".repeat(64), true)
        .is_err());
    assert!(digest
        .validate_publication_confirmation(&"a".repeat(64), &"a".repeat(64), true)
        .is_ok());

    // Partial adoption transitive closure (@S59, @S72)
    let module_edges = vec![
        ("mod-1".to_string(), vec![]),
        ("mod-2".to_string(), vec!["mod-1".to_string()]),
        ("mod-3".to_string(), vec!["mod-2".to_string()]),
    ];
    let mut module_objectives = BTreeMap::new();
    module_objectives.insert("mod-1".to_string(), vec!["obj-1".to_string()]);
    module_objectives.insert("mod-2".to_string(), vec!["obj-2".to_string()]);
    module_objectives.insert("mod-3".to_string(), vec!["obj-3".to_string()]);
    let objective_edges = vec![
        ("obj-1".to_string(), vec![]),
        ("obj-2".to_string(), vec!["obj-1".to_string()]),
        ("obj-3".to_string(), vec!["obj-2".to_string()]),
    ];

    let closure = compute_partial_adoption_closure(
        &module_edges,
        &module_objectives,
        &objective_edges,
        &["mod-2".to_string()],
    )
    .unwrap();
    assert_eq!(closure.ordered_module_ids, vec!["mod-1", "mod-2"]);
    assert_eq!(closure.auto_included_prerequisite_module_ids, vec!["mod-1"]);
    assert_eq!(closure.ordered_objective_ids, vec!["obj-1", "obj-2"]);
    assert_eq!(
        closure.initial_proficiency_states.get("obj-1"),
        Some(&ObjectiveProficiencyState::Unassessed)
    );
}

#[test]
fn t10_t11_pedagogical_evaluation_and_native_alarm_boundary() {
    let retrieval = evaluate_retrieval_benchmark(
        &[RetrievalBenchmarkCase {
            query_id: "q1".to_string(),
            retrieved_resource_ids: vec!["r1".to_string(), "r2".to_string()],
            relevant_resource_ids: vec!["r1".to_string(), "r2".to_string()],
            unlicensed_or_broken_count: 0,
        }],
        8_000,
        8_000,
    )
    .unwrap();
    assert!(retrieval.passed);

    let rubric = evaluate_syllabus_expert_rubric(
        &[
            SyllabusExpertRubricScore {
                rater_id: "sme-1".to_string(),
                prerequisite_coherence_bp: 9_000,
                workload_realism_bp: 8_800,
                pedagogical_triad_bp: 9_200,
                citation_grounding_bp: 9_000,
            },
            SyllabusExpertRubricScore {
                rater_id: "sme-2".to_string(),
                prerequisite_coherence_bp: 8_800,
                workload_realism_bp: 8_600,
                pedagogical_triad_bp: 9_000,
                citation_grounding_bp: 8_800,
            },
        ],
        8_000,
        1_000,
    )
    .unwrap();
    assert!(rubric.passed);

    let psych = evaluate_anchor_item_psychometrics(&AnchorAssessmentPsychometricInput {
        item_id: "item-1".to_string(),
        sample_size: 50,
        difficulty_p_bp: 6_500,
        discrimination_r_pb_bp: 3_500,
        open_defect_reports: 0,
    })
    .unwrap();
    assert!(psych.calibration_healthy);

    // Conflating completion or upvotes with mastery is strictly rejected (@S44, @S50, @S62)
    assert!(evaluate_delayed_retention_and_transfer_study(
        &DelayedRetentionTransferCohortMetrics {
            cohort_id: "cohort-bad".to_string(),
            sample_size: 30,
            delayed_7d_retention_bp: 8_000,
            delayed_30d_retention_bp: 7_500,
            far_transfer_pass_rate_bp: 7_000,
            includes_control_comparison: true,
            conflates_completion_or_upvotes_with_mastery: true,
        }
    )
    .is_err());

    // Web/PWA exact OS alarm capability boundary (@S35)
    let web_eval =
        validate_native_alarm_capability_boundary(ClientRuntimeKind::WebPwa, true).unwrap();
    assert!(matches!(
        web_eval,
        AlarmCapabilityEvaluation::UnsupportedWebPwaExactAlarm { .. }
    ));
}

#[test]
fn step_1_5_resource_fit_evaluation_and_polymorphic_index_descriptors() {
    let (norm_url, norm_ext) = normalize_canonical_resource_identity(
        "HTTPS://Example.Invalid/Catalog/Tokenization-Monograph/#section-2",
        Some(" ISBN:978-0-262-03561-3 "),
    );
    assert_eq!(
        norm_url,
        "https://example.invalid/catalog/tokenization-monograph"
    );
    assert_eq!(norm_ext.as_deref(), Some("isbn:978-0-262-03561-3"));

    let book_idx = ResourceIndexDescriptor::BookIndex {
        authors: vec!["A. Vaswani".to_string()],
        publisher: "Open ML Press".to_string(),
        edition: Some("2nd Edition".to_string()),
        brief_summary: "Covers BPE merge tables and scaled dot-product attention.".to_string(),
        table_of_contents: vec![BookTocChapter {
            segment_id: "seg-bpe-overview".to_string(),
            chapter_number: "2.1".to_string(),
            title: "Byte-Pair Encoding Merge Tables".to_string(),
            subtopics: vec!["Tokenization".to_string()],
            page_range: Some("42-58".to_string()),
        }],
        content_excerpts: None,
    };

    let candidates = vec![
        IndexedMaterialCandidate {
            resource_version_id: "res-v1-book".to_string(),
            resource_id: "res-book".to_string(),
            title: "Subword Tokenization & Attention Monograph".to_string(),
            resource_type: "book".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec![
                "Tokenization".to_string(),
                "Attention".to_string(),
                "Matrix Calculus".to_string(),
            ],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string()],
            access_model: CatalogAccessModel::FreePublic,
            price_minor_units: Some(0),
            review_status: ResourceReviewStatus::Approved,
            quarantined: false,
            index_descriptor: Some(book_idx),
        },
        IndexedMaterialCandidate {
            resource_version_id: "res-v2-paid".to_string(),
            resource_id: "res-paid".to_string(),
            title: "Paid FlashAttention Course".to_string(),
            resource_type: "course".to_string(),
            subject: "Engineering".to_string(),
            topic_tags: vec!["FlashAttention".to_string()],
            supported_math_depths: vec!["formal".to_string()],
            supported_roles: vec!["instruction".to_string(), "practice".to_string()],
            access_model: CatalogAccessModel::PaidPurchase,
            price_minor_units: Some(4900),
            review_status: ResourceReviewStatus::Approved,
            quarantined: false,
            index_descriptor: None,
        },
    ];

    let topics = vec![
        "Tokenization".to_string(),
        "Attention".to_string(),
        "Matrix Calculus".to_string(),
        "FlashAttention".to_string(),
    ];

    // 1. Free-only filters out paid course; accepting res-v1-book covers 3/4 topics and leaves 1 missing topic for delta search (Path B)
    let eval_partial = evaluate_resource_fit_and_coverage(
        "Engineering",
        &topics,
        "formal",
        true,
        &candidates,
        &["res-v1-book".to_string()],
        &[],
        None,
    );
    assert_eq!(eval_partial.ranked_materials.len(), 1);
    assert_eq!(eval_partial.covered_topics.len(), 3);
    assert_eq!(
        eval_partial.missing_topics_for_search,
        vec!["FlashAttention".to_string()]
    );
    assert_eq!(
        eval_partial.recommended_mode,
        ResourceFitDecisionMode::FillGaps
    );
    assert!(!eval_partial.web_search_bypassed);
    assert_eq!(
        eval_partial.cost_badge_label,
        "Search 1 missing topic · AI synthesis required"
    );

    // 2. Path A (UseSelectedOnly) bypasses web search completely
    let eval_selected_only = evaluate_resource_fit_and_coverage(
        "Engineering",
        &topics[..3],
        "formal",
        true,
        &candidates,
        &["res-v1-book".to_string()],
        &[],
        Some(ResourceFitDecisionMode::UseSelectedOnly),
    );
    assert!(eval_selected_only.web_search_bypassed);
    assert_eq!(
        eval_selected_only.cost_badge_label,
        "No web search · AI synthesis required"
    );
}

#[test]
fn sublinear_tfidf_corpus_index_and_cosine_similarity_ranking() {
    let mut index = TfIdfCorpusIndex::new();
    index.upsert_document(
        "doc-bpe-monograph",
        "Subword Tokenization Byte Pair Encoding BPE merge tables attention and vocabulary construction",
    );
    index.upsert_document(
        "doc-flash-attention",
        "FlashAttention IO-aware exact scaled dot-product attention kernel in CUDA",
    );
    index.upsert_document(
        "doc-linear-algebra",
        "Linear Algebra eigenvalues singular value decomposition and matrix calculus",
    );
    assert_eq!(index.document_count(), 3);

    // Query for "BPE subword tokenization merge tables" must rank doc-bpe-monograph first
    let ranked = index.rank_documents("BPE subword tokenization merge tables");
    assert_eq!(ranked[0].0, "doc-bpe-monograph");
    assert!(ranked[0].1 > 0.0);
    assert!(ranked[0].1 > ranked[1].1);

    // Incremental upsert of a newly discovered resource updates corpus rankings on the fly
    index.upsert_document(
        "doc-discovered-rope",
        "Rotary Position Embeddings RoPE complex plane rotation for transformer attention",
    );
    assert_eq!(index.document_count(), 4);
    let rope_ranked = index.rank_documents("rotary position embeddings RoPE");
    assert_eq!(rope_ranked[0].0, "doc-discovered-rope");
    assert!(rope_ranked[0].1 > 0.0);
    assert!(rope_ranked[0].1 > rope_ranked[1].1);
}
