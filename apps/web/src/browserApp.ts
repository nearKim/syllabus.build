/**
 * Interactive Browser Web Application Renderer & Client DOM Controller (`apps/web/src/browserApp.ts`).
 *
 * Implements the complete Section 9.3 navigation shell and interactive views by reusing the
 * verified domain controllers from `@curriculum/ui` and `@curriculum/web`:
 * - `Learn`:
 *   1. `Today`: Daily session cards (`createTodayViewController`), idempotent `Mark self-reported completed`
 *      button (`data-action="complete-activity"`), spaced-review session separation badge, honest two-layer
 *      status summary, and accessible MathML formulas (`renderAccessibleMathFormula`) on opaque surfaces.
 *   2. `Plan`: Synchronized **Map** (interactive SVG DAG from `buildPlanMapAndOutlineModel` with clickable
 *      `<g class="map-node" tabindex="0">`, directed prerequisite `<path>` edges, keyboard arrow navigation,
 *      and non-dragging `Zoom In` / `Zoom Out` / `Reset View` / `Focus Neighborhood` buttons) and **Outline**
 *      (ordered module cards, duration triplets, resource provenance links, prerequisite bridge warnings,
 *      and `Activate Revision` button with `If-Match`).
 *   3. `Progress`: Objective proficiency table (`unassessed`, `self_reported`, `in_progress`, `needs_review`,
 *      `demonstrated`), `Topic Diagnostic` panel (`createDiagnosticFlowController`), and `Adaptation Diff Preview`
 *      `<dialog closedby="any">` (`createAdaptationDiffController`).
 *   4. `Resources`: Reviewed catalog resource cards with publisher provenance, rights badges
 *      (`link_and_metadata_only`), and separate optional certification cost badge.
 * - `Explore`: Public curriculum templates discovery, Partial Adoption modal (`<dialog closedby="any">`),
 *   revision upvote button, and Publication Preview modal (`<dialog closedby="any">`).
 * - `Settings`: Theme selector (`light`/`dark`/`system`), BYOK encrypted credential custody panel
 *   (`OpenAI`, `Anthropic`, `Google Gemini`), Hosted Inference Wallet & 4-Bucket Cost Breakdown
 *   (`createHostedBillingController`, `buildFourBucketCostBreakdown`), Study Reminders
 *   (`createReminderPreferenceController`), and Account Export / Destructive Deletion `<dialog closedby="any">`
 *   (`createAccountPrivacyController`).
 */

import {
  buildPlanMapAndOutlineModel,
  OBJECTIVE_PROFICIENCY_BADGE_STATUSES,
  renderAccessibleMathFormula,
  resolveSurfaceStyle,
  resolveThemeMode,
  resolveThemePalette,
  type ActivityExecutionStatus,
  type CatalogResourceMetadataInput,
  type MapKeyboardKey,
  type PlanMapAndOutlineModel,
  type ThemePreference,
} from "../../../packages/ui/src/index.ts";
import {
  createNavigationShellController,
  LEARN_SUB_DESTINATIONS,
  PLAN_SYNCHRONIZED_VIEWS,
  resolveResponsiveLayout,
  TOP_LEVEL_DESTINATIONS,
  type LearnSubDestination,
  type MapNonDraggingControl,
  type PlanSynchronizedView,
  type TopLevelDestination,
} from "./index.ts";
import {
  buildRevisionActivationRequest,
  createTodayViewController,
  type ProgressEventInput,
  type RecordedProgressEventReceipt,
} from "./tracerBulletViews.ts";
import {
  createAdaptationDiffController,
  createDiagnosticFlowController,
  type AdaptationProposalFixture,
  type DiagnosticSessionFixture,
  type ProficiencyProfileFixture,
} from "./diagnosticsAndAdaptation.ts";
import {
  createByokCustodyController,
  createReminderPreferenceController,
  type InferenceMode,
  type MaskedCredentialRecord,
} from "./byokAndReminders.ts";
import {
  buildFourBucketCostBreakdown,
  createHostedBillingController,
  createPublicAdoptionController,
  createPublicationLifecycleController,
  formatMinorCurrency,
  type HostedCreditWalletSnapshot,
  type OwnedPublicationItem,
  type PublicCurriculumPayload,
  type PublicationPreviewPayload,
} from "./billingAndSharing.ts";
import { createAccountPrivacyController } from "./releaseAndA11yViews.ts";

export interface CurriculumWebAppStateInput {
  readonly topLevel?: TopLevelDestination;
  readonly learnSubDestination?: LearnSubDestination;
  readonly planView?: PlanSynchronizedView;
  readonly selectedModuleId?: string | null;
  readonly selectedActivityId?: string | null;
  readonly focusedNodeId?: string | null;
  readonly zoom?: number;
  readonly viewportWidthPx?: number;
  readonly textScalePercent?: number;
  readonly themePreference?: ThemePreference;
  readonly solidSurfaces?: boolean;
  readonly reduceMotion?: boolean;
  readonly activityStates?: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly recordedProgressEvents?: readonly ProgressEventInput[];
  readonly curriculum?: Record<string, unknown>;
  readonly schedule?: Record<string, unknown>;
  readonly proficiency?: ProficiencyProfileFixture;
  readonly catalogResources?: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly diagnosticSession?: DiagnosticSessionFixture;
  readonly adaptationProposal?: AdaptationProposalFixture;
  readonly byokMode?: InferenceMode;
  readonly byokCredentials?: readonly MaskedCredentialRecord[];
  readonly wallet?: HostedCreditWalletSnapshot;
  readonly adoptedSelectedModuleIds?: readonly string[];
  readonly upvotedRevisionIds?: readonly string[];
  readonly openDialogId?: string | null;
}

export interface CurriculumWebAppResolvedState {
  readonly topLevel: TopLevelDestination;
  readonly learnSubDestination: LearnSubDestination;
  readonly planView: PlanSynchronizedView;
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
  readonly focusedNodeId: string | null;
  readonly zoom: number;
  readonly viewportWidthPx: number;
  readonly textScalePercent: number;
  readonly themePreference: ThemePreference;
  readonly solidSurfaces: boolean;
  readonly reduceMotion: boolean;
  readonly activityStates: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly recordedProgressEvents: readonly ProgressEventInput[];
  readonly recordedReceipts: readonly RecordedProgressEventReceipt[];
  readonly totalStudyMinutes: number;
  readonly selfReportedCompletedCount: number;
  readonly adoptedSelectedModuleIds: readonly string[];
  readonly upvotedRevisionIds: readonly string[];
  readonly openDialogId: string | null;
}

const DEFAULT_SYNTHETIC_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0",
  curriculum_id: "curriculum-attention-synthetic",
  revision_id: "revision-attention-v2",
  revision_number: 2,
  predecessor_revision_id: "revision-attention-v1",
  account_id: "learner-default",
  created_at: "2026-10-20T16:00:00Z",
  revision_reason: "initial_generation",
  goal: {
    title: "Transformer Tokenization & Scaled Dot-Product Attention",
    summary:
      "Master subword tokenization tradeoffs and derive scaled dot-product attention with verified resources.",
    included_topics: ["tokenization tradeoffs", "scaled dot-product attention", "matrix calculus"],
    excluded_topics: ["distributed cluster orchestration"],
    scope_note:
      "Formal math depth preserved; self-reported activity completion never substitutes for demonstrated proficiency.",
  },
  language: "en",
  sequence_preference_applied: "theory_first",
  objectives: [
    {
      objective_id: "objective-tokenization",
      objective_version_id: "objective-tokenization-v1",
      topic_id: "topic-tokenization",
      title: "Analyze BPE and Unigram tokenization sequence lengths",
      description:
        "Explain how vocabulary size and subword segmentation alter sequence length and embedding lookup cost.",
      success_criterion:
        "Accurately compare token counts and out-of-vocabulary behavior across two unseen text samples.",
      level: "introductory",
      requirement_level: "required",
      assessment_activity_ids: ["activity-quiz"],
      prior_evidence_refs: ["anchor-attempt-001"],
    },
    {
      objective_id: "objective-attention",
      objective_version_id: "objective-attention-v1",
      topic_id: "topic-matrix-calculus",
      title: "Derive scaled dot-product attention gradients and variance scaling",
      description:
        "Explain why dot products grow with dimension d_k and how 1/sqrt(d_k) prevents softmax saturation.",
      success_criterion:
        "Compute forward attention weights and Jacobian structure for an unseen query-key-value example.",
      level: "applied",
      requirement_level: "required",
      assessment_activity_ids: ["activity-quiz", "activity-review"],
      prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [
    {
      from_objective_id: "objective-tokenization",
      to_objective_id: "objective-attention",
    },
  ],
  modules: [
    {
      module_id: "module-foundations",
      title: "Module 1: Tokenization & Sequence Foundations",
      summary: "Subword vocabulary construction, byte-level fallback, and sequence packing.",
      requirement_level: "required",
      prerequisite_module_ids: [],
      objective_ids: ["objective-tokenization"],
      activity_ids: ["activity-theory", "activity-example", "activity-coding"],
    },
    {
      module_id: "module-attention",
      title: "Module 2: Scaled Dot-Product Attention & Diagnostics",
      summary: "Matrix shape contracts, variance scaling by 1/sqrt(d_k), and spaced review.",
      requirement_level: "required",
      prerequisite_module_ids: ["module-foundations"],
      objective_ids: ["objective-attention"],
      activity_ids: ["activity-quiz", "activity-review", "activity-reflection"],
    },
  ],
  activities: [
    {
      activity_id: "activity-theory",
      type: "theory",
      title: "Read Subword Tokenization & Sequence Packing Notes",
      requirement_level: "required",
      objective_ids: ["objective-tokenization"],
      prerequisite_activity_ids: [],
      resource_assignments: [
        {
          resource_version_id: "synthetic-resource-tokenization-v1",
          role: "primary",
          segment_ids: ["seg-bpe-overview"],
          selection_rationale:
            "Reviewed open reference covering BPE merge tables and sequence compression.",
        },
      ],
      duration_estimate: {
        media_minutes: 0,
        reading_minutes: 15,
        practice_minutes: 0,
        assessment_minutes: 0,
        review_minutes: 0,
        lower_bounds: {
          media_minutes: 0,
          reading_minutes: 10,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        upper_bounds: {
          media_minutes: 0,
          reading_minutes: 22,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        study_prompt:
          "Compare byte-pair encoding merge rules against unigram language model likelihood pruning.",
      },
    },
    {
      activity_id: "activity-example",
      type: "worked_example",
      title: "Worked Example: Attention Scaling Factor 1/sqrt(d_k)",
      requirement_level: "required",
      objective_ids: ["objective-tokenization", "objective-attention"],
      prerequisite_activity_ids: ["activity-theory"],
      resource_assignments: [
        {
          resource_version_id: "synthetic-resource-tokenization-v1",
          role: "primary",
          segment_ids: ["seg-bpe-overview"],
          selection_rationale: "Demonstrates variance growth of unscaled dot products.",
        },
      ],
      duration_estimate: {
        media_minutes: 12,
        reading_minutes: 8,
        practice_minutes: 5,
        assessment_minutes: 0,
        review_minutes: 0,
        lower_bounds: {
          media_minutes: 10,
          reading_minutes: 6,
          practice_minutes: 4,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        upper_bounds: {
          media_minutes: 15,
          reading_minutes: 12,
          practice_minutes: 8,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        example_prompt:
          "Inspect how scaling QK^T by 1/sqrt(d_k) keeps variance at 1 and prevents vanishing softmax gradients.",
      },
    },
    {
      activity_id: "activity-coding",
      type: "coding",
      title: "Implement Reversible Tokenizer & Shape Validator",
      requirement_level: "required",
      objective_ids: ["objective-tokenization"],
      prerequisite_activity_ids: ["activity-example"],
      resource_assignments: [
        {
          resource_version_id: "synthetic-resource-cert-prep-v1",
          role: "supplemental",
          segment_ids: [],
          selection_rationale: "External repository lab with optional certification exam track.",
        },
      ],
      duration_estimate: {
        media_minutes: 0,
        reading_minutes: 5,
        practice_minutes: 20,
        assessment_minutes: 0,
        review_minutes: 0,
        lower_bounds: {
          media_minutes: 0,
          reading_minutes: 4,
          practice_minutes: 15,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        upper_bounds: {
          media_minutes: 0,
          reading_minutes: 8,
          practice_minutes: 30,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        coding_prompt:
          "Run the external test suite to verify lossless UTF-8 round-trip encoding.",
      },
    },
    {
      activity_id: "activity-quiz",
      type: "quiz",
      title: "Formative Checkpoint: Tokenization & Attention Shapes",
      requirement_level: "required",
      mastery_gated: true,
      objective_ids: ["objective-attention"],
      prerequisite_activity_ids: ["activity-coding"],
      resource_assignments: [
        {
          resource_version_id: "synthetic-resource-tokenization-v1",
          role: "primary",
          segment_ids: [],
          selection_rationale: "Formative verification anchored to reviewed rubric.",
        },
      ],
      duration_estimate: {
        media_minutes: 0,
        reading_minutes: 0,
        practice_minutes: 0,
        assessment_minutes: 10,
        review_minutes: 0,
        lower_bounds: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 8,
          review_minutes: 0,
        },
        upper_bounds: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 15,
          review_minutes: 0,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        assessment_prompt:
          "Verify tensor dimensions for multi-head attention projections before unlocking downstream synthesis.",
      },
    },
    {
      activity_id: "activity-review",
      type: "review",
      title: "Spaced Retrieval: Softmax Jacobian & Masking",
      requirement_level: "required",
      objective_ids: ["objective-attention"],
      prerequisite_activity_ids: ["activity-quiz"],
      resource_assignments: [],
      duration_estimate: {
        media_minutes: 0,
        reading_minutes: 0,
        practice_minutes: 0,
        assessment_minutes: 0,
        review_minutes: 8,
        lower_bounds: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 5,
        },
        upper_bounds: {
          media_minutes: 0,
          reading_minutes: 0,
          practice_minutes: 0,
          assessment_minutes: 0,
          review_minutes: 12,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        review_prompt:
          "Scheduled in a later session separate from initial quiz (@S19) to test durable retention.",
      },
    },
    {
      activity_id: "activity-reflection",
      type: "reflection",
      title: "Optional Enrichment: FlashAttention IO-Complexity Notes",
      requirement_level: "optional",
      objective_ids: ["objective-attention"],
      prerequisite_activity_ids: ["activity-quiz"],
      resource_assignments: [
        {
          resource_version_id: "synthetic-resource-cert-prep-v1",
          role: "supplemental",
          segment_ids: [],
          selection_rationale: "Optional hardware-aware enrichment reading.",
        },
      ],
      duration_estimate: {
        media_minutes: 0,
        reading_minutes: 10,
        practice_minutes: 5,
        assessment_minutes: 0,
        review_minutes: 0,
        lower_bounds: {
          media_minutes: 0,
          reading_minutes: 8,
          practice_minutes: 4,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        upper_bounds: {
          media_minutes: 0,
          reading_minutes: 14,
          practice_minutes: 8,
          assessment_minutes: 0,
          review_minutes: 0,
        },
        range_interpretation: "planning_bounds_not_confidence_interval",
      },
      content: {
        reflection_prompt:
          "Summarize SRAM tiling tradeoffs without conflating optional enrichment with required mastery.",
      },
    },
  ],
  certification_options: [
    {
      resource_version_id: "synthetic-resource-cert-prep-v1",
      mapped_objective_ids: ["objective-tokenization"],
      rationale:
        "Optional external certification track; separate from core learning completion and never implies platform accreditation.",
    },
  ],
};

const DEFAULT_SYNTHETIC_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-attention-1",
  schedule_revision_id: "schedule-revision-attention-1",
  version: 1,
  curriculum_revision_id: "revision-attention-v2",
  timezone: "America/New_York",
  weekly_minutes: 120,
  sessions: [
    {
      session_id: "session-today-1",
      start_at: "2026-10-26T18:00:00-04:00",
      duration_minutes: 65,
      activity_ids: ["activity-theory", "activity-example", "activity-coding"],
      reminder_enabled: true,
    },
    {
      session_id: "session-quiz-2",
      start_at: "2026-10-28T18:00:00-04:00",
      duration_minutes: 10,
      activity_ids: ["activity-quiz"],
      reminder_enabled: true,
    },
    {
      session_id: "session-spaced-review-3",
      start_at: "2026-10-30T18:00:00-04:00",
      duration_minutes: 23,
      activity_ids: ["activity-review", "activity-reflection"],
      reminder_enabled: false,
    },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

const DEFAULT_SYNTHETIC_PROFICIENCY: ProficiencyProfileFixture = {
  profile_revision_id: "proficiency-snapshot-001",
  account_id: "learner-default",
  computed_at: "2026-10-20T16:00:00Z",
  objective_evidence: [
    {
      objective_id: "objective-tokenization",
      objective_version_id: "objective-tokenization-v1",
      topic_id: "topic-tokenization",
      state: "demonstrated",
      status: "demonstrated",
      evidence_support: "corroborated",
      qualifying_attempt_ids: ["anchor-attempt-001"],
      evidence_refs: ["anchor-attempt-001"],
      UnverifiedReason: null,
    },
    {
      objective_id: "objective-attention",
      objective_version_id: "objective-attention-v1",
      topic_id: "topic-matrix-calculus",
      state: "unknown",
      status: "unknown",
      evidence_support: "none",
      qualifying_attempt_ids: [],
      evidence_refs: [],
      UnverifiedReason: "unassessed_in_diagnostic",
    },
  ],
  topic_coverage: [
    {
      topic_id: "topic-tokenization",
      assessed_objective_version_ids: ["objective-tokenization-v1"],
      unassessed_objective_version_ids: [],
      coverage_state: "demonstrated",
      coverage_label: "demonstrated",
      demonstrated_objective_count: 1,
      total_objective_count: 1,
    },
    {
      topic_id: "topic-matrix-calculus",
      assessed_objective_version_ids: [],
      unassessed_objective_version_ids: ["objective-attention-v1"],
      coverage_state: "unassessed",
      coverage_label: "unassessed",
      demonstrated_objective_count: 0,
      total_objective_count: 1,
    },
  ],
};

const DEFAULT_CATALOG_RESOURCES: Readonly<Record<string, CatalogResourceMetadataInput>> = {
  "synthetic-resource-tokenization-v1": {
    resource_version_id: "synthetic-resource-tokenization-v1",
    title: "Reviewed Open Monograph: Subword Tokenization & Sequence Packing",
    canonical_url: "https://example.invalid/catalog/tokenization-monograph",
    captured_at: "2026-10-20T16:00:00Z",
    provider: {
      provider_id: "open-ml-press",
      display_name: "Open ML Press (Curator Verified)",
    },
    access: {
      model: "free",
      certificate_included: false,
      access_verified_at: "2026-10-20T16:00:00Z",
    },
    ingestion_permissions: {
      basis: "link_and_metadata_only",
      permissions: {
        display_excerpts: "denied",
      },
    },
    segments: [
      {
        segment_id: "seg-bpe-overview",
        title: "Section 2.1: Byte-Pair Encoding Merge Tables",
        verified: true,
      },
    ],
  },
  "synthetic-resource-cert-prep-v1": {
    resource_version_id: "synthetic-resource-cert-prep-v1",
    title: "Applied Sequence Modeling Lab & Optional Certification Track",
    canonical_url: "https://example.invalid/catalog/sequence-lab-cert",
    captured_at: "2026-10-20T16:00:00Z",
    provider: {
      provider_id: "systems-ai-institute",
      display_name: "Systems AI Institute",
    },
    access: {
      model: "freemium_optional_certificate",
      certificate_included: true,
      access_verified_at: "2026-10-20T16:00:00Z",
    },
    ingestion_permissions: {
      basis: "link_and_metadata_only",
      permissions: {
        display_excerpts: "denied",
      },
    },
    segments: [],
  },
};

const DEFAULT_DIAGNOSTIC_SESSION: DiagnosticSessionFixture = {
  diagnostic_session_id: "diagnostic-synthetic-001",
  curriculum_id: "curriculum-attention-synthetic",
  curriculum_revision_id: "revision-attention-v2",
  state: "active",
  target_objective_version_ids: [
    "objective-tokenization-v1",
    "objective-attention-v1",
  ],
  assessed_objective_version_ids: ["objective-tokenization-v1"],
  unassessed_objective_version_ids: ["objective-attention-v1"],
  proficiency_snapshot_ref: "proficiency-snapshot-001",
  stop_reason: null,
};

const DEFAULT_ADAPTATION_PROPOSAL: AdaptationProposalFixture = {
  proposal_id: "adaptation-synthetic-001",
  curriculum_id: "curriculum-attention-synthetic",
  base_revision_id: "revision-attention-v2",
  candidate_revision_id: "revision-attention-v3-candidate",
  base_schedule_revision_id: "schedule-revision-attention-1",
  proficiency_snapshot_ref: "proficiency-snapshot-001",
  proposal_sha256: "938896be1292fd64cd5bf7f71c45068b10758ef3d3253833bd17b79a4e0d6dae",
  status: "pending",
  instruction_preferences_applied: {
    math_depth: "formal",
  },
  changes: [
    {
      kind: "waive_instruction",
      node_id: "activity-theory",
      activity_ids: ["activity-theory"],
      objective_version_ids: ["objective-tokenization-v1"],
      qualifying_evidence_refs: ["anchor-attempt-001"],
      rationale:
        "Reviewed diagnostic anchor attempt-001 corroborated tokenization proficiency; waive introductory reading while retaining formal math depth.",
    },
    {
      kind: "add_bridge",
      node_id: "activity-matrix-calculus-bridge",
      activity_ids: ["activity-matrix-calculus-bridge"],
      objective_version_ids: ["objective-attention-v1"],
      qualifying_evidence_refs: [],
      rationale:
        "Objective objective-attention-v1 remains unassessed; insert targeted Jacobian bridge before mastery-gated quiz.",
    },
  ],
  proposed_waivers: [
    {
      waiver_id: "waiver-tokenization-001",
      objective_id: "objective-tokenization",
      objective_version_id: "objective-tokenization-v1",
      node_id: "activity-theory",
      criterion_policy_id: "criterion-tokenization-v1",
      qualifying_evidence_refs: ["anchor-attempt-001"],
      rationale: "Demonstrated via reviewed anchor evidence (anchor-attempt-001).",
    },
  ],
  impact: {
    before_minutes: 98,
    after_minutes: 105,
    constraint_status: "feasible",
    schedule_impact_summary: "+7 minutes net across 3 weekly sessions (within 120m weekly cap).",
    inference_charge_summary: "Deterministic diff preview ($0.00 AI inference charge).",
    warnings: [
      "Untested objectives remain explicitly unassessed and are bridged rather than waived.",
    ],
  },
  unassessed_objective_version_ids: ["objective-attention-v1"],
};

const DEFAULT_PUBLIC_CURRICULUM: PublicCurriculumPayload = {
  schema_version: "0.2.0",
  publication_id: "publication-synthetic-001",
  publication_revision_id: "public-revision-synthetic-001",
  revision_number: 1,
  supersedes_publication_revision_id: null,
  visibility: "public",
  published_at: "2026-10-20T16:00:00Z",
  content_sha256: "a9427ddd7bc9f2c22c910939c5e890588eda136e359ed463897d71f79ad06fe8",
  upvote_count: 14,
  viewer_has_upvoted: false,
  publisher: {
    public_author_id: "public-author-synthetic-001",
    display_name: "Dr. Elena Vance (Verified Community Author)",
  },
  publication_terms: {
    policy_id: "publication-terms-v1",
    content_license_id: "CC-BY-4.0",
    rights_scope: "structure_and_author_prompts_only",
    attribution: "Dr. Elena Vance — Transformer Foundations Template",
    third_party_materials_excluded: true,
  },
  content: {
    title: "Transformer Foundations & Attention Mechanics (Public Template)",
    summary:
      "Reusable two-module public curriculum template with transitive prerequisite resolution.",
    objectives: [
      {
        objective_id: "objective-tokenization",
        title: "Analyze BPE and Unigram tokenization sequence lengths",
        prerequisite_objective_ids: [],
      },
      {
        objective_id: "objective-attention",
        title: "Derive scaled dot-product attention gradients",
        prerequisite_objective_ids: ["objective-tokenization"],
      },
    ],
    prerequisite_edges: [
      {
        from_objective_id: "objective-tokenization",
        to_objective_id: "objective-attention",
      },
    ],
    modules: [
      {
        module_id: "public-module-tokenization",
        title: "Module 1: Tokenization Foundations",
        summary: "Prerequisite subword representations and sequence packing.",
        objective_ids: ["objective-tokenization"],
        activity_ids: ["public-activity-theory", "public-activity-coding"],
        prerequisite_module_ids: [],
      },
      {
        module_id: "public-module-attention",
        title: "Module 2: Scaled Dot-Product Attention",
        summary: "Depends on Module 1 tokenization representations.",
        objective_ids: ["objective-attention"],
        activity_ids: ["public-activity-attention-quiz"],
        prerequisite_module_ids: ["public-module-tokenization"],
      },
    ],
  },
};

const DEFAULT_PUBLICATION_PREVIEW: PublicationPreviewPayload = {
  preview_id: "preview-synthetic-001",
  source_plan_id: "curriculum-attention-synthetic",
  source_plan_version_id: "revision-attention-v2",
  visibility: "public",
  content_sha256: "a9427ddd7bc9f2c22c910939c5e890588eda136e359ed463897d71f79ad06fe8",
  preview_sha256: "e1b88a7d4a5d6033b819b2e5e2e4c7f1928374655647382910abcdef12345678",
  expires_at: "2026-10-25T17:00:00Z",
  publication_terms_policy_id: "publication-terms-v1",
  excluded_private_fields: [
    "learner_notes",
    "attempt_history",
    "diagnostic_transcripts",
    "byok_credentials",
    "billing_ledger",
  ],
  warnings: [
    "Third-party catalog excerpts are excluded; only resource links, metadata, and your structural plan are shared.",
  ],
  public_content: DEFAULT_PUBLIC_CURRICULUM.content,
  publisher: DEFAULT_PUBLIC_CURRICULUM.publisher,
  publication_terms: DEFAULT_PUBLIC_CURRICULUM.publication_terms,
};

const DEFAULT_OWNED_PUBLICATIONS: readonly OwnedPublicationItem[] = [
  {
    publication_id: "publication-synthetic-001",
    source_plan_id: "curriculum-attention-synthetic",
    visibility: "public",
    state: "active",
    display_title: "Transformer Foundations & Attention Mechanics (Public Template)",
    published_revision_id: "public-revision-synthetic-001",
    current_revision_upvote_count: 14,
    created_at: "2026-10-20T12:00:00Z",
    updated_at: "2026-10-20T12:00:00Z",
    management_version_id: '"management-etag-001"',
  },
];

const DEFAULT_BYOK_CREDENTIALS: readonly MaskedCredentialRecord[] = [
  {
    credential_ref: "cred-openai-1",
    provider_id: "openai",
    label: "OpenAI Research Key",
    status: "active",
    credential_version_ref: "cred-openai-1-v1",
    masked_hint: "••••9a4F",
    masked_suffix: "9a4F",
    version: 1,
    etag: '"credential-cred-openai-1-v1"',
    updated_at: "2026-10-20T14:00:00Z",
  },
  {
    credential_ref: "cred-anthropic-1",
    provider_id: "anthropic",
    label: "Anthropic Claude Key",
    status: "active",
    credential_version_ref: "cred-anthropic-1-v1",
    masked_hint: "••••7c2B",
    masked_suffix: "7c2B",
    version: 1,
    etag: '"credential-cred-anthropic-1-v1"',
    updated_at: "2026-10-20T14:10:00Z",
  },
  {
    credential_ref: "cred-gemini-1",
    provider_id: "google_gemini",
    label: "Google Gemini Key",
    status: "active",
    credential_version_ref: "cred-gemini-1-v1",
    masked_hint: "••••3e8D",
    masked_suffix: "3e8D",
    version: 1,
    etag: '"credential-cred-gemini-1-v1"',
    updated_at: "2026-10-20T14:20:00Z",
  },
];

const DEFAULT_WALLET: HostedCreditWalletSnapshot = {
  currency: "USD",
  available_minor: 2450,
  reserved_minor: 350,
  live_billing_enabled: true,
  updated_at: "2026-10-20T16:00:00Z",
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns the mandatory `<dialog closedby="any">` fallback script (`light-dismiss-a-dialog`)
 * for browsers without `HTMLDialogElement.prototype.closedBy` support.
 *
 * Notice:
 * 1. Checks `if (!('closedBy' in HTMLDialogElement.prototype))`
 * 2. Verifies `event.target === dialog` (ignores child clicks inside the dialog)
 * 3. Compares `event.clientX` and `event.clientY` against `dialog.getBoundingClientRect()`
 * 4. Calls `dialog.close()` when clicked on the backdrop outside the content box.
 * 5. Never applies `overflow: hidden` or `position: fixed` to `<html>` or `<body>`.
 */
export function getDialogLightDismissFallbackScript(): string {
  return `
(function attachDialogLightDismissFallback(root) {
  const scope = root || document;
  const dialogs = scope.querySelectorAll('dialog[closedby="any"]');
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialogs.forEach((dialog) => {
      if (dialog.dataset.lightDismissBound === 'true') return;
      dialog.dataset.lightDismissBound = 'true';
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        dialog.close();
      });
    });
  }
})();
`.trim();
}

function renderPlanDagSvgHtml(planModel: PlanMapAndOutlineModel): string {
  const { svgViewport, moduleMapNodes, objectiveMapNodes, mapEdges } = planModel;
  const allNodes = [...moduleMapNodes, ...objectiveMapNodes];

  const edgesHtml = mapEdges
    .map((edge) => {
      const { fromX, fromY, toX, toY } = edge.points;
      const midX = Math.round((fromX + toX) / 2);
      const pathD = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
      const dashAttr = edge.satisfied ? "" : ' stroke-dasharray="6 4"';
      return `<path class="map-edge" data-edge-id="${escapeHtml(edge.edgeId)}" data-from="${escapeHtml(edge.fromNodeId)}" data-to="${escapeHtml(edge.toNodeId)}" data-satisfied="${edge.satisfied}" d="${pathD}" fill="none" stroke="var(--color-border-control)" stroke-width="2"${dashAttr} marker-end="url(#dag-arrow)" aria-label="${escapeHtml(edge.textMeaning)}" />`;
    })
    .join("\n            ");

  const nodesHtml = allNodes
    .map((node) => {
      const isSelected =
        node.selected ||
        node.nodeId === planModel.selectedModuleId ||
        node.nodeId === planModel.focusedNodeId;
      const strokeColor = isSelected
        ? "var(--color-accent)"
        : "var(--color-border-control)";
      const strokeWidth = isSelected ? "3" : "1.5";
      const fillSurface = isSelected
        ? "var(--color-accent-surface)"
        : "var(--color-surface)";
      const moduleIdAttr =
        node.kind === "module" ? node.nodeId : (planModel.selectedModuleId ?? "module-foundations");
      const durationText = node.durationTriplet
        ? `${node.durationTriplet.min}/${node.durationTriplet.point}/${node.durationTriplet.max}m`
        : node.requirementLevel;

      return `<g class="map-node" tabindex="0" role="button" data-action="select-map-node" data-node-id="${escapeHtml(node.nodeId)}" data-node-kind="${escapeHtml(node.kind)}" data-module-id="${escapeHtml(moduleIdAttr)}" data-selected="${isSelected}" data-in-neighborhood="${node.inFocusedNeighborhood}" data-opaque-surface="true" aria-pressed="${isSelected}" aria-label="${escapeHtml(`${node.kind}: ${node.title}. ${node.executionBadge.nonColorCue}. ${node.proficiencyBadge.nonColorCue}`)}" transform="translate(${node.x}, ${node.y})">
              <rect width="${node.width}" height="${node.height}" rx="10" ry="10" fill="${fillSurface}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
              <text x="14" y="26" fill="var(--color-text-primary)" font-size="13" font-weight="600">${escapeHtml(node.title.slice(0, 34))}</text>
              <text x="14" y="48" fill="var(--color-text-secondary)" font-size="11">${escapeHtml(node.executionBadge.nonColorCue.slice(0, 38))}</text>
              <text x="14" y="68" fill="var(--color-text-secondary)" font-size="11">${escapeHtml(node.proficiencyBadge.nonColorCue.slice(0, 38))}</text>
              <text x="14" y="88" fill="var(--color-accent)" font-size="11" font-weight="600">${escapeHtml(durationText)}</text>
            </g>`;
    })
    .join("\n            ");

  return `<svg class="plan-dag-svg" role="group" aria-label="Curriculum prerequisite DAG map" viewBox="${escapeHtml(svgViewport.viewBox)}" width="100%" height="360" data-zoom="${svgViewport.zoom}" data-focused-node="${escapeHtml(svgViewport.focusedNodeId ?? "")}" data-opaque-surface="true">
          <defs>
            <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-border-control)" />
            </marker>
          </defs>
          <g class="map-edges-layer">
            ${edgesHtml}
          </g>
          <g class="map-nodes-layer">
            ${nodesHtml}
          </g>
        </svg>`;
}

/**
 * Renders the complete Section 9.3 Interactive Web Application HTML (`renderCurriculumWebAppHtml`).
 * Reuses the existing controllers from `@curriculum/ui` and `@curriculum/web` without duplicating
 * domain logic.
 */
export function renderCurriculumWebAppHtml(
  inputState: CurriculumWebAppStateInput = {}
): string {
  const curriculum = inputState.curriculum ?? DEFAULT_SYNTHETIC_CURRICULUM;
  const schedule = inputState.schedule ?? DEFAULT_SYNTHETIC_SCHEDULE;
  const proficiency = inputState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const catalogResources = inputState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;

  const viewportWidthPx = inputState.viewportWidthPx ?? 1280;
  const textScalePercent = inputState.textScalePercent ?? 100;
  const themePreference: ThemePreference = inputState.themePreference ?? "light";
  const solidSurfaces = inputState.solidSurfaces ?? false;
  const reduceMotion = inputState.reduceMotion ?? false;

  const resolvedThemeMode = resolveThemeMode(
    themePreference,
    themePreference === "dark" ? "dark" : "light"
  );
  const palette = resolveThemePalette(themePreference, resolvedThemeMode);
  const layout = resolveResponsiveLayout(viewportWidthPx, textScalePercent);
  const studySurface = resolveSurfaceStyle(
    "reading",
    { themePreference, solidSurfaces, reduceMotion },
    { prefersReducedTransparency: solidSurfaces, prefersReducedMotion: reduceMotion }
  );

  // 1. Today View Controller (reused from tracerBulletViews.ts)
  const todayController = createTodayViewController({
    curriculum,
    schedule,
    proficiency,
    catalogResources,
    ...(inputState.activityStates ? { initialActivityStates: inputState.activityStates } : {}),
  });

  if (inputState.recordedProgressEvents) {
    for (const ev of inputState.recordedProgressEvents) {
      todayController.recordProgressEvent(ev);
    }
  }
  const todayState = todayController.getState();

  // 2. Plan Map & Outline Model (reused from @curriculum/ui)
  const basePlanModel = buildPlanMapAndOutlineModel({
    curriculum,
    proficiency,
    activityStates: todayState.activityExecutionStates,
    catalogResources,
    viewportWidthPx,
    selectedModuleId: inputState.selectedModuleId ?? "module-foundations",
    selectedActivityId: inputState.selectedActivityId ?? "activity-theory",
    focusedNodeId:
      inputState.focusedNodeId ?? inputState.selectedModuleId ?? "module-foundations",
    zoom: inputState.zoom ?? 1,
  });

  // 3. Navigation Shell Controller (reused from apps/web/src/index.ts)
  const navShell = createNavigationShellController({
    initialViewportWidthPx: viewportWidthPx,
    initialTextScalePercent: textScalePercent,
    initialAppearance: {
      themePreference,
      solidSurfaces,
      reduceMotion,
    },
    planModules: basePlanModel.outlineModules.map((m) => ({
      moduleId: m.moduleId,
      title: m.title,
      required: m.required,
      prerequisiteModuleIds: m.prerequisiteModuleIds,
      activityIds: m.activityIds,
    })),
  });

  const activeTopLevel: TopLevelDestination = inputState.topLevel ?? "Learn";
  const activeLearnSub: LearnSubDestination = inputState.learnSubDestination ?? "Today";
  const activePlanView: PlanSynchronizedView = inputState.planView ?? "Map";

  navShell.navigateDeepLink({
    topLevel: activeTopLevel,
    learnSubDestination: activeLearnSub,
    planView: activePlanView,
    selectedModuleId: basePlanModel.selectedModuleId,
    selectedActivityId: basePlanModel.selectedActivityId,
  });

  // 4. Revision Activation Request descriptor (reused from tracerBulletViews.ts)
  const revisionActivationReq = buildRevisionActivationRequest({
    curriculumId: basePlanModel.curriculumId,
    revisionId: basePlanModel.revisionId,
    ifMatch: `"${basePlanModel.revisionId}-etag"`,
    confirmedByLearner: true,
    acknowledgeScheduleChanges: true,
  });

  // 5. Diagnostic & Adaptation Controllers (reused from diagnosticsAndAdaptation.ts)
  const diagnosticController = createDiagnosticFlowController(
    inputState.diagnosticSession ?? DEFAULT_DIAGNOSTIC_SESSION,
    proficiency,
    resolvedThemeMode
  );
  const diagnosticState = diagnosticController.getState();

  const adaptationController = createAdaptationDiffController(
    inputState.adaptationProposal ?? DEFAULT_ADAPTATION_PROPOSAL,
    resolvedThemeMode
  );
  const adaptationDiff = adaptationController.getDiffModel();

  // 6. Explore / Public Adoption & Publication Lifecycle Controllers (reused from billingAndSharing.ts)
  const publicAdoptionController = createPublicAdoptionController(DEFAULT_PUBLIC_CURRICULUM);
  const partialAdoptionScope = publicAdoptionController.resolveScope(
    inputState.adoptedSelectedModuleIds ?? ["public-module-attention"]
  );

  const publicationController = createPublicationLifecycleController({
    preview: DEFAULT_PUBLICATION_PREVIEW,
    ownedPublications: DEFAULT_OWNED_PUBLICATIONS,
    theme: resolvedThemeMode,
  });
  const isUpvoted = (inputState.upvotedRevisionIds ?? []).includes(
    DEFAULT_PUBLIC_CURRICULUM.publication_revision_id
  );
  publicationController.registerPublicRevisionVoteState({
    publicationId: DEFAULT_PUBLIC_CURRICULUM.publication_id,
    publicationRevisionId: DEFAULT_PUBLIC_CURRICULUM.publication_revision_id,
    upvoteCount: (DEFAULT_PUBLIC_CURRICULUM.upvote_count ?? 14) + (isUpvoted ? 1 : 0),
    viewerHasUpvoted: isUpvoted,
  });
  const publicationState = publicationController.getState();

  // 7. Settings Controllers: BYOK, Billing, 4-Bucket Cost, Reminders, Account Privacy
  const byokController = createByokCustodyController({
    initialMode: inputState.byokMode ?? "byok",
    initialCredentials: [...(inputState.byokCredentials ?? DEFAULT_BYOK_CREDENTIALS)],
    themeMode: resolvedThemeMode,
  });
  const byokState = byokController.getState();

  const billingController = createHostedBillingController({
    wallet: inputState.wallet ?? DEFAULT_WALLET,
    ledger: [
      {
        entry_id: "ledger-001",
        occurred_at: "2026-10-20T14:00:00Z",
        entry_type: "credit_purchase",
        delta_minor: 2800,
        balance_after_minor: 2800,
        reference_id: "topup-001",
        summary: "Hosted AI credit wallet top-up",
      },
      {
        entry_id: "ledger-002",
        occurred_at: "2026-10-20T15:30:00Z",
        entry_type: "reservation_hold",
        delta_minor: -350,
        balance_after_minor: 2450,
        reference_id: "reservation-001",
        summary: "Active generation ceiling reservation",
      },
    ],
    theme: resolvedThemeMode,
  });
  const billingState = billingController.getState();

  const costBreakdown = buildFourBucketCostBreakdown({
    theme: resolvedThemeMode,
    appServiceAccessMinor: 0,
    inferenceMode: byokState.mode,
    inferenceQuoteMinor: 185,
    materials: [
      {
        resourceId: "synthetic-resource-tokenization-v1",
        title: "Reviewed Open Monograph: Subword Tokenization",
        required: true,
        currency: "USD",
        costMinor: 0,
      },
      {
        resourceId: "external-reference-unknown-price",
        title: "External Advanced Reference (Unverified Merchant Price)",
        required: false,
        currency: "USD",
        costMinor: null,
      },
    ],
    certificationAndComputeMinor: 4900,
    currency: "USD",
  });

  const reminderController = createReminderPreferenceController(
    {
      enabled: true,
      channels: ["email", "web_push"],
      timezone: "America/New_York",
      quiet_hours: {
        start_local_time: "22:00",
        end_local_time: "07:30",
      },
      lead_time_minutes: 15,
      version: 1,
      etag: '"notification-prefs-v1"',
    },
    [
      {
        occurrence_id: "reminder-occ-001",
        session_id: "session-today-1",
        scheduled_for: "2026-10-26T17:45:00-04:00",
        status: "scheduled",
      },
    ],
    resolvedThemeMode
  );
  const reminderState = reminderController.getState();

  const privacyController = createAccountPrivacyController({
    theme: resolvedThemeMode,
    exportJobs: [
      {
        export_job_id: "export-synthetic-001",
        status: "completed",
        requested_at: "2026-10-20T12:00:00Z",
        expires_at: "2026-10-27T12:00:00Z",
        download_url: "https://example.invalid/exports/export-synthetic-001.json",
      },
    ],
  });
  const privacyState = privacyController.getState();

  // 8. Accessible MathML formula on opaque study surface (`renderAccessibleMathFormula`)
  const attentionFormula = renderAccessibleMathFormula(
    "\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
    {
      displayMode: "block",
    }
  );

  // Navigation items HTML
  const topNavHtml = TOP_LEVEL_DESTINATIONS.map((dest) => {
    const isCurrent = dest === activeTopLevel;
    return `<button type="button" class="nav-top-btn${isCurrent ? " is-active" : ""}" data-action="navigate-top" data-destination="${dest}" aria-current="${isCurrent ? "page" : "false"}">${dest}</button>`;
  }).join("\n          ");

  const learnSubNavHtml = LEARN_SUB_DESTINATIONS.map((sub) => {
    const isCurrent = activeTopLevel === "Learn" && sub === activeLearnSub;
    return `<button type="button" class="nav-sub-btn${isCurrent ? " is-active" : ""}" data-action="navigate-learn-sub" data-sub-destination="${sub}" aria-current="${isCurrent ? "page" : "false"}">${sub}</button>`;
  }).join("\n            ");

  // Today session cards HTML
  const todayCardsHtml = todayState.todayCards
    .map((card) => {
      const activitiesHtml = card.activityBreakdown
        .map((act) => {
          const isCompleted =
            act.executionStatus === "self_reported_completed" ||
            act.executionStatus === "completed";
          return `<li class="today-activity-item" data-activity-id="${escapeHtml(act.activityId)}" data-execution-status="${escapeHtml(act.executionStatus)}" data-proficiency-status="${escapeHtml(act.objectiveProficiencyStatus)}" data-opaque-surface="true">
                  <div class="activity-header">
                    <span class="activity-title">${escapeHtml(act.title)}</span>
                    <span class="badge badge-type">${escapeHtml(act.type)}</span>
                    <span class="badge badge-duration">${act.durationTriplet.min}/${act.durationTriplet.point}/${act.durationTriplet.max} min</span>
                  </div>
                  <div class="two-layer-badges">
                    <span class="badge badge-execution" data-layer="activity_execution">Activity execution: ${escapeHtml(act.executionStatus)}</span>
                    <span class="badge badge-proficiency" data-layer="objective_proficiency">Objective proficiency: ${escapeHtml(act.objectiveProficiencyStatus)} (never conflated)</span>
                  </div>
                  <p class="activity-reason">${escapeHtml(act.scheduledReason)}</p>
                  <div class="activity-actions">
                    <button type="button" class="btn-primary" data-action="complete-activity" data-activity-id="${escapeHtml(act.activityId)}" data-event-id="evt-complete-${escapeHtml(act.activityId)}" aria-pressed="${isCompleted}">
                      ${isCompleted ? "Self-reported completed (idempotent)" : "Mark self-reported completed"}
                    </button>
                  </div>
                </li>`;
        })
        .join("\n              ");

      return `<article class="study-card today-session-card" data-session-id="${escapeHtml(card.sessionId)}" data-opaque-surface="true">
            <header class="card-header">
              <div>
                <h3>Session: ${escapeHtml(card.sessionId)}</h3>
                <p class="meta-text">Starts: <time datetime="${escapeHtml(card.startAt)}">${escapeHtml(card.startAt)}</time> · Planned: ${card.durationMinutes} min</p>
              </div>
              <span class="badge badge-review-separation" data-review-separation-valid="${card.reviewSeparation.valid}">
                ${escapeHtml(card.reviewSeparation.separationSummary)}
              </span>
            </header>
            <ul class="today-activity-list">
              ${activitiesHtml}
            </ul>
          </article>`;
    })
    .join("\n          ");

  // Outline modules HTML
  const outlineModulesHtml = basePlanModel.outlineModules
    .map((mod) => {
      const isSelectedMod = mod.moduleId === basePlanModel.selectedModuleId;
      const activitiesHtml = mod.activities
        .map((act) => {
          const isSelectedAct = act.activityId === basePlanModel.selectedActivityId;
          const bridgeHtml = act.prerequisiteBridgeRecommendation?.recommended
            ? `<div class="prerequisite-bridge-warning" role="status" data-mastery-gated="${act.masteryGated}">
                <strong>Prerequisite Bridge Warning:</strong> ${escapeHtml(act.prerequisiteBridgeRecommendation.reason)}
              </div>`
            : "";
          const provenanceHtml = act.resourceProvenanceCards
            .map(
              (card) => `<div class="provenance-chip" data-resource-version-id="${escapeHtml(card.resourceVersionId)}">
                <span>Publisher: <strong>${escapeHtml(card.verifiedPublisher)}</strong></span>
                <span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(card.rightsBadge.label)}</span>
                ${
                  card.optionalCertificationBadge
                    ? `<span class="badge badge-cert-optional">${escapeHtml(card.optionalCertificationBadge.label)}</span>`
                    : ""
                }
                ${
                  card.canonicalUrl
                    ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="resource-link">Open verified resource</a>`
                    : ""
                }
              </div>`
            )
            .join("\n                ");

          return `<li class="outline-activity-card${isSelectedAct ? " is-selected" : ""}" data-action="select-outline-activity" data-activity-id="${escapeHtml(act.activityId)}" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${isSelectedAct}" data-opaque-surface="true">
                <div class="outline-activity-header">
                  <strong>${escapeHtml(act.title)}</strong>
                  <span class="badge badge-triplet" title="ceil_per_activity planning bounds">Duration: ${act.durationTriplet.min}/${act.durationTriplet.point}/${act.durationTriplet.max} min</span>
                </div>
                <div class="two-layer-badges">
                  <span class="badge badge-execution">${escapeHtml(act.executionBadge.nonColorCue)}</span>
                  <span class="badge badge-proficiency">${escapeHtml(act.objectiveProficiencyBadge.nonColorCue)}</span>
                </div>
                ${bridgeHtml}
                <div class="provenance-list">
                  ${provenanceHtml}
                </div>
              </li>`;
        })
        .join("\n              ");

      return `<article class="study-card outline-module-card${isSelectedMod ? " is-selected" : ""}" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${isSelectedMod}" data-opaque-surface="true">
            <header class="card-header">
              <div>
                <h3>${escapeHtml(mod.title)}</h3>
                <p class="meta-text">${escapeHtml(mod.summary)}</p>
              </div>
              <div class="module-meta">
                <span class="badge badge-triplet">Module Triplet: ${mod.durationTriplet.min}/${mod.durationTriplet.point}/${mod.durationTriplet.max} min</span>
                <button type="button" class="btn-secondary" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${isSelectedMod}">
                  ${isSelectedMod ? "Selected Module" : "Select Module"}
                </button>
              </div>
            </header>
            <ul class="outline-activity-list">
              ${activitiesHtml}
            </ul>
          </article>`;
    })
    .join("\n          ");

  // Objective Proficiency Table HTML (shows all 5 canonical statuses + objective tracks)
  const canonicalStatusesLegendHtml = OBJECTIVE_PROFICIENCY_BADGE_STATUSES.map(
    (st) => `<span class="badge badge-proficiency-status" data-proficiency-status="${st}">${st}</span>`
  ).join(" ");

  const proficiencyRowsHtml = basePlanModel.objectiveTracks
    .map(
      (obj) => `<tr data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
              <td><strong>${escapeHtml(obj.title)}</strong><div class="meta-text">${escapeHtml(obj.objectiveVersionId)}</div></td>
              <td><span class="badge badge-proficiency" data-status="${escapeHtml(obj.proficiencyStatus)}">${escapeHtml(obj.proficiencyStatus)} (${escapeHtml(obj.proficiencyBadge.nonColorCue)})</span></td>
              <td><span class="badge badge-execution">${escapeHtml(obj.executionStatus)} (${escapeHtml(obj.executionBadge.nonColorCue)})</span></td>
              <td>${escapeHtml(obj.proficiencyBadge.evidenceSupport)} (${obj.proficiencyBadge.evidenceRefs.length > 0 ? escapeHtml(obj.proficiencyBadge.evidenceRefs.join(", ")) : "none"})</td>
            </tr>`
    )
    .join("\n              ");

  // Catalog Resources Cards HTML
  const resourceCards = basePlanModel.outlineActivities
    .flatMap((a) => a.resourceProvenanceCards)
    .filter(
      (card, index, arr) =>
        arr.findIndex((c) => c.resourceVersionId === card.resourceVersionId) === index
    );

  const resourcesHtml = resourceCards
    .map(
      (card) => `<article class="study-card resource-catalog-card" data-resource-version-id="${escapeHtml(card.resourceVersionId)}" data-opaque-surface="true">
            <header class="card-header">
              <h3>${escapeHtml(card.title)}</h3>
              <span class="badge badge-publisher">Publisher: ${escapeHtml(card.verifiedPublisher)}</span>
            </header>
            <p class="meta-text">Version captured: <time datetime="${escapeHtml(card.versionTimestamp)}">${escapeHtml(card.versionTimestamp)}</time> · Access model: <strong>${escapeHtml(card.accessModel)}</strong></p>
            <p>${escapeHtml(card.selectionRationale)}</p>
            <div class="resource-badges">
              <span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">Rights (${escapeHtml(card.rightsBadge.basis)}): ${escapeHtml(card.rightsBadge.label)}</span>
              ${
                card.optionalCertificationBadge
                  ? `<span class="badge badge-cert-cost" data-optional-certification="true">${escapeHtml(card.optionalCertificationBadge.label)} — Separate optional cost (${formatMinorCurrency(4900, "USD")})</span>`
                  : `<span class="badge badge-cert-none">No paid certification required ($0.00 core access)</span>`
              }
            </div>
            ${
              card.canonicalUrl
                ? `<p><a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary">Open External Source (Does Not Auto-Complete Activity)</a></p>`
                : ""
            }
          </article>`
    )
    .join("\n          ");

  // 4-Bucket Cost Breakdown HTML
  const fourBucketsHtml = Object.values(costBreakdown.buckets)
    .map(
      (bucket) => `<div class="cost-bucket-card" data-bucket-id="${escapeHtml(bucket.bucketId)}" data-opaque-surface="true">
              <h4>${escapeHtml(bucket.label)}</h4>
              <p class="bucket-mechanism">Mechanism: <code>${escapeHtml(bucket.billingMechanism)}</code></p>
              <p class="bucket-summary"><strong>${escapeHtml(bucket.formattedSummary)}</strong></p>
              <ul class="bucket-lines">
                ${bucket.lineItems
                  .map(
                    (li) =>
                      `<li data-line-id="${escapeHtml(li.id)}" data-unknown-price="${li.isUnknownPrice}">${escapeHtml(li.label)}: <strong>${escapeHtml(li.formattedAmount)}</strong></li>`
                  )
                  .join("")}
              </ul>
            </div>`
    )
    .join("\n            ");

  const upvoteInfo = publicationState.revisionVotes[0] ?? {
    publicationId: DEFAULT_PUBLIC_CURRICULUM.publication_id,
    publicationRevisionId: DEFAULT_PUBLIC_CURRICULUM.publication_revision_id,
    upvoteCount: 14,
    viewerHasUpvoted: false,
  };

  const openDialogId = inputState.openDialogId ?? null;

  return `<div class="curriculum-app-shell" data-theme="${resolvedThemeMode}" data-theme-preference="${themePreference}" data-breakpoint="${layout.breakpoint}" data-navigation-chrome="${layout.navigationChrome}" data-current-top-level="${activeTopLevel}" data-current-learn-sub="${activeLearnSub}" data-current-plan-view="${activePlanView}" data-selected-module-id="${escapeHtml(basePlanModel.selectedModuleId ?? "")}" data-selected-activity-id="${escapeHtml(basePlanModel.selectedActivityId ?? "")}" style="--active-canvas: ${palette.colors.canvas}; --active-surface: ${studySurface.backgroundColor};">
  <a class="skip-link" href="#main-workspace">Skip to main study workspace</a>

  <header class="app-header nav-chrome-glass" role="banner">
    <div class="brand-cluster">
      <span class="brand-title">Curriculum.io</span>
      <span class="badge badge-honest-policy">Two-Layer Mastery &amp; Verified Provenance</span>
    </div>
    <nav class="top-level-nav" aria-label="Primary navigation">
      ${topNavHtml}
    </nav>
    <div class="header-status">
      <span class="badge" data-study-minutes="${todayState.totalStudyMinutes}">Study time: ${todayState.totalStudyMinutes} min</span>
      <span class="badge" data-self-reported-count="${todayState.selfReportedCompletedCount}">Self-reported: ${todayState.selfReportedCompletedCount}</span>
    </div>
  </header>

  <div class="app-body-grid">
    <aside class="app-sidebar nav-chrome-glass" aria-label="Section 9.3 Workspace Navigation">
      <div class="sidebar-section">
        <h2 class="sidebar-heading">Learn Destinations</h2>
        <nav class="learn-sub-nav" aria-label="Learn sub-navigation">
          ${learnSubNavHtml}
        </nav>
      </div>
      <div class="sidebar-section">
        <h2 class="sidebar-heading">Active Plan Summary</h2>
        <p class="meta-text">${escapeHtml(basePlanModel.goal.title)}</p>
        <p class="meta-text">Total Duration Triplet: <strong>${basePlanModel.totalDurationTriplet.min}/${basePlanModel.totalDurationTriplet.point}/${basePlanModel.totalDurationTriplet.max} min</strong></p>
      </div>
    </aside>

    <main id="main-workspace" class="app-main-workspace" role="main" tabindex="-1">
      <!-- ==================== LEARN WORKSPACE ==================== -->
      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${activeTopLevel === "Learn"}"${activeTopLevel === "Learn" ? "" : " hidden"}>
        <!-- 1. TODAY VIEW -->
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${activeTopLevel === "Learn" && activeLearnSub === "Today"}"${activeTopLevel === "Learn" && activeLearnSub === "Today" ? "" : " hidden"}>
          <div class="section-header">
            <h2>Today's Study Queue</h2>
            <div class="status-banner" role="${todayState.asyncRecoveryBanner.role}">
              <strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)}
            </div>
          </div>

          <div class="study-card honest-two-layer-summary" data-opaque-surface="true">
            <h3>Honest Two-Layer Status Summary (@S17, @S23)</h3>
            <p>Self-reporting an activity as completed records study effort idempotently (<code>self_reported_completed</code>) but <strong>never</strong> upgrades objective proficiency to <code>demonstrated</code> without reviewed assessment evidence.</p>
            <div class="math-formula-surface" data-opaque-surface="true" role="${attentionFormula.role}" aria-label="${escapeHtml(attentionFormula.ariaLabel)}">
              <div class="math-caption">Key Derivation Target (Scaled Dot-Product Attention):</div>
              ${attentionFormula.mathml}
            </div>
          </div>

          <div class="today-sessions-grid">
            ${todayCardsHtml}
          </div>
        </section>

        <!-- 2. PLAN VIEW (Synchronized Map + Outline) -->
        <section class="learn-sub-panel" id="panel-learn-plan" data-learn-panel="Plan" data-active="${activeTopLevel === "Learn" && activeLearnSub === "Plan"}"${activeTopLevel === "Learn" && activeLearnSub === "Plan" ? "" : " hidden"}>
          <div class="section-header">
            <div>
              <h2>Synchronized Curriculum Plan (Map &amp; Outline)</h2>
              <p class="meta-text">100% keyboard &amp; action parity (@S75) · Selected Module: <code>${escapeHtml(basePlanModel.selectedModuleId ?? "none")}</code> · Selected Activity: <code>${escapeHtml(basePlanModel.selectedActivityId ?? "none")}</code></p>
            </div>
            <div class="plan-toolbar">
              <div class="plan-view-switcher" role="group" aria-label="Synchronized Plan View Switcher">
                ${PLAN_SYNCHRONIZED_VIEWS.map((view) => {
                  const isActiveView = view === activePlanView;
                  return `<button type="button" class="btn-secondary${isActiveView ? " is-active" : ""}" data-action="switch-plan-view" data-plan-view="${view}" aria-pressed="${isActiveView}">${view}</button>`;
                }).join("\n                ")}
              </div>
              <button type="button" class="btn-primary" data-action="activate-revision" data-curriculum-id="${escapeHtml(revisionActivationReq.curriculumId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">
                Activate Revision (${escapeHtml(revisionActivationReq.revisionId)})
              </button>
            </div>
          </div>

          <!-- Synchronized Map Surface -->
          <div class="study-card plan-map-container" data-plan-surface="Map" data-active="${activePlanView === "Map"}" data-opaque-surface="true">
            <div class="map-controls-bar" role="toolbar" aria-label="Non-dragging Map Viewport Controls">
              <button type="button" class="btn-secondary" data-action="map-control" data-map-control="zoom_in">Zoom In</button>
              <button type="button" class="btn-secondary" data-action="map-control" data-map-control="zoom_out">Zoom Out</button>
              <button type="button" class="btn-secondary" data-action="map-control" data-map-control="fit_view">Reset View</button>
              <button type="button" class="btn-secondary" data-action="map-control" data-map-control="reset_focus">Focus Neighborhood</button>
              <span class="meta-text">Use Arrow keys (ArrowRight/ArrowLeft/ArrowDown/ArrowUp) to navigate nodes without dragging.</span>
            </div>
            ${renderPlanDagSvgHtml(basePlanModel)}
          </div>

          <!-- Synchronized Outline Surface -->
          <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">
            ${outlineModulesHtml}
          </div>
        </section>

        <!-- 3. PROGRESS VIEW -->
        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${activeTopLevel === "Learn" && activeLearnSub === "Progress"}"${activeTopLevel === "Learn" && activeLearnSub === "Progress" ? "" : " hidden"}>
          <div class="section-header">
            <h2>Objective Proficiency &amp; Topic Diagnostics</h2>
            <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-adaptation-diff">
              Open Adaptation Diff Preview
            </button>
          </div>

          <div class="study-card" data-opaque-surface="true">
            <h3>Objective Proficiency Table (Two-Layer Evidence Ledger)</h3>
            <p class="meta-text">Canonical Proficiency States: ${canonicalStatusesLegendHtml}</p>
            <div class="table-responsive">
              <table class="proficiency-table">
                <thead>
                  <tr>
                    <th scope="col">Objective</th>
                    <th scope="col">Proficiency Status</th>
                    <th scope="col">Activity Execution</th>
                    <th scope="col">Evidence Support &amp; Refs</th>
                  </tr>
                </thead>
                <tbody>
                  ${proficiencyRowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <div class="study-card diagnostic-panel" data-diagnostic-session-id="${escapeHtml(diagnosticState.diagnostic_session_id)}" data-diagnostic-state="${escapeHtml(diagnosticState.state)}" data-opaque-surface="true">
            <h3>Topic Diagnostic Panel (${escapeHtml(diagnosticState.diagnostic_session_id)})</h3>
            <p>Session State: <strong>${escapeHtml(diagnosticState.state)}</strong> · Assessed Objectives: <code>${escapeHtml(diagnosticState.assessed_objective_version_ids.join(", ") || "none")}</code> · Unassessed Objectives: <code>${escapeHtml(diagnosticState.unassessed_objective_version_ids.join(", ") || "none")}</code></p>
            <p class="meta-text">Stopping early preserves demonstrated objectives while explicitly keeping untested objectives <code>unassessed</code> rather than inferred from neighboring topics (@S19, @S64, @S70).</p>
            <div class="action-row">
              <button type="button" class="btn-secondary" data-action="diagnostic-stop-early">Stop Diagnostic Early (Preserve Unassessed)</button>
            </div>
          </div>
        </section>

        <!-- 4. RESOURCES VIEW -->
        <section class="learn-sub-panel" id="panel-learn-resources" data-learn-panel="Resources" data-active="${activeTopLevel === "Learn" && activeLearnSub === "Resources"}"${activeTopLevel === "Learn" && activeLearnSub === "Resources" ? "" : " hidden"}>
          <div class="section-header">
            <h2>Reviewed Catalog Resources &amp; Provenance</h2>
            <p class="meta-text">Every resource card displays verified publisher provenance, <code>link_and_metadata_only</code> rights boundaries, and separate optional certification costs.</p>
          </div>
          <div class="resources-grid">
            ${resourcesHtml}
          </div>
        </section>
      </section>

      <!-- ==================== EXPLORE WORKSPACE ==================== -->
      <section class="top-level-panel" id="panel-explore" data-top-panel="Explore" data-active="${activeTopLevel === "Explore"}"${activeTopLevel === "Explore" ? "" : " hidden"}>
        <div class="section-header">
          <h2>Explore Public Curriculum Templates</h2>
          <div class="action-row">
            <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">
              Publication Preview &amp; Redaction Audit
            </button>
            <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-partial-adoption">
              Configure Partial Adoption
            </button>
          </div>
        </div>

        <article class="study-card public-template-card" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" data-opaque-surface="true">
          <header class="card-header">
            <div>
              <h3>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.title)}</h3>
              <p class="meta-text">Published by <strong>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publisher.display_name)}</strong> · License: <code>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_terms.content_license_id)}</code> · Revision #${DEFAULT_PUBLIC_CURRICULUM.revision_number}</p>
            </div>
            <div class="upvote-cluster">
              <button type="button" class="btn-secondary upvote-btn" data-action="toggle-upvote" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" aria-pressed="${upvoteInfo.viewerHasUpvoted}">
                ▲ Upvote Revision (${upvoteInfo.upvoteCount ?? 0})
              </button>
            </div>
          </header>
          <p>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.summary)}</p>
          <p class="meta-text">Transitive Prerequisite Resolution: Selecting <code>public-module-attention</code> automatically includes prerequisite <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", "))}</code>.</p>
        </article>
      </section>

      <!-- ==================== SETTINGS WORKSPACE ==================== -->
      <section class="top-level-panel" id="panel-settings" data-top-panel="Settings" data-active="${activeTopLevel === "Settings"}"${activeTopLevel === "Settings" ? "" : " hidden"}>
        <div class="section-header">
          <h2>Workspace Settings, BYOK Custody, Billing &amp; Privacy</h2>
        </div>

        <!-- Theme Selector -->
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Appearance &amp; Accessibility Theme</h3>
          <div class="theme-selector-group" role="group" aria-label="Theme Mode Selector">
            ${(["light", "dark", "system"] as const)
              .map(
                (mode) =>
                  `<button type="button" class="btn-secondary${themePreference === mode ? " is-active" : ""}" data-action="set-theme" data-theme-value="${mode}" aria-pressed="${themePreference === mode}">Theme: ${mode}</button>`
              )
              .join("\n            ")}
          </div>
        </article>

        <!-- BYOK Encrypted Credential Custody Panel -->
        <article class="study-card settings-card" data-byok-mode="${escapeHtml(byokState.mode)}" data-allow-hosted-fallback="${byokState.allowHostedFallback}" data-opaque-surface="true">
          <h3>BYOK Encrypted Credential Custody (OpenAI, Anthropic, Google Gemini)</h3>
          <p class="disclosure-text">${escapeHtml(byokState.serverCustodyDisclosure)}</p>
          <p class="disclosure-text">${escapeHtml(byokState.externalBillingDisclosure)}</p>
          <ul class="credential-list">
            ${byokState.credentials
              .map(
                (cred) => `<li class="credential-item" data-credential-ref="${escapeHtml(cred.credential_ref)}" data-provider-id="${escapeHtml(cred.provider_id)}">
                <strong>${escapeHtml(cred.label ?? cred.provider_id)}</strong> (<code>${escapeHtml(cred.provider_id)}</code>) — Masked: <code>${escapeHtml(cred.masked_hint)}</code> · Status: <span class="badge">${escapeHtml(cred.status)}</span> · ETag: <code>${escapeHtml(cred.etag ?? "")}</code>
              </li>`
              )
              .join("\n            ")}
          </ul>
        </article>

        <!-- Hosted Inference Wallet & 4-Bucket Cost Breakdown -->
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Hosted Inference Wallet &amp; 4-Bucket Cost Breakdown</h3>
          <p>Available Hosted Balance: <strong>${formatMinorCurrency(billingState.wallet.available_minor, billingState.wallet.currency)}</strong> · Reserved Ceiling Hold: <strong>${formatMinorCurrency(billingState.wallet.reserved_minor, billingState.wallet.currency)}</strong></p>
          ${
            costBreakdown.byokEstimateDisclaimer
              ? `<p class="disclosure-text">${escapeHtml(costBreakdown.byokEstimateDisclaimer)}</p>`
              : ""
          }
          <div class="four-bucket-grid">
            ${fourBucketsHtml}
          </div>
        </article>

        <!-- Study Reminders -->
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Study Reminders &amp; Quiet Hours</h3>
          <p>Timezone: <code>${escapeHtml(reminderState.timezone)}</code> · Quiet Hours: <code>${escapeHtml(reminderState.quiet_hours.start_local_time)}–${escapeHtml(reminderState.quiet_hours.end_local_time)}</code> · Lead Time: ${reminderState.lead_time_minutes} min</p>
          <p class="disclosure-text">${escapeHtml(reminderState.bestEffortDeliveryDisclosure)}</p>
        </article>

        <!-- Account Export & Destructive Deletion -->
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Account Data Export &amp; Privacy</h3>
          <p>${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
          <div class="action-row">
            <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-account-deletion">
              Review Account Export &amp; Destructive Deletion
            </button>
          </div>
        </article>
      </section>
    </main>
  </div>

  <!-- Compact Mobile Bottom Navigation Bar (< 768px) -->
  <nav class="compact-bottom-nav nav-chrome-glass" aria-label="Compact mobile navigation">
    ${TOP_LEVEL_DESTINATIONS.map((dest) => {
      const isCurrent = dest === activeTopLevel;
      return `<button type="button" class="bottom-nav-btn${isCurrent ? " is-active" : ""}" data-action="navigate-top" data-destination="${dest}" aria-current="${isCurrent ? "page" : "false"}">${dest}</button>`;
    }).join("\n    ")}
  </nav>

  <!-- ==================== MODAL DIALOGS (closedby="any") ==================== -->
  <!-- 1. Adaptation Diff Preview Modal -->
  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title" data-opaque-surface="true"${openDialogId === "dialog-adaptation-diff" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header">
        <h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2>
        <button type="submit" class="btn-secondary" data-action="close-dialog">Close</button>
      </header>
      <p>Preserved Math Depth: <code>${escapeHtml(adaptationDiff.preserved_math_depth ?? "formal")}</code> · Proposal SHA-256: <code>${escapeHtml(adaptationDiff.proposal_sha256.slice(0, 16))}…</code></p>
      <p>Schedule Impact: ${adaptationDiff.impact.before_minutes}m → ${adaptationDiff.impact.after_minutes}m (${adaptationDiff.impact.delta_minutes >= 0 ? "+" : ""}${adaptationDiff.impact.delta_minutes}m)</p>
      <div class="diff-buckets">
        <div>
          <h3>Waived Instruction (Backed by Reviewed Anchor Evidence)</h3>
          <ul>
            ${adaptationDiff.waivers
              .map(
                (w) =>
                  `<li><code>${escapeHtml(w.node_id)}</code> — Evidence: <code>${escapeHtml(w.qualifying_evidence_refs.join(", "))}</code> (${escapeHtml(w.rationale)})</li>`
              )
              .join("")}
          </ul>
        </div>
        <div>
          <h3>Added Prerequisite Bridges (Unassessed Objectives Preserved)</h3>
          <ul>
            ${adaptationDiff.buckets.added
              .map(
                (a) =>
                  `<li><code>${escapeHtml(a.node_id ?? "")}</code> — ${escapeHtml(a.rationale ?? "")}</li>`
              )
              .join("")}
          </ul>
        </div>
      </div>
    </form>
  </dialog>

  <!-- 2. Partial Adoption Modal -->
  <dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title" data-opaque-surface="true"${openDialogId === "dialog-partial-adoption" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header">
        <h2 id="dialog-partial-adoption-title">Partial Curriculum Adoption &amp; Prerequisite Closure</h2>
        <button type="submit" class="btn-secondary" data-action="close-dialog">Close</button>
      </header>
      <p>Requested Module: <code>${escapeHtml(partialAdoptionScope.requestedModuleIds.join(", "))}</code></p>
      <p>Auto-Included Prerequisite Modules: <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", ") || "none")}</code></p>
      <p>Resolved Module Scope: <code>${escapeHtml(partialAdoptionScope.resolvedModuleIds.join(" → "))}</code></p>
      <p class="meta-text">Deterministic adoption executes at $0.00 AI inference cost without requiring BYOK keys or hosted wallet reservations.</p>
    </form>
  </dialog>

  <!-- 3. Publication Preview Modal -->
  <dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title" data-opaque-surface="true"${openDialogId === "dialog-publication-preview" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header">
        <h2 id="dialog-publication-preview-title">Publication Preview &amp; Private Field Redaction</h2>
        <button type="submit" class="btn-secondary" data-action="close-dialog">Close</button>
      </header>
      <p>Preview ID: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.preview_id)}</code> · Visibility: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.visibility)}</code></p>
      <p>Excluded Private Fields (Never Published): <code>${escapeHtml(publicationState.excludedPrivateFields.join(", "))}</code></p>
      <p>Terms Policy: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms_policy_id)}</code> (${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms.content_license_id)})</p>
    </form>
  </dialog>

  <!-- 4. Account Export & Destructive Deletion Modal -->
  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title" data-opaque-surface="true"${openDialogId === "dialog-account-deletion" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header">
        <h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2>
        <button type="submit" class="btn-secondary" data-action="close-dialog">Close</button>
      </header>
      <p>Export Scope Included: <code>${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}</code></p>
      <p>Export Scope Excluded: <code>${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}</code></p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
    </form>
  </dialog>

  <script data-dialog-light-dismiss-fallback="true">
${getDialogLightDismissFallbackScript()}
  </script>
</div>`;
}

export interface CurriculumWebAppController {
  getState(): CurriculumWebAppResolvedState;
  renderHtml(): string;
  navigateTopLevel(destination: TopLevelDestination): CurriculumWebAppResolvedState;
  navigateLearnSubDestination(subDestination: LearnSubDestination): CurriculumWebAppResolvedState;
  switchPlanView(view: PlanSynchronizedView): CurriculumWebAppResolvedState;
  selectPlanModule(
    moduleId: string,
    sourceView?: PlanSynchronizedView
  ): CurriculumWebAppResolvedState;
  selectPlanActivity(
    activityId: string,
    moduleId?: string,
    sourceView?: PlanSynchronizedView
  ): CurriculumWebAppResolvedState;
  applyMapControl(control: MapNonDraggingControl): CurriculumWebAppResolvedState;
  navigateMapKeyboard(key: MapKeyboardKey): CurriculumWebAppResolvedState;
  recordTodayActivityCompletion(
    activityId: string,
    eventId?: string
  ): RecordedProgressEventReceipt;
  setThemePreference(theme: ThemePreference): CurriculumWebAppResolvedState;
  toggleUpvote(publicationRevisionId?: string): CurriculumWebAppResolvedState;
  openDialog(dialogId: string): CurriculumWebAppResolvedState;
  closeDialog(): CurriculumWebAppResolvedState;
}

export function createCurriculumWebAppController(
  initialState: CurriculumWebAppStateInput = {}
): CurriculumWebAppController {
  let topLevel: TopLevelDestination = initialState.topLevel ?? "Learn";
  let learnSubDestination: LearnSubDestination =
    initialState.learnSubDestination ?? "Today";
  let planView: PlanSynchronizedView = initialState.planView ?? "Map";
  let selectedModuleId: string | null =
    initialState.selectedModuleId ?? "module-foundations";
  let selectedActivityId: string | null =
    initialState.selectedActivityId ?? "activity-theory";
  let focusedNodeId: string | null =
    initialState.focusedNodeId ?? selectedModuleId;
  let zoom = initialState.zoom ?? 1;
  const viewportWidthPx = initialState.viewportWidthPx ?? 1280;
  const textScalePercent = initialState.textScalePercent ?? 100;
  let themePreference: ThemePreference = initialState.themePreference ?? "light";
  const solidSurfaces = initialState.solidSurfaces ?? false;
  const reduceMotion = initialState.reduceMotion ?? false;
  const adoptedSelectedModuleIds: string[] = [
    ...(initialState.adoptedSelectedModuleIds ?? ["public-module-attention"]),
  ];
  let upvotedRevisionIds: string[] = [
    ...(initialState.upvotedRevisionIds ?? []),
  ];
  let openDialogId: string | null = initialState.openDialogId ?? null;

  const curriculum = initialState.curriculum ?? DEFAULT_SYNTHETIC_CURRICULUM;
  const schedule = initialState.schedule ?? DEFAULT_SYNTHETIC_SCHEDULE;
  const proficiency = initialState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const catalogResources =
    initialState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;

  const todayController = createTodayViewController({
    curriculum,
    schedule,
    proficiency,
    catalogResources,
    ...(initialState.activityStates
      ? { initialActivityStates: initialState.activityStates }
      : {}),
  });

  const recordedProgressEvents: ProgressEventInput[] = [];
  if (initialState.recordedProgressEvents) {
    for (const ev of initialState.recordedProgressEvents) {
      recordedProgressEvents.push(ev);
      todayController.recordProgressEvent(ev);
    }
  }

  function buildCurrentPlanModel(): PlanMapAndOutlineModel {
    const tState = todayController.getState();
    return buildPlanMapAndOutlineModel({
      curriculum,
      proficiency,
      activityStates: tState.activityExecutionStates,
      catalogResources,
      viewportWidthPx,
      selectedModuleId,
      selectedActivityId,
      focusedNodeId,
      zoom,
    });
  }

  function getState(): CurriculumWebAppResolvedState {
    const tState = todayController.getState();
    return {
      topLevel,
      learnSubDestination,
      planView,
      selectedModuleId,
      selectedActivityId,
      focusedNodeId,
      zoom,
      viewportWidthPx,
      textScalePercent,
      themePreference,
      solidSurfaces,
      reduceMotion,
      activityStates: tState.activityExecutionStates,
      recordedProgressEvents: [...recordedProgressEvents],
      recordedReceipts: tState.recordedEvents,
      totalStudyMinutes: tState.totalStudyMinutes,
      selfReportedCompletedCount: tState.selfReportedCompletedCount,
      adoptedSelectedModuleIds: [...adoptedSelectedModuleIds],
      upvotedRevisionIds: [...upvotedRevisionIds],
      openDialogId,
    };
  }

  function renderHtml(): string {
    const state = getState();
    return renderCurriculumWebAppHtml({
      ...initialState,
      topLevel: state.topLevel,
      learnSubDestination: state.learnSubDestination,
      planView: state.planView,
      selectedModuleId: state.selectedModuleId,
      selectedActivityId: state.selectedActivityId,
      focusedNodeId: state.focusedNodeId,
      zoom: state.zoom,
      viewportWidthPx: state.viewportWidthPx,
      textScalePercent: state.textScalePercent,
      themePreference: state.themePreference,
      solidSurfaces: state.solidSurfaces,
      reduceMotion: state.reduceMotion,
      recordedProgressEvents: state.recordedProgressEvents,
      adoptedSelectedModuleIds: state.adoptedSelectedModuleIds,
      upvotedRevisionIds: state.upvotedRevisionIds,
      openDialogId: state.openDialogId,
    });
  }

  return {
    getState,
    renderHtml,
    navigateTopLevel(destination: TopLevelDestination) {
      topLevel = destination;
      return getState();
    },
    navigateLearnSubDestination(subDestination: LearnSubDestination) {
      topLevel = "Learn";
      learnSubDestination = subDestination;
      return getState();
    },
    switchPlanView(view: PlanSynchronizedView) {
      topLevel = "Learn";
      learnSubDestination = "Plan";
      planView = view;
      return getState();
    },
    selectPlanModule(moduleId: string, _sourceView?: PlanSynchronizedView) {
      selectedModuleId = moduleId;
      focusedNodeId = moduleId;
      const model = buildCurrentPlanModel();
      const matchedMod = model.outlineModules.find((m) => m.moduleId === moduleId);
      if (matchedMod && matchedMod.activityIds.length > 0) {
        if (!selectedActivityId || !matchedMod.activityIds.includes(selectedActivityId)) {
          selectedActivityId = matchedMod.activityIds[0] ?? null;
        }
      }
      return getState();
    },
    selectPlanActivity(
      activityId: string,
      explicitModuleId?: string,
      _sourceView?: PlanSynchronizedView
    ) {
      selectedActivityId = activityId;
      const model = buildCurrentPlanModel();
      if (explicitModuleId) {
        selectedModuleId = explicitModuleId;
        focusedNodeId = explicitModuleId;
      } else {
        const ownerMod = model.outlineModules.find((m) =>
          m.activityIds.includes(activityId)
        );
        if (ownerMod) {
          selectedModuleId = ownerMod.moduleId;
          focusedNodeId = ownerMod.moduleId;
        }
      }
      return getState();
    },
    applyMapControl(control: MapNonDraggingControl) {
      if (control === "zoom_in") {
        zoom = Math.min(2, Number((zoom + 0.25).toFixed(2)));
      } else if (control === "zoom_out") {
        zoom = Math.max(0.5, Number((zoom - 0.25).toFixed(2)));
      } else {
        zoom = 1;
      }
      return getState();
    },
    navigateMapKeyboard(key: MapKeyboardKey) {
      const model = buildCurrentPlanModel();
      const nextModel = model.navigateKeyboard(key, focusedNodeId ?? undefined);
      focusedNodeId = nextModel.focusedNodeId;
      if (nextModel.selectedModuleId) {
        selectedModuleId = nextModel.selectedModuleId;
      }
      if (nextModel.selectedActivityId) {
        selectedActivityId = nextModel.selectedActivityId;
      }
      return getState();
    },
    recordTodayActivityCompletion(activityId: string, explicitEventId?: string) {
      const eventId = explicitEventId ?? `evt-complete-${activityId}`;
      const ev: ProgressEventInput = {
        eventId,
        activityId,
        type: "self_reported_completed",
      };
      if (!recordedProgressEvents.some((e) => (e.eventId ?? e.event_id) === eventId)) {
        recordedProgressEvents.push(ev);
      }
      return todayController.recordProgressEvent(ev);
    },
    setThemePreference(theme: ThemePreference) {
      themePreference = theme;
      return getState();
    },
    toggleUpvote(
      publicationRevisionId = DEFAULT_PUBLIC_CURRICULUM.publication_revision_id
    ) {
      if (upvotedRevisionIds.includes(publicationRevisionId)) {
        upvotedRevisionIds = upvotedRevisionIds.filter(
          (id) => id !== publicationRevisionId
        );
      } else {
        upvotedRevisionIds = [...upvotedRevisionIds, publicationRevisionId];
      }
      return getState();
    },
    openDialog(dialogId: string) {
      openDialogId = dialogId;
      return getState();
    },
    closeDialog() {
      openDialogId = null;
      return getState();
    },
  };
}

export interface MountableRootElement {
  innerHTML: string;
  querySelector?: (selector: string) => unknown;
  querySelectorAll?: (selector: string) => Iterable<unknown>;
  addEventListener?: (
    type: string,
    listener: (event: unknown) => void
  ) => void;
}

/**
 * Mounts the interactive Curriculum.io Web Application onto `rootElement`, binding delegated
 * click/keyboard interactions, `<dialog closedby="any">` `.showModal()` openers, and the
 * mandatory `closedBy` coordinate light-dismiss fallback without ever locking root `html`/`body`
 * scroll via `overflow: hidden` or `position: fixed`.
 */
export function mountCurriculumWebApp(
  rootElement: MountableRootElement,
  initialState: CurriculumWebAppStateInput = {}
): CurriculumWebAppController {
  const controller = createCurriculumWebAppController(initialState);

  function bindDialogs(): void {
    if (typeof rootElement.querySelectorAll !== "function") {
      return;
    }
    const dialogs = Array.from(
      rootElement.querySelectorAll('dialog[closedby="any"]')
    ) as Array<{
      id?: string;
      open?: boolean;
      dataset?: Record<string, string>;
      showModal?: () => void;
      close?: () => void;
      getBoundingClientRect?: () => {
        top: number;
        left: number;
        width: number;
        height: number;
      };
      addEventListener?: (
        type: string,
        listener: (ev: {
          target?: unknown;
          clientX?: number;
          clientY?: number;
        }) => void
      ) => void;
    }>;

    const supportsClosedBy =
      typeof globalThis.HTMLDialogElement !== "undefined" &&
      "closedBy" in globalThis.HTMLDialogElement.prototype;

    for (const dialog of dialogs) {
      if (!supportsClosedBy && typeof dialog.addEventListener === "function") {
        dialog.addEventListener("click", (event) => {
          if (event.target !== dialog) return;
          if (typeof dialog.getBoundingClientRect !== "function") return;
          const rect = dialog.getBoundingClientRect();
          const clientX = event.clientX ?? -1;
          const clientY = event.clientY ?? -1;
          const isDialogContent =
            rect.top <= clientY &&
            clientY <= rect.top + rect.height &&
            rect.left <= clientX &&
            clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          if (typeof dialog.close === "function") {
            dialog.close();
          }
          controller.closeDialog();
        });
      }
    }
  }

  function syncDom(): void {
    rootElement.innerHTML = controller.renderHtml();
    bindDialogs();
    const activeDialogId = controller.getState().openDialogId;
    if (activeDialogId && typeof rootElement.querySelector === "function") {
      const dialogEl = rootElement.querySelector(`#${activeDialogId}`) as {
        open?: boolean;
        showModal?: () => void;
      } | null;
      if (dialogEl && typeof dialogEl.showModal === "function" && !dialogEl.open) {
        try {
          dialogEl.showModal();
        } catch {
          // If already open or unsupported in synthetic DOM, attribute [open] is already present.
        }
      }
    }
  }

  syncDom();

  if (typeof rootElement.addEventListener === "function") {
    rootElement.addEventListener("click", (rawEvent: unknown) => {
      const ev = rawEvent as {
        target?: {
          closest?: (selector: string) => {
            dataset?: Record<string, string | undefined>;
          } | null;
        } | null;
        preventDefault?: () => void;
      };
      const actionEl = ev.target?.closest?.("[data-action]");
      if (!actionEl || !actionEl.dataset) return;
      const action = actionEl.dataset["action"];

      if (action === "navigate-top" && actionEl.dataset["destination"]) {
        controller.navigateTopLevel(
          actionEl.dataset["destination"] as TopLevelDestination
        );
        syncDom();
      } else if (
        action === "navigate-learn-sub" &&
        actionEl.dataset["subDestination"]
      ) {
        controller.navigateLearnSubDestination(
          actionEl.dataset["subDestination"] as LearnSubDestination
        );
        syncDom();
      } else if (action === "switch-plan-view" && actionEl.dataset["planView"]) {
        controller.switchPlanView(
          actionEl.dataset["planView"] as PlanSynchronizedView
        );
        syncDom();
      } else if (action === "select-map-node") {
        const modId =
          actionEl.dataset["moduleId"] ?? actionEl.dataset["nodeId"];
        if (modId) {
          controller.selectPlanModule(modId, "Map");
          syncDom();
        }
      } else if (
        action === "select-outline-module" &&
        actionEl.dataset["moduleId"]
      ) {
        controller.selectPlanModule(actionEl.dataset["moduleId"], "Outline");
        syncDom();
      } else if (
        action === "select-outline-activity" &&
        actionEl.dataset["activityId"]
      ) {
        controller.selectPlanActivity(
          actionEl.dataset["activityId"],
          actionEl.dataset["moduleId"],
          "Outline"
        );
        syncDom();
      } else if (action === "map-control" && actionEl.dataset["mapControl"]) {
        controller.applyMapControl(
          actionEl.dataset["mapControl"] as MapNonDraggingControl
        );
        syncDom();
      } else if (
        action === "complete-activity" &&
        actionEl.dataset["activityId"]
      ) {
        controller.recordTodayActivityCompletion(
          actionEl.dataset["activityId"],
          actionEl.dataset["eventId"]
        );
        syncDom();
      } else if (action === "set-theme" && actionEl.dataset["themeValue"]) {
        controller.setThemePreference(
          actionEl.dataset["themeValue"] as ThemePreference
        );
        syncDom();
      } else if (action === "toggle-upvote") {
        controller.toggleUpvote(actionEl.dataset["revisionId"]);
        syncDom();
      } else if (action === "open-dialog" && actionEl.dataset["dialogId"]) {
        controller.openDialog(actionEl.dataset["dialogId"]);
        syncDom();
      } else if (action === "close-dialog") {
        ev.preventDefault?.();
        controller.closeDialog();
        syncDom();
      }
    });

    rootElement.addEventListener("keydown", (rawEvent: unknown) => {
      const ev = rawEvent as {
        key?: string;
        target?: {
          closest?: (selector: string) => unknown;
        } | null;
        preventDefault?: () => void;
      };
      if (!ev.key) return;
      const inMapNode = ev.target?.closest?.(".map-node");
      if (
        inMapNode &&
        (ev.key === "ArrowRight" ||
          ev.key === "ArrowLeft" ||
          ev.key === "ArrowDown" ||
          ev.key === "ArrowUp" ||
          ev.key === "Enter")
      ) {
        ev.preventDefault?.();
        controller.navigateMapKeyboard(ev.key as MapKeyboardKey);
        syncDom();
      }
    });
  }

  return controller;
}
