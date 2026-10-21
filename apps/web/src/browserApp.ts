import {
  buildPlanMapAndOutlineModel, OBJECTIVE_PROFICIENCY_BADGE_STATUSES, renderAccessibleMathFormula,
  resolveSurfaceStyle, resolveThemeMode, resolveThemePalette,
  type ActivityExecutionStatus, type CatalogResourceMetadataInput, type MapKeyboardKey,
  type PlanMapAndOutlineModel, type ThemePreference,
} from "../../../packages/ui/src/index.ts";
import {
  createNavigationShellController, LEARN_SUB_DESTINATIONS, PLAN_SYNCHRONIZED_VIEWS,
  resolveResponsiveLayout, TOP_LEVEL_DESTINATIONS,
  type LearnSubDestination, type MapNonDraggingControl, type PlanSynchronizedView, type TopLevelDestination,
} from "./index.ts";
import {
  buildRevisionActivationRequest, createTodayViewController,
  type ProgressEventInput, type RecordedProgressEventReceipt,
} from "./tracerBulletViews.ts";
import {
  createAdaptationDiffController, createDiagnosticFlowController,
  type AdaptationProposalFixture, type DiagnosticSessionFixture, type ProficiencyProfileFixture,
} from "./diagnosticsAndAdaptation.ts";
import {
  createByokCustodyController, createReminderPreferenceController,
  type InferenceMode, type MaskedCredentialRecord,
} from "./byokAndReminders.ts";
import {
  buildFourBucketCostBreakdown, createHostedBillingController, createPublicAdoptionController,
  createPublicationLifecycleController, formatMinorCurrency,
  type HostedCreditWalletSnapshot, type OwnedPublicationItem, type OwnedPublicationRevisionItem,
  type PublicCurriculumPayload, type PublicationPreviewPayload,
} from "./billingAndSharing.ts";
import { createAccountPrivacyController } from "./releaseAndA11yViews.ts";
import { clamp, escapeHtml } from "./shared.ts";

export interface CurriculumWebAppStateInput {
  readonly topLevel?: TopLevelDestination; readonly learnSubDestination?: LearnSubDestination;
  readonly planView?: PlanSynchronizedView; readonly selectedModuleId?: string | null;
  readonly selectedActivityId?: string | null; readonly focusedNodeId?: string | null;
  readonly zoom?: number; readonly viewportWidthPx?: number; readonly textScalePercent?: number;
  readonly themePreference?: ThemePreference; readonly solidSurfaces?: boolean; readonly reduceMotion?: boolean;
  readonly activityStates?: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly recordedProgressEvents?: readonly ProgressEventInput[];
  readonly curriculum?: Record<string, unknown>; readonly schedule?: Record<string, unknown>;
  readonly proficiency?: ProficiencyProfileFixture;
  readonly catalogResources?: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly diagnosticSession?: DiagnosticSessionFixture; readonly adaptationProposal?: AdaptationProposalFixture;
  readonly byokMode?: InferenceMode; readonly byokCredentials?: readonly MaskedCredentialRecord[];
  readonly wallet?: HostedCreditWalletSnapshot; readonly adoptedSelectedModuleIds?: readonly string[];
  readonly upvotedRevisionIds?: readonly string[]; readonly openDialogId?: string | null;
  readonly hintRequested?: boolean; readonly workedSolutionRevealed?: boolean;
  readonly practiceSubmitted?: boolean; readonly practiceChoice?: string | null;
  readonly studyAheadActivityId?: string | null; readonly skippedActivityIds?: readonly string[];
  readonly remindersEnabled?: boolean; readonly remindersPaused?: boolean; readonly keyVisible?: boolean;
  readonly diagnosticControl?: "active" | "paused" | "stopped";
  readonly adaptationChoice?: "pending" | "accept_reviewed" | "keep_current";
  readonly loadMoreNote?: string | null; readonly intakeNote?: string | null;
  readonly keyActionNote?: string | null; readonly snoozeNote?: string | null;
  readonly rescheduleSessionId?: string | null; readonly rescheduleValue?: string | null;
  readonly depthOverrideReset?: boolean; readonly studyDetailOpen?: boolean;
}

type MinuteTuple = readonly [media: number, reading: number, practice: number, assessment: number, review: number];

function makeDurationEstimate(point: MinuteTuple, lower: MinuteTuple, upper: MinuteTuple) {
  const toObj = ([media_minutes, reading_minutes, practice_minutes, assessment_minutes, review_minutes]: MinuteTuple) => ({
    media_minutes, reading_minutes, practice_minutes, assessment_minutes, review_minutes,
  });
  return { ...toObj(point), lower_bounds: toObj(lower), upper_bounds: toObj(upper), range_interpretation: "planning_bounds_not_confidence_interval" };
}

const makeResAssign = (resource_version_id: string, role: string, segment_ids: string[], selection_rationale: string) => ({
  resource_version_id, role, segment_ids, selection_rationale,
});

const DEFAULT_SYNTHETIC_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-attention-synthetic",
  revision_id: "revision-attention-v2", revision_number: 2, predecessor_revision_id: "revision-attention-v1",
  account_id: "learner-default", created_at: "2026-10-20T16:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Transformer Tokenization & Scaled Dot-Product Attention",
    summary: "Master subword tokenization tradeoffs and derive scaled dot-product attention with verified resources.",
    included_topics: ["tokenization tradeoffs", "scaled dot-product attention", "matrix calculus"],
    excluded_topics: ["distributed cluster orchestration"],
    scope_note: "Formal math depth preserved; self-reported activity completion never substitutes for demonstrated proficiency.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  objectives: [
    {
      objective_id: "objective-tokenization", objective_version_id: "objective-tokenization-v1", topic_id: "topic-tokenization",
      title: "Analyze BPE and Unigram tokenization sequence lengths",
      description: "Explain how vocabulary size and subword segmentation alter sequence length and embedding lookup cost.",
      success_criterion: "Accurately compare token counts and out-of-vocabulary behavior across two unseen text samples.",
      level: "introductory", requirement_level: "required", assessment_activity_ids: ["activity-quiz"], prior_evidence_refs: ["anchor-attempt-001"],
    },
    {
      objective_id: "objective-attention", objective_version_id: "objective-attention-v1", topic_id: "topic-matrix-calculus",
      title: "Derive scaled dot-product attention gradients and variance scaling",
      description: "Explain why dot products grow with dimension d_k and how 1/sqrt(d_k) prevents softmax saturation.",
      success_criterion: "Compute forward attention weights and Jacobian structure for an unseen query-key-value example.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["activity-quiz", "activity-review"], prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [{ from_objective_id: "objective-tokenization", to_objective_id: "objective-attention" }],
  modules: [
    {
      module_id: "module-foundations", title: "Module 1: Tokenization & Sequence Foundations",
      summary: "Subword vocabulary construction, byte-level fallback, and sequence packing.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-tokenization"],
      activity_ids: ["activity-theory", "activity-example", "activity-coding"],
    },
    {
      module_id: "module-attention", title: "Module 2: Scaled Dot-Product Attention & Diagnostics",
      summary: "Matrix shape contracts, variance scaling by 1/sqrt(d_k), and spaced review.",
      requirement_level: "required", prerequisite_module_ids: ["module-foundations"], objective_ids: ["objective-attention"],
      activity_ids: ["activity-quiz", "activity-review", "activity-reflection"],
    },
  ],
  activities: [
    {
      activity_id: "activity-theory", type: "theory", title: "Read Subword Tokenization & Sequence Packing Notes",
      requirement_level: "required", objective_ids: ["objective-tokenization"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-tokenization-v1", "primary", ["seg-bpe-overview"], "Reviewed open reference covering BPE merge tables and sequence compression.")],
      duration_estimate: makeDurationEstimate([0, 15, 0, 0, 0], [0, 10, 0, 0, 0], [0, 22, 0, 0, 0]),
      content: { study_prompt: "Compare byte-pair encoding merge rules against unigram language model likelihood pruning." },
    },
    {
      activity_id: "activity-example", type: "worked_example", title: "Worked Example: Attention Scaling Factor 1/sqrt(d_k)",
      requirement_level: "required", objective_ids: ["objective-tokenization", "objective-attention"], prerequisite_activity_ids: ["activity-theory"],
      resource_assignments: [makeResAssign("synthetic-resource-tokenization-v1", "primary", ["seg-bpe-overview"], "Demonstrates variance growth of unscaled dot products.")],
      duration_estimate: makeDurationEstimate([12, 8, 5, 0, 0], [10, 6, 4, 0, 0], [15, 12, 8, 0, 0]),
      content: { example_prompt: "Inspect how scaling QK^T by 1/sqrt(d_k) keeps variance at 1 and prevents vanishing softmax gradients." },
    },
    {
      activity_id: "activity-coding", type: "coding", title: "Implement Reversible Tokenizer & Shape Validator",
      requirement_level: "required", objective_ids: ["objective-tokenization"], prerequisite_activity_ids: ["activity-example"],
      resource_assignments: [makeResAssign("synthetic-resource-cert-prep-v1", "supplemental", [], "External repository lab with optional certification exam track.")],
      duration_estimate: makeDurationEstimate([0, 5, 20, 0, 0], [0, 4, 15, 0, 0], [0, 8, 30, 0, 0]),
      content: { coding_prompt: "Run the external test suite to verify lossless UTF-8 round-trip encoding." },
    },
    {
      activity_id: "activity-quiz", type: "quiz", title: "Formative Checkpoint: Tokenization & Attention Shapes",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-attention"], prerequisite_activity_ids: ["activity-coding"],
      resource_assignments: [makeResAssign("synthetic-resource-tokenization-v1", "primary", [], "Formative verification anchored to reviewed rubric.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 10, 0], [0, 0, 0, 8, 0], [0, 0, 0, 15, 0]),
      content: { assessment_prompt: "Verify tensor dimensions for multi-head attention projections before unlocking downstream synthesis." },
    },
    {
      activity_id: "activity-review", type: "review", title: "Spaced Retrieval: Softmax Jacobian & Masking",
      requirement_level: "required", objective_ids: ["objective-attention"], prerequisite_activity_ids: ["activity-quiz"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 8], [0, 0, 0, 0, 5], [0, 0, 0, 0, 12]),
      content: { review_prompt: "Scheduled in a later session separate from initial quiz (@S19) to test durable retention." },
    },
    {
      activity_id: "activity-reflection", type: "reflection", title: "Optional Enrichment: FlashAttention IO-Complexity Notes",
      requirement_level: "optional", objective_ids: ["objective-attention"], prerequisite_activity_ids: ["activity-quiz"],
      resource_assignments: [makeResAssign("synthetic-resource-cert-prep-v1", "supplemental", [], "Optional hardware-aware enrichment reading.")],
      duration_estimate: makeDurationEstimate([0, 10, 5, 0, 0], [0, 8, 4, 0, 0], [0, 14, 8, 0, 0]),
      content: { reflection_prompt: "Summarize SRAM tiling tradeoffs without conflating optional enrichment with required mastery." },
    },
  ],
  certification_options: [{
    resource_version_id: "synthetic-resource-cert-prep-v1", mapped_objective_ids: ["objective-tokenization"],
    rationale: "Optional external certification track; separate from core learning completion and never implies platform accreditation.",
  }],
};

const DEFAULT_SYNTHETIC_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-attention-1", schedule_revision_id: "schedule-revision-attention-1",
  version: 1, curriculum_revision_id: "revision-attention-v2", timezone: "America/New_York", weekly_minutes: 120,
  sessions: [
    { session_id: "session-today-1", start_at: "2026-10-26T18:00:00-04:00", duration_minutes: 65, activity_ids: ["activity-theory", "activity-example", "activity-coding"], reminder_enabled: true },
    { session_id: "session-quiz-2", start_at: "2026-10-28T18:00:00-04:00", duration_minutes: 10, activity_ids: ["activity-quiz"], reminder_enabled: true },
    { session_id: "session-spaced-review-3", start_at: "2026-10-30T18:00:00-04:00", duration_minutes: 23, activity_ids: ["activity-review", "activity-reflection"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

const DEFAULT_SYNTHETIC_PROFICIENCY: ProficiencyProfileFixture = {
  profile_revision_id: "proficiency-snapshot-001", account_id: "learner-default", computed_at: "2026-10-20T16:00:00Z",
  objective_evidence: [
    { objective_id: "objective-tokenization", objective_version_id: "objective-tokenization-v1", topic_id: "topic-tokenization", state: "demonstrated", status: "demonstrated", evidence_support: "corroborated", qualifying_attempt_ids: ["anchor-attempt-001"], evidence_refs: ["anchor-attempt-001"], UnverifiedReason: null },
    { objective_id: "objective-attention", objective_version_id: "objective-attention-v1", topic_id: "topic-matrix-calculus", state: "unknown", status: "unknown", evidence_support: "none", qualifying_attempt_ids: [], evidence_refs: [], UnverifiedReason: "unassessed_in_diagnostic" },
  ],
  topic_coverage: [
    { topic_id: "topic-tokenization", assessed_objective_version_ids: ["objective-tokenization-v1"], unassessed_objective_version_ids: [], coverage_state: "demonstrated", coverage_label: "demonstrated", demonstrated_objective_count: 1, total_objective_count: 1 },
    { topic_id: "topic-matrix-calculus", assessed_objective_version_ids: [], unassessed_objective_version_ids: ["objective-attention-v1"], coverage_state: "unassessed", coverage_label: "unassessed", demonstrated_objective_count: 0, total_objective_count: 1 },
  ],
};

const DEFAULT_CATALOG_RESOURCES: Readonly<Record<string, CatalogResourceMetadataInput>> = {
  "synthetic-resource-tokenization-v1": {
    resource_version_id: "synthetic-resource-tokenization-v1", title: "Reviewed Open Monograph: Subword Tokenization & Sequence Packing",
    canonical_url: "https://example.invalid/catalog/tokenization-monograph", captured_at: "2026-10-20T16:00:00Z",
    provider: { provider_id: "open-ml-press", display_name: "Open ML Press (Curator Verified)" },
    access: { model: "free", certificate_included: false, access_verified_at: "2026-10-20T16:00:00Z" },
    ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
    segments: [{ segment_id: "seg-bpe-overview", title: "Section 2.1: Byte-Pair Encoding Merge Tables", verified: true }],
  },
  "synthetic-resource-cert-prep-v1": {
    resource_version_id: "synthetic-resource-cert-prep-v1", title: "Applied Sequence Modeling Lab & Optional Certification Track",
    canonical_url: "https://example.invalid/catalog/sequence-lab-cert", captured_at: "2026-10-20T16:00:00Z",
    provider: { provider_id: "systems-ai-institute", display_name: "Systems AI Institute" },
    access: { model: "freemium_optional_certificate", certificate_included: true, access_verified_at: "2026-10-20T16:00:00Z" },
    ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
    segments: [],
  },
};

const DEFAULT_DIAGNOSTIC_SESSION: DiagnosticSessionFixture = {
  diagnostic_session_id: "diagnostic-synthetic-001", curriculum_id: "curriculum-attention-synthetic",
  curriculum_revision_id: "revision-attention-v2", state: "active",
  target_objective_version_ids: ["objective-tokenization-v1", "objective-attention-v1"],
  assessed_objective_version_ids: ["objective-tokenization-v1"], unassessed_objective_version_ids: ["objective-attention-v1"],
  proficiency_snapshot_ref: "proficiency-snapshot-001", stop_reason: null,
};

const DEFAULT_ADAPTATION_PROPOSAL: AdaptationProposalFixture = {
  proposal_id: "adaptation-synthetic-001", curriculum_id: "curriculum-attention-synthetic",
  base_revision_id: "revision-attention-v2", candidate_revision_id: "revision-attention-v3-candidate",
  base_schedule_revision_id: "schedule-revision-attention-1", proficiency_snapshot_ref: "proficiency-snapshot-001",
  proposal_sha256: "938896be1292fd64cd5bf7f71c45068b10758ef3d3253833bd17b79a4e0d6dae", status: "pending",
  instruction_preferences_applied: { math_depth: "formal" },
  changes: [
    { kind: "waive_instruction", node_id: "activity-theory", activity_ids: ["activity-theory"], objective_version_ids: ["objective-tokenization-v1"], qualifying_evidence_refs: ["anchor-attempt-001"], rationale: "Reviewed diagnostic anchor attempt-001 corroborated tokenization proficiency; waive introductory reading while retaining formal math depth." },
    { kind: "add_bridge", node_id: "activity-matrix-calculus-bridge", activity_ids: ["activity-matrix-calculus-bridge"], objective_version_ids: ["objective-attention-v1"], qualifying_evidence_refs: [], rationale: "Objective objective-attention-v1 remains unassessed; insert targeted Jacobian bridge before mastery-gated quiz." },
  ],
  proposed_waivers: [{ waiver_id: "waiver-tokenization-001", objective_id: "objective-tokenization", objective_version_id: "objective-tokenization-v1", node_id: "activity-theory", criterion_policy_id: "criterion-tokenization-v1", qualifying_evidence_refs: ["anchor-attempt-001"], rationale: "Demonstrated via reviewed anchor evidence (anchor-attempt-001)." }],
  impact: {
    before_minutes: 98, after_minutes: 105, constraint_status: "feasible",
    schedule_impact_summary: "+7 minutes net across 3 weekly sessions (within 120m weekly cap).",
    inference_charge_summary: "Deterministic diff preview ($0.00 AI inference charge).",
    warnings: ["Untested objectives remain explicitly unassessed and are bridged rather than waived."],
  },
  unassessed_objective_version_ids: ["objective-attention-v1"],
};

const DEFAULT_PUBLIC_CURRICULUM: PublicCurriculumPayload = {
  schema_version: "0.2.0", publication_id: "publication-synthetic-001",
  publication_revision_id: "public-revision-synthetic-001", revision_number: 1,
  supersedes_publication_revision_id: null, visibility: "public", published_at: "2026-10-20T16:00:00Z",
  content_sha256: "a9427ddd7bc9f2c22c910939c5e890588eda136e359ed463897d71f79ad06fe8",
  upvote_count: 14, viewer_has_upvoted: false,
  publisher: { public_author_id: "public-author-synthetic-001", display_name: "Dr. Elena Vance (Verified Community Author)" },
  publication_terms: {
    policy_id: "publication-terms-v1", content_license_id: "CC-BY-4.0", rights_scope: "structure_and_author_prompts_only",
    attribution: "Dr. Elena Vance — Transformer Foundations Template", third_party_materials_excluded: true,
  },
  content: {
    title: "Transformer Foundations & Attention Mechanics (Public Template)",
    summary: "Reusable two-module public curriculum template with transitive prerequisite resolution.",
    objectives: [
      { objective_id: "objective-tokenization", title: "Analyze BPE and Unigram tokenization sequence lengths", prerequisite_objective_ids: [] },
      { objective_id: "objective-attention", title: "Derive scaled dot-product attention gradients", prerequisite_objective_ids: ["objective-tokenization"] },
    ],
    prerequisite_edges: [{ from_objective_id: "objective-tokenization", to_objective_id: "objective-attention" }],
    modules: [
      { module_id: "public-module-tokenization", title: "Module 1: Tokenization Foundations", summary: "Prerequisite subword representations and sequence packing.", objective_ids: ["objective-tokenization"], activity_ids: ["public-activity-theory", "public-activity-coding"], prerequisite_module_ids: [] },
      { module_id: "public-module-attention", title: "Module 2: Scaled Dot-Product Attention", summary: "Depends on Module 1 tokenization representations.", objective_ids: ["objective-attention"], activity_ids: ["public-activity-attention-quiz"], prerequisite_module_ids: ["public-module-tokenization"] },
    ],
  },
};

const DEFAULT_PUBLICATION_PREVIEW: PublicationPreviewPayload = {
  preview_id: "preview-synthetic-001", source_plan_id: "curriculum-attention-synthetic",
  source_plan_version_id: "revision-attention-v2", visibility: "public",
  content_sha256: "a9427ddd7bc9f2c22c910939c5e890588eda136e359ed463897d71f79ad06fe8",
  preview_sha256: "e1b88a7d4a5d6033b819b2e5e2e4c7f1928374655647382910abcdef12345678",
  expires_at: "2026-10-25T17:00:00Z", publication_terms_policy_id: "publication-terms-v1",
  excluded_private_fields: ["learner_notes", "attempt_history", "diagnostic_transcripts", "byok_credentials", "billing_ledger"],
  warnings: ["Third-party catalog excerpts are excluded; only resource links, metadata, and your structural plan are shared."],
  public_content: DEFAULT_PUBLIC_CURRICULUM.content,
  publisher: DEFAULT_PUBLIC_CURRICULUM.publisher,
  publication_terms: DEFAULT_PUBLIC_CURRICULUM.publication_terms,
};

const DEFAULT_OWNED_PUBLICATIONS: readonly OwnedPublicationItem[] = [{
  publication_id: "publication-synthetic-001", source_plan_id: "curriculum-attention-synthetic", visibility: "public", state: "active",
  display_title: "Transformer Foundations & Attention Mechanics (Public Template)", published_revision_id: "public-revision-synthetic-001",
  current_revision_upvote_count: 14, created_at: "2026-10-20T12:00:00Z", updated_at: "2026-10-20T12:00:00Z", management_version_id: '"management-etag-001"',
}];

const DEFAULT_OWNED_REVISIONS: readonly OwnedPublicationRevisionItem[] = [{
  publication_id: "publication-synthetic-001", publication_revision_id: "public-revision-synthetic-001", revision_number: 1,
  source_plan_version_id: "revision-attention-v2", visibility: "public", state: "active", public_readable: true,
  upvote_count: 14, published_at: "2026-10-20T16:00:00Z",
  content_sha256: "a9427ddd7bc9f2c22c910939c5e890588eda136e359ed463897d71f79ad06fe8",
}];

const makeDefaultCred = (
  credential_ref: string, provider_id: string, label: string, masked_suffix: string, updated_at: string,
): MaskedCredentialRecord => ({
  credential_ref, provider_id, label, status: "active", credential_version_ref: `${credential_ref}-v1`,
  masked_hint: `••••${masked_suffix}`, masked_suffix, version: 1, etag: `"credential-${credential_ref}-v1"`, updated_at,
});

const DEFAULT_BYOK_CREDENTIALS: readonly MaskedCredentialRecord[] = [
  makeDefaultCred("cred-openai-1", "openai", "OpenAI Research Key", "9a4F", "2026-10-20T14:00:00Z"),
  makeDefaultCred("cred-anthropic-1", "anthropic", "Anthropic Claude Key", "7c2B", "2026-10-20T14:10:00Z"),
  makeDefaultCred("cred-gemini-1", "google_gemini", "Google Gemini Key", "3e8D", "2026-10-20T14:20:00Z"),
];

const DEFAULT_WALLET: HostedCreditWalletSnapshot = {
  currency: "USD", available_minor: 2450, reserved_minor: 350, live_billing_enabled: true, updated_at: "2026-10-20T16:00:00Z",
};

export function getDialogLightDismissFallbackScript(): string {
  return `(function attachDialogLightDismissFallback(root) {
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
})();`;
}

type SfIconName =
  | "learn" | "explore" | "settings"
  | "today" | "plan" | "progress" | "resources"
  | "zoom-in" | "zoom-out" | "reset" | "focus"
  | "check";

const SF_ICON_PATHS: Record<SfIconName, string> = {
  learn: `<path d="M3 2.75h3.6c.8 0 1.4.65 1.4 1.45V13"/><path d="M13 2.75H9.4c-.8 0-1.4.65-1.4 1.45V13"/><path d="M3 12.25h3.6"/><path d="M13 12.25H9.4"/>`,
  explore: `<circle cx="8" cy="8" r="5.25"/><path d="m9.95 6.05-1.15 3.15-3.15 1.15 1.15-3.15z"/>`,
  settings: `<path d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5"/><circle cx="5.5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>`,
  today: `<rect x="2.75" y="3.5" width="10.5" height="9.75" rx="1.5"/><path d="M2.75 6.5h10.5M5.5 2.5v2M10.5 2.5v2"/>`,
  plan: `<circle cx="4" cy="4.5" r="1.5"/><circle cx="12" cy="4.5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><path d="M5.3 5.4 6.9 10.6M10.7 5.4 9.1 10.6"/>`,
  progress: `<path d="M3 13V8.5M8 13V4M13 13V6.5"/>`,
  resources: `<path d="M4.25 2.75h5.4l2.1 2.1v8.15a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75z"/><path d="M9.6 2.75V5h2.15"/>`,
  "zoom-in": `<circle cx="7" cy="7" r="3.75"/><path d="m10 10 3.25 3.25M7 5.25v3.5M5.25 7h3.5"/>`,
  "zoom-out": `<circle cx="7" cy="7" r="3.75"/><path d="m10 10 3.25 3.25M5.25 7h3.5"/>`,
  reset: `<path d="M13 8a5 5 0 1 1-1.35-3.4"/><path d="M13 2.75V5.5h-2.75"/>`,
  focus: `<circle cx="8" cy="8" r="2"/><path d="M8 2.25v2.15M8 11.6v2.15M2.25 8h2.15M11.6 8h2.15"/>`,
  check: `<path d="M3.25 8.25 6.4 11.4 12.75 4.6"/>`,
};

function sfIcon(name: SfIconName, size: 15 | 16 = 16): string {
  return `<svg class="sf-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SF_ICON_PATHS[name]}</svg>`;
}

type GlyphTone = "todo" | "doing" | "done";
type GlyphKind = "module" | "gate";
type StudyModule = PlanMapAndOutlineModel["outlineModules"][number];
type StudyActivity = StudyModule["activities"][number];

const STUDY_TRACKS = [
  { id: "theory", title: "Theory & Worked Examples" },
  { id: "practice", title: "Practice & Coding Lab" },
  { id: "review", title: "Spaced Review" },
  { id: "gate", title: "Gate" },
] as const;

type StudyTrackId = (typeof STUDY_TRACKS)[number]["id"];

function executionTone(status: string): GlyphTone {
  if (status === "completed" || status === "waived") return "done";
  if (status === "in_progress" || status === "self_reported_completed") return "doing";
  return "todo";
}

function gateTone(status: string): GlyphTone {
  return status === "demonstrated" ? "done" : "todo";
}

function statusGlyph(type: GlyphKind, tone: GlyphTone, size = 20): string {
  const shape = type === "gate"
    ? `<path class="st-g-shape" d="M10 1.7 18.3 10 10 18.3 1.7 10Z" />`
    : `<rect class="st-g-shape" x="1.25" y="1.25" width="17.5" height="17.5" rx="4.5" />`;
  const mark = type === "gate"
    ? (tone === "done" ? `<path class="st-g-check" d="M6.6 10.2 8.9 12.5 13.5 7.6" />` : "")
    : tone === "doing"
      ? `<path class="st-g-half" d="M10 1.25H5.75a4.5 4.5 0 0 0-4.5 4.5v8.5a4.5 4.5 0 0 0 4.5 4.5H10Z" />`
      : tone === "done"
        ? `<path class="st-g-check" d="M5.5 10.4 8.4 13.3 14.6 6.8" />`
        : "";
  return `<svg class="st-glyph" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" data-type="${type}" data-status="${tone}">${shape}${mark}</svg>`;
}

function unitMarker(tone: GlyphTone): string {
  const body = tone === "done"
    ? `<circle class="st-m-disc" cx="12" cy="12" r="10" /><path class="st-m-check" d="M7.3 12.3 10.4 15.4 16.6 8.8" />`
    : `<circle class="st-m-ring" cx="12" cy="12" r="9.2" />${tone === "doing" ? `<circle class="st-m-dot" cx="12" cy="12" r="4" />` : ""}`;
  return `<svg class="st-marker" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" data-status="${tone}">${body}</svg>`;
}

function statusKeyHtml(): string {
  const item = (type: GlyphKind, tone: GlyphTone, label: string) =>
    `<li>${statusGlyph(type, tone, 16)}<span>${label}</span></li>`;
  return `<ul class="st-key">${item("module", "todo", "Not started")}${item("module", "doing", "In progress")}${item("module", "done", "Done")}${item("gate", "todo", "Not passed")}${item("gate", "done", "Passed")}</ul>`;
}

function studyTrackId(activity: Pick<StudyActivity, "type" | "masteryGated">): StudyTrackId {
  if (activity.type === "quiz" || activity.masteryGated) return "gate";
  if (activity.type === "review") return "review";
  if (activity.type === "coding" || activity.type === "project" || activity.type === "reflection") return "practice";
  return "theory";
}

function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function kindLabel(type: string): string {
  switch (type) {
    case "theory": return "Theory";
    case "worked_example": return "Worked example";
    case "coding": return "Coding";
    case "project": return "Project";
    case "reflection": return "Reflection";
    case "review": return "Review";
    case "quiz": return "Gate";
    default: return type;
  }
}

function activityClosed(status: string): boolean {
  return status === "completed" || status === "self_reported_completed" || status === "waived";
}

function unitProgress(activities: readonly StudyActivity[]): { done: number; total: number; left: number } {
  const done = activities.filter((activity) => activityClosed(activity.executionStatus)).length;
  const left = activities
    .filter((activity) => !activityClosed(activity.executionStatus))
    .reduce((sum, activity) => sum + activity.durationTriplet.point, 0);
  return { done, total: activities.length, left };
}

function unitProgressLabel(progress: { done: number; total: number; left: number }): string {
  return progress.left > 0 ? `${progress.done} of ${progress.total} · ${progress.left}m left` : `${progress.done} of ${progress.total}`;
}

function displayUnitTitle(title: string): string {
  return title.replace(/^Module\s+\d+\s*:\s*/, "");
}

function activityGlyph(activity: StudyActivity): { type: GlyphKind; tone: GlyphTone } {
  if (studyTrackId(activity) === "gate") return { type: "gate", tone: gateTone(activity.objectiveProficiencyStatus) };
  return { type: "module", tone: executionTone(activity.executionStatus) };
}

function statusWords(activity: StudyActivity): string {
  if (studyTrackId(activity) === "gate") {
    return activity.objectiveProficiencyStatus === "demonstrated" ? "Passed" : "Not passed";
  }
  if (activity.executionStatus === "self_reported_completed") return "Self-reported completed";
  if (activity.executionStatus === "completed") return "Completed";
  if (activity.executionStatus === "in_progress") return "In progress";
  if (activity.executionStatus === "waived") return "Waived by reviewed evidence";
  return "Not started";
}

function renderStudyNode(
  activity: StudyActivity,
  moduleId: string,
  ordinal: number,
  showOrdinal: boolean,
  selectedActivityId: string | null,
): string {
  const glyph = activityGlyph(activity);
  const host = sourceHost(activity.resourceProvenanceCards[0]?.canonicalUrl ?? null);
  const kicker = `${showOrdinal ? `<span class="st-ord">${ordinal}</span> ` : ""}${escapeHtml(host ?? kindLabel(activity.type))}`;
  const selected = activity.activityId === selectedActivityId;
  const isGate = glyph.type === "gate";
  const bridge = activity.prerequisiteBridgeRecommendation?.recommended
    ? `<span class="st-sr">Prerequisite Bridge Warning: ${escapeHtml(activity.prerequisiteBridgeRecommendation.reason)} Unmet capabilities: ${escapeHtml(activity.unmetPrerequisiteActivityIds.join(", ") || "none")}.</span>`
    : "";
  const eventAttr = isGate ? "" : ` data-event-id="evt-complete-${escapeHtml(activity.activityId)}"`;
  return `<article class="st-node" data-activity-id="${escapeHtml(activity.activityId)}" data-execution-status="${escapeHtml(activity.executionStatus)}" data-module-id="${escapeHtml(moduleId)}" data-selected="${selected}" data-open="${selected}" data-proficiency-status="${escapeHtml(activity.objectiveProficiencyStatus)}" data-mastery-gated="${activity.masteryGated}">
    <button type="button" class="st-open" data-action="select-outline-activity" data-activity-id="${escapeHtml(activity.activityId)}" data-module-id="${escapeHtml(moduleId)}" aria-pressed="${selected}">
      <span class="st-kicker">${kicker}</span>
      <span class="st-title">${escapeHtml(activity.title)}</span>
      <span class="st-time">${activity.durationTriplet.point}m</span>
      <span class="st-sr">Activity execution: ${escapeHtml(activity.executionStatus)}. Objective proficiency: ${escapeHtml(activity.objectiveProficiencyStatus)} (never conflated). ${escapeHtml(activity.executionBadge.nonColorCue)} ${escapeHtml(activity.objectiveProficiencyBadge.nonColorCue)} ${activity.required ? "Required" : "Optional"}. Effort ${activity.durationTriplet.min}/${activity.durationTriplet.point}/${activity.durationTriplet.max} min. Predecessors: ${escapeHtml(activity.prerequisiteActivityIds.join(", ") || "none")}.</span>
    </button>
    <button type="button" class="st-status-btn" data-action="${isGate ? "select-outline-activity" : "complete-activity"}" data-activity-id="${escapeHtml(activity.activityId)}" data-module-id="${escapeHtml(moduleId)}"${eventAttr} aria-pressed="${activity.executionStatus === "completed" || activity.executionStatus === "self_reported_completed"}">
      ${statusGlyph(glyph.type, glyph.tone, 20)}
      <span class="st-sr">${escapeHtml(statusWords(activity))}. ${escapeHtml(activity.title)}</span>
    </button>
    ${bridge}
  </article>`;
}

function renderStudyOrderBoard(
  idPrefix: string,
  modules: readonly StudyModule[],
  selectedModuleId: string | null,
  selectedActivityId: string | null,
): string {
  const activities = modules.flatMap((mod) => mod.activities);
  const headCells = STUDY_TRACKS.map((track) => {
    const progress = unitProgress(activities.filter((activity) => studyTrackId(activity) === track.id));
    const sub = track.id === "gate" ? `<span class="st-colhead-sub">Mastery checkpoint</span>` : "";
    return `<th class="st-colhead" scope="col"><span class="st-colhead-title">${track.title}</span>${sub}<span class="st-colhead-meta">${unitProgressLabel(progress)}</span></th>`;
  }).join("");
  const rows = modules.map((mod, index) => {
    const selected = mod.moduleId === selectedModuleId;
    const progress = unitProgress(mod.activities);
    const cells = STUDY_TRACKS.map((track) => {
      const inTrack = mod.activities.filter((activity) => studyTrackId(activity) === track.id);
      const body = inTrack.length === 0
        ? `<p class="st-none">None</p>`
        : inTrack.map((activity, activityIndex) => renderStudyNode(activity, mod.moduleId, activityIndex + 1, inTrack.length > 1, selectedActivityId)).join("");
      return `<td class="st-cell">${body}</td>`;
    }).join("");
    return `<tr class="study-card outline-module-card${selected ? " is-selected" : ""}" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${selected}" data-opaque-surface="true">
      <th class="st-rail" scope="row">
        ${unitMarker(executionTone(mod.executionStatus))}
        <div class="st-rail-text">
          <button type="button" class="st-unit-hit" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${selected}">
            <span class="st-unit-label">Unit ${index + 1}</span>
            <span class="st-unit-title">${escapeHtml(displayUnitTitle(mod.title))}</span>
            <span class="st-unit-meta">${unitProgressLabel(progress)}</span>
            <span class="st-sr">${selected ? "Selected" : "Select"} ${escapeHtml(mod.title)}. ${mod.required ? "Required" : "Optional"}. ${escapeHtml(mod.summary)}</span>
          </button>
        </div>
      </th>
      ${cells}
    </tr>`;
  }).join("");
  const spine = modules.map((mod, index) => {
    const selected = mod.moduleId === selectedModuleId;
    const nodes = mod.activities.map((activity, activityIndex) => renderStudyNode(activity, mod.moduleId, activityIndex + 1, true, selectedActivityId)).join("");
    return `<div class="st-sunit" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${selected}">
      <div class="st-shead">
        ${unitMarker(executionTone(mod.executionStatus))}
        <button type="button" class="st-unit-hit" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${selected}">
          <span class="st-unit-label">Unit ${index + 1}</span>
          <span class="st-unit-title">${escapeHtml(displayUnitTitle(mod.title))}</span>
          <span class="st-unit-meta">${unitProgressLabel(unitProgress(mod.activities))}</span>
        </button>
      </div>
      <div class="st-sbody">${nodes}</div>
    </div>`;
  }).join("");
  return `<section class="st-board" aria-labelledby="${idPrefix}-title">
    <div class="st-board-intro">
      <h2 id="${idPrefix}-title">In study order</h2>
      <p id="${idPrefix}-order">Each row is one unit, in study order. Across a row: Theory &amp; Worked Examples, Practice &amp; Coding Lab, Spaced Review, then Gate.</p>
      ${statusKeyHtml()}
    </div>
    <div class="st-table-wrap">
      <table class="st-table" aria-describedby="${idPrefix}-order">
        <colgroup><col class="st-col-rail"><col><col><col><col></colgroup>
        <thead><tr><th class="st-colhead" scope="col"><span class="st-colhead-title">Unit</span></th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="st-spine">${spine}</div>
  </section>`;
}

function renderTopDestButton(dest: TopLevelDestination, className: string, isCurrent: boolean): string {
  const icon: SfIconName = dest === "Learn" ? "learn" : dest === "Explore" ? "explore" : "settings";
  return `<button type="button" class="${className}${isCurrent ? " is-active" : ""}" data-action="navigate-top" data-destination="${dest}" aria-current="${isCurrent ? "page" : "false"}">${sfIcon(icon, 16)}<span>${dest}</span></button>`;
}

function renderLearnSubButton(sub: LearnSubDestination, isCurrent: boolean): string {
  const icon: SfIconName = sub === "Today" ? "today" : sub === "Plan" ? "plan" : sub === "Progress" ? "progress" : "resources";
  return `<button type="button" class="nav-sub-btn${isCurrent ? " is-active" : ""}" data-action="navigate-learn-sub" data-sub-destination="${sub}" aria-current="${isCurrent ? "page" : "false"}">${sfIcon(icon, 16)}<span>${sub}</span></button>`;
}

function renderMapControl(control: "zoom_in" | "zoom_out" | "fit_view" | "reset_focus", label: string, visibleLabel: string, icon: SfIconName): string {
  return `<button type="button" class="btn-secondary map-control-btn" data-action="map-control" data-map-control="${control}" aria-label="${escapeHtml(label)}">${sfIcon(icon, 16)}<span>${escapeHtml(visibleLabel)}</span></button>`;
}

function choiceRadio(name: string, value: string, label: string, description: string, checked: boolean): string {
  const id = `${name}-${value}`;
  return `<label class="choice-option" for="${id}"><input type="radio" id="${id}" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""}><span><strong>${escapeHtml(label)}</strong><span class="meta-text">${escapeHtml(description)}</span></span></label>`;
}

function shortSessionLabel(startAt: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return startAt.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date);
}

function renderPlanDagSvgHtml(planModel: PlanMapAndOutlineModel): string {
  const { svgViewport, moduleMapNodes, objectiveMapNodes, mapEdges } = planModel;
  const edgesHtml = mapEdges
    .map((edge) => {
      const { fromX, fromY, toX, toY } = edge.points;
      const midX = Math.round((fromX + toX) / 2);
      const pathD = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
      const dashAttr = edge.satisfied ? "" : ' stroke-dasharray="6 4"';
      return `<path class="map-edge" data-edge-id="${escapeHtml(edge.edgeId)}" data-from="${escapeHtml(edge.fromNodeId)}" data-to="${escapeHtml(edge.toNodeId)}" data-satisfied="${edge.satisfied}" d="${pathD}" fill="none" stroke="var(--color-border-control)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${dashAttr} marker-end="url(#dag-arrow)" aria-label="${escapeHtml(edge.textMeaning)}" />`;
    })
    .join("\n            ");

  const nodesHtml = [...moduleMapNodes, ...objectiveMapNodes]
    .map((node) => {
      const isSelected = node.selected || node.nodeId === planModel.selectedModuleId || node.nodeId === planModel.focusedNodeId;
      const strokeColor = isSelected ? "var(--color-accent)" : "var(--color-border-control)";
      const strokeWidth = "1.5";
      const fillSurface = isSelected ? "var(--color-accent-surface)" : "var(--color-surface)";
      const elevFilter = isSelected ? "url(#node-elev-selected)" : "url(#node-elev)";
      const moduleIdAttr = node.kind === "module" ? node.nodeId : (planModel.selectedModuleId ?? "module-foundations");
      const durationText = node.durationTriplet
        ? `${node.durationTriplet.min}/${node.durationTriplet.point}/${node.durationTriplet.max}m`
        : node.requirementLevel;
      const nodeTypeface = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif";

      return `<g class="map-node" tabindex="0" role="button" data-action="select-map-node" data-node-id="${escapeHtml(node.nodeId)}" data-node-kind="${escapeHtml(node.kind)}" data-module-id="${escapeHtml(moduleIdAttr)}" data-selected="${isSelected}" data-in-neighborhood="${node.inFocusedNeighborhood}" data-opaque-surface="true" aria-pressed="${isSelected}" aria-label="${escapeHtml(`${node.kind}: ${node.title}. ${node.executionBadge.nonColorCue}. ${node.proficiencyBadge.nonColorCue}`)}" transform="translate(${node.x}, ${node.y})">
              <rect width="${node.width}" height="${node.height}" rx="14" ry="14" fill="${fillSurface}" stroke="${strokeColor}" stroke-width="${strokeWidth}" filter="${elevFilter}" />
              <text x="16" y="24" fill="var(--color-text-primary)" font-size="12.5" font-weight="600" font-family="${nodeTypeface}" letter-spacing="-0.02em">${escapeHtml(node.title.slice(0, 34))}</text>
              <text x="16" y="44" fill="var(--color-text-secondary)" font-size="11" font-family="${nodeTypeface}">${escapeHtml(node.executionBadge.nonColorCue.slice(0, 38))}</text>
              <text x="16" y="62" fill="var(--color-text-secondary)" font-size="11" font-family="${nodeTypeface}">${escapeHtml(node.proficiencyBadge.nonColorCue.slice(0, 38))}</text>
              <text x="16" y="80" fill="var(--color-accent)" font-size="11" font-weight="600" font-family="${nodeTypeface}">${escapeHtml(durationText)}</text>
            </g>`;
    })
    .join("\n            ");

  return `<svg class="plan-dag-svg" role="group" aria-label="Curriculum prerequisite DAG map" viewBox="${escapeHtml(svgViewport.viewBox)}" width="100%" height="400" overflow="visible" data-zoom="${svgViewport.zoom}" data-focused-node="${escapeHtml(svgViewport.focusedNodeId ?? "")}" data-opaque-surface="true">
          <defs>
            <filter id="node-elev" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#17191C" flood-opacity="0.10" /></filter>
            <filter id="node-elev-selected" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="2" stdDeviation="3.5" flood-color="#17191C" flood-opacity="0.14" /></filter>
            <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-border-control)" /></marker>
          </defs>
          <g class="map-edges-layer">${edgesHtml}</g>
          <g class="map-nodes-layer">${nodesHtml}</g>
        </svg>`;
}

export function renderCurriculumWebAppHtml(inputState: CurriculumWebAppStateInput = {}): string {
  const curriculum = inputState.curriculum ?? DEFAULT_SYNTHETIC_CURRICULUM;
  const schedule = inputState.schedule ?? DEFAULT_SYNTHETIC_SCHEDULE;
  const proficiency = inputState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const catalogResources = inputState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;

  const viewportWidthPx = inputState.viewportWidthPx ?? 1280;
  const textScalePercent = inputState.textScalePercent ?? 100;
  const themePreference: ThemePreference = inputState.themePreference ?? "light";
  const solidSurfaces = inputState.solidSurfaces ?? false;
  const reduceMotion = inputState.reduceMotion ?? false;

  const resolvedThemeMode = resolveThemeMode(themePreference, themePreference === "dark" ? "dark" : "light");
  const palette = resolveThemePalette(themePreference, resolvedThemeMode);
  const layout = resolveResponsiveLayout(viewportWidthPx, textScalePercent);
  const studySurface = resolveSurfaceStyle(
    "reading",
    { themePreference, solidSurfaces, reduceMotion },
    { prefersReducedTransparency: solidSurfaces, prefersReducedMotion: reduceMotion },
  );

  const todayController = createTodayViewController({
    curriculum, schedule, proficiency, catalogResources,
    ...(inputState.activityStates ? { initialActivityStates: inputState.activityStates } : {}),
  });
  for (const ev of inputState.recordedProgressEvents ?? []) todayController.recordProgressEvent(ev);
  const todayState = todayController.getState();

  const basePlanModel = buildPlanMapAndOutlineModel({
    curriculum, proficiency, activityStates: todayState.activityExecutionStates, catalogResources, viewportWidthPx,
    selectedModuleId: inputState.selectedModuleId ?? "module-foundations",
    selectedActivityId: inputState.selectedActivityId ?? "activity-theory",
    focusedNodeId: inputState.focusedNodeId ?? inputState.selectedModuleId ?? "module-foundations",
    zoom: inputState.zoom ?? 1,
  });

  const navShell = createNavigationShellController({
    initialViewportWidthPx: viewportWidthPx, initialTextScalePercent: textScalePercent,
    initialAppearance: { themePreference, solidSurfaces, reduceMotion },
    planModules: basePlanModel.outlineModules.map((m) => ({
      moduleId: m.moduleId, title: m.title, required: m.required, prerequisiteModuleIds: m.prerequisiteModuleIds, activityIds: m.activityIds,
    })),
  });

  const activeTopLevel: TopLevelDestination = inputState.topLevel ?? "Learn";
  const activeLearnSub: LearnSubDestination = inputState.learnSubDestination ?? "Today";
  const activePlanView: PlanSynchronizedView = inputState.planView ?? "Map";

  navShell.navigateDeepLink({
    topLevel: activeTopLevel, learnSubDestination: activeLearnSub, planView: activePlanView,
    selectedModuleId: basePlanModel.selectedModuleId, selectedActivityId: basePlanModel.selectedActivityId,
  });

  const revisionActivationReq = buildRevisionActivationRequest({
    curriculumId: basePlanModel.curriculumId, revisionId: basePlanModel.revisionId,
    ifMatch: `"${basePlanModel.revisionId}-etag"`, confirmedByLearner: true, acknowledgeScheduleChanges: true,
  });

  const diagnosticState = createDiagnosticFlowController(
    inputState.diagnosticSession ?? DEFAULT_DIAGNOSTIC_SESSION, proficiency, resolvedThemeMode,
  ).getState();

  const adaptationDiff = createAdaptationDiffController(
    inputState.adaptationProposal ?? DEFAULT_ADAPTATION_PROPOSAL, resolvedThemeMode,
  ).getDiffModel();

  const partialAdoptionScope = createPublicAdoptionController(DEFAULT_PUBLIC_CURRICULUM).resolveScope(
    inputState.adoptedSelectedModuleIds ?? ["public-module-attention"],
  );

  const publicationController = createPublicationLifecycleController({
    preview: DEFAULT_PUBLICATION_PREVIEW, ownedPublications: DEFAULT_OWNED_PUBLICATIONS,
    ownedRevisions: DEFAULT_OWNED_REVISIONS, theme: resolvedThemeMode,
  });
  const isUpvoted = (inputState.upvotedRevisionIds ?? []).includes(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id);
  publicationController.registerPublicRevisionVoteState({
    publicationId: DEFAULT_PUBLIC_CURRICULUM.publication_id,
    publicationRevisionId: DEFAULT_PUBLIC_CURRICULUM.publication_revision_id,
    upvoteCount: (DEFAULT_PUBLIC_CURRICULUM.upvote_count ?? 14) + (isUpvoted ? 1 : 0),
    viewerHasUpvoted: isUpvoted,
  });
  const publicationState = publicationController.getState();

  const byokState = createByokCustodyController({
    initialMode: inputState.byokMode ?? "byok",
    initialCredentials: [...(inputState.byokCredentials ?? DEFAULT_BYOK_CREDENTIALS)],
    themeMode: resolvedThemeMode,
  }).getState();

  const billingState = createHostedBillingController({
    wallet: inputState.wallet ?? DEFAULT_WALLET,
    ledger: [
      { entry_id: "ledger-001", occurred_at: "2026-10-20T14:00:00Z", entry_type: "credit_purchase", delta_minor: 2800, balance_after_minor: 2800, reference_id: "topup-001", summary: "Hosted AI credit wallet top-up" },
      { entry_id: "ledger-002", occurred_at: "2026-10-20T15:30:00Z", entry_type: "reservation_hold", delta_minor: -350, balance_after_minor: 2450, reference_id: "reservation-001", summary: "Active generation ceiling reservation" },
    ],
    theme: resolvedThemeMode,
  }).getState();

  const costBreakdown = buildFourBucketCostBreakdown({
    theme: resolvedThemeMode, appServiceAccessMinor: 0, inferenceMode: byokState.mode, inferenceQuoteMinor: 185,
    materials: [
      { resourceId: "synthetic-resource-tokenization-v1", title: "Reviewed Open Monograph: Subword Tokenization", required: true, currency: "USD", costMinor: 0 },
      { resourceId: "external-reference-unknown-price", title: "External Advanced Reference (Unverified Merchant Price)", required: false, currency: "USD", costMinor: null },
    ],
    certificationAndComputeMinor: 4900, currency: "USD",
  });

  const reminderState = createReminderPreferenceController(
    {
      enabled: true, channels: ["email", "web_push"], timezone: "America/New_York",
      quiet_hours: { start_local_time: "22:00", end_local_time: "07:30" }, lead_time_minutes: 15, version: 1, etag: '"notification-prefs-v1"',
    },
    [{ occurrence_id: "reminder-occ-001", session_id: "session-today-1", scheduled_for: "2026-10-26T17:45:00-04:00", status: "scheduled" }],
    resolvedThemeMode,
  ).getState();

  const privacyState = createAccountPrivacyController({
    theme: resolvedThemeMode,
    exportJobs: [{
      export_job_id: "export-synthetic-001", status: "completed", requested_at: "2026-10-20T12:00:00Z",
      expires_at: "2026-10-27T12:00:00Z", download_url: "https://example.invalid/exports/export-synthetic-001.json",
    }],
  }).getState();

  const attentionFormula = renderAccessibleMathFormula(
    "\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
    { displayMode: "block" },
  );

  const topNavHtml = TOP_LEVEL_DESTINATIONS.map((dest) => renderTopDestButton(dest, "nav-top-btn", dest === activeTopLevel)).join("\n          ");
  const bottomNavHtml = TOP_LEVEL_DESTINATIONS.map((dest) => renderTopDestButton(dest, "bottom-nav-btn", dest === activeTopLevel)).join("\n    ");
  const learnSubNavHtml = LEARN_SUB_DESTINATIONS.map((sub) => renderLearnSubButton(sub, activeTopLevel === "Learn" && sub === activeLearnSub)).join("\n            ");

  const hintRequested = inputState.hintRequested ?? false;
  const workedSolutionRevealed = inputState.workedSolutionRevealed ?? false;
  const practiceSubmitted = inputState.practiceSubmitted ?? false;
  const practiceChoice = inputState.practiceChoice ?? null;
  const studyAheadActivityId = inputState.studyAheadActivityId ?? null;
  const skippedActivityIds = new Set(inputState.skippedActivityIds ?? []);
  const remindersOn = inputState.remindersEnabled ?? reminderState.enabled;
  const remindersPaused = inputState.remindersPaused ?? false;
  const keyVisible = inputState.keyVisible ?? false;
  const diagnosticControl = inputState.diagnosticControl ?? "active";
  const adaptationChoice = inputState.adaptationChoice ?? "pending";
  const loadMoreNote = inputState.loadMoreNote ?? null;
  const intakeNote = inputState.intakeNote ?? null;
  const keyActionNote = inputState.keyActionNote ?? null;
  const snoozeNote = inputState.snoozeNote ?? null;
  const rescheduleSessionId = inputState.rescheduleSessionId ?? null;
  const rescheduleValue = inputState.rescheduleValue ?? null;
  const depthOverrideReset = inputState.depthOverrideReset ?? false;
  const studyDetailOpen = inputState.studyDetailOpen ?? false;

  const isExecutionDone = (status: string) => status === "completed" || status === "self_reported_completed";
  const nextSession = todayState.nextSession;
  const nextActivity = nextSession?.activityBreakdown.find((act) => !isExecutionDone(act.executionStatus))
    ?? nextSession?.activityBreakdown[0]
    ?? null;
  const outlineById = new Map(basePlanModel.outlineActivities.map((act) => [act.activityId, act]));
  const sessionNode = (act: (typeof todayState.todayCards)[number]["activityBreakdown"][number]) => {
    const outline = outlineById.get(act.activityId);
    return outline
      ? renderStudyNode(outline, act.moduleId, 1, false, basePlanModel.selectedActivityId)
      : `<span class="st-title">${escapeHtml(act.title)}</span><span class="st-time">${act.durationTriplet.point}m</span>`;
  };

  const renderSessionActivity = (
    act: (typeof todayState.todayCards)[number]["activityBreakdown"][number],
  ) => {
    const id = escapeHtml(act.activityId);
    const accessText = act.resourceProvenanceLinks.length === 0
      ? "No external setup is required for this task."
      : act.resourceProvenanceLinks.map((link) => `${link.title}. Access: ${link.accessModel}. Rights: ${link.rightsBadge.label}.`).join(" ");
    return `<li class="today-activity-item" data-activity-id="${id}" data-execution-status="${escapeHtml(act.executionStatus)}" data-proficiency-status="${escapeHtml(act.objectiveProficiencyStatus)}">
      ${sessionNode(act)}
      <span class="st-sr">${escapeHtml(accessText)}</span>
    </li>`;
  };

  const nextActivitiesHtml = (nextSession?.activityBreakdown ?? []).map((act) => renderSessionActivity(act)).join("\n");
  const reviewItemsHtml = todayState.todayCards.flatMap((card) => card.activityBreakdown.filter((act) => act.type === "review").map((act) =>
    `<li class="today-activity-item" data-activity-id="${escapeHtml(act.activityId)}" data-execution-status="${escapeHtml(act.executionStatus)}" data-review-separation-valid="${card.reviewSeparation.valid}">
      ${sessionNode(act)}
      <span class="st-sr">Scheduled ${escapeHtml(shortSessionLabel(card.startAt))}. ${escapeHtml(card.reviewSeparation.separationSummary)} ${escapeHtml(act.scheduledReason)}</span>
    </li>`,
  )).join("\n");
  const completedItems = todayState.todayCards.flatMap((card) => card.activityBreakdown.filter((act) => isExecutionDone(act.executionStatus)));
  const completedHtml = completedItems.length === 0
    ? `<p class="meta-text">No self-reported completions yet.</p>`
    : `<ul class="today-activity-list">${completedItems.map((act) => `<li class="today-activity-item" data-activity-id="${escapeHtml(act.activityId)}" data-execution-status="${escapeHtml(act.executionStatus)}">${sessionNode(act)}<span class="st-sr">Self-reported completed. Objective proficiency is unchanged.</span></li>`).join("")}</ul>`;

  const nextAccessText = !nextActivity || nextActivity.resourceProvenanceLinks.length === 0
    ? "No external setup is required for this task."
    : nextActivity.resourceProvenanceLinks.map((link) => `${link.title}. Access: ${link.accessModel}. Rights: ${link.rightsBadge.label}.`).join(" ");

  const requiredActivities = basePlanModel.outlineActivities.filter((act) => act.required);
  const requiredCompleted = requiredActivities.filter((act) => isExecutionDone(act.executionStatus)).length;
  const demonstratedObjectives = basePlanModel.objectiveTracks.filter((obj) => obj.proficiencyStatus === "demonstrated").length;
  const reviewsDue = basePlanModel.outlineActivities.filter((act) => act.type === "review" && !isExecutionDone(act.executionStatus) && act.executionStatus !== "waived").length;
  const requiredSummary = `${requiredCompleted} of ${requiredActivities.length} required activities completed`;
  const evidenceSummary = `${demonstratedObjectives} of ${basePlanModel.objectiveTracks.length} objectives demonstrated`;
  const reviewSummary = `${reviewsDue} review${reviewsDue === 1 ? "" : "s"} due`;

  const aheadActions = (activityId: string, title: string) => {
    const id = escapeHtml(activityId);
    const ahead = studyAheadActivityId === activityId
      ? `<p class="prose">Study ahead requested for ${escapeHtml(title)}. Unmet prerequisites, evidence, and waivers stay unchanged.</p>`
      : "";
    const skipped = skippedActivityIds.has(activityId)
      ? `<p class="prose">Skip recorded for ${escapeHtml(title)} only. Prerequisite evidence was not created.</p>`
      : "";
    return `<div class="action-row"><button type="button" class="btn-secondary" data-action="study-ahead" data-activity-id="${id}">Study ahead</button><button type="button" class="btn-secondary" data-action="skip-activity" data-activity-id="${id}">Skip this activity</button></div><p class="prose warning-copy">Study ahead records a started event only. It does not complete prerequisites, create a waiver, or change proficiency. Skip this activity records self_reported_skipped for this activity only.</p>${ahead}${skipped}`;
  };

  const outlineModulesHtml = renderStudyOrderBoard("study-plan", basePlanModel.outlineModules, basePlanModel.selectedModuleId, basePlanModel.selectedActivityId);
  const todayStudyBoardHtml = renderStudyOrderBoard("study-today", basePlanModel.outlineModules, basePlanModel.selectedModuleId, basePlanModel.selectedActivityId);
  const progressStudyBoardHtml = renderStudyOrderBoard("study-progress", basePlanModel.outlineModules, basePlanModel.selectedModuleId, basePlanModel.selectedActivityId);

  const selectedModule = basePlanModel.outlineModules.find((mod) => mod.moduleId === basePlanModel.selectedModuleId) ?? basePlanModel.outlineModules[0];
  const selectedActivity = selectedModule?.activities.find((act) => act.activityId === basePlanModel.selectedActivityId) ?? selectedModule?.activities[0];
  const mathLevels = [...new Set((selectedModule?.objectives ?? []).map((obj) => obj.level))].join(", ") || "Not stated";
  const selectedUnitIndex = selectedModule ? basePlanModel.outlineModules.findIndex((mod) => mod.moduleId === selectedModule.moduleId) : -1;
  const selectedBridge = selectedActivity?.prerequisiteBridgeRecommendation?.recommended
    ? `<div class="prerequisite-bridge-warning" role="status" data-mastery-gated="${selectedActivity.masteryGated}"><strong>Prerequisite Bridge Warning:</strong> ${escapeHtml(selectedActivity.prerequisiteBridgeRecommendation.reason)} Unmet capabilities: ${escapeHtml(selectedActivity.unmetPrerequisiteActivityIds.join(", ") || "none")}.</div>`
    : "";
  const selectedProvenanceHtml = (selectedActivity?.resourceProvenanceCards ?? []).map((card) => `<div class="provenance-chip" data-resource-version-id="${escapeHtml(card.resourceVersionId)}">
    <span>Publisher: <strong>${escapeHtml(card.verifiedPublisher)}</strong></span>
    <span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(card.rightsBadge.label)}</span>
    <span>Access: ${escapeHtml(card.accessModel)}</span>
    ${card.optionalCertificationBadge ? `<span class="badge badge-cert-optional">${escapeHtml(card.optionalCertificationBadge.label)} Separate optional cost ${formatMinorCurrency(4900, "USD")}.</span>` : `<span>No separate certification price.</span>`}
    ${card.canonicalUrl ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="resource-link">Open verified resource</a>` : ""}
  </div>`).join("");
  const selectedGlyph = selectedActivity ? activityGlyph(selectedActivity) : { type: "module" as const, tone: "todo" as const };
  const selectedDetailHtml = selectedModule && selectedActivity ? `<div class="st-sheet" data-open="${studyDetailOpen}">
    <button type="button" class="st-scrim" data-action="close-study-detail" aria-label="Close details"></button>
    <aside class="st-panel selected-module-detail" data-open="${studyDetailOpen}" data-opaque-surface="true" aria-label="${escapeHtml(selectedActivity.title)}">
      <div class="st-panel-head">
        <p class="st-context">Unit ${selectedUnitIndex + 1} · ${escapeHtml(kindLabel(selectedActivity.type))}</p>
        <h2>${escapeHtml(selectedActivity.title)}</h2>
        <button type="button" class="st-panel-close" data-action="close-study-detail">Close</button>
      </div>
      <p class="st-status-row">${statusGlyph(selectedGlyph.type, selectedGlyph.tone, 20)}<span>${escapeHtml(statusWords(selectedActivity))}</span></p>
      <p class="prose">${escapeHtml(selectedModule.summary)}</p>
      <p>Mathematical treatment: ${escapeHtml(mathLevels)}.</p>
      <p>${selectedActivity.required ? "Required" : "Optional"}. Effort ${selectedActivity.durationTriplet.min}/${selectedActivity.durationTriplet.point}/${selectedActivity.durationTriplet.max} min.</p>
      <p class="prose">Activity execution: ${escapeHtml(selectedActivity.executionStatus)}. Objective proficiency: ${escapeHtml(selectedActivity.objectiveProficiencyStatus)} (never conflated).</p>
      <p class="meta-text">Predecessors: ${escapeHtml(selectedActivity.prerequisiteActivityIds.join(", ") || "none")}. Successors stay on the activities that list this one.</p>
      ${selectedProvenanceHtml}
      ${selectedBridge}
      ${aheadActions(selectedActivity.activityId, selectedActivity.title)}
      <button type="button" class="btn-primary btn-complete" data-action="complete-activity" data-activity-id="${escapeHtml(selectedActivity.activityId)}" data-event-id="evt-complete-${escapeHtml(selectedActivity.activityId)}" aria-pressed="${isExecutionDone(selectedActivity.executionStatus)}">${isExecutionDone(selectedActivity.executionStatus) ? "Self-reported completed" : "Mark self-reported completed"}</button>
    </aside>
  </div>` : "";

  const relationshipLegend = `<figure class="relationship-legend">
    <figcaption>Relationship legend</figcaption>
    <ul>
      <li><svg class="legend-swatch" viewBox="0 0 64 20" aria-hidden="true"><defs><marker id="legend-arrow-prereq" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-border-control)"/></marker></defs><line x1="2" y1="10" x2="50" y2="10" stroke="var(--color-border-control)" stroke-width="2" marker-end="url(#legend-arrow-prereq)"/></svg><span><strong>Prerequisite.</strong> Solid directed edge. Required capability before an activity; identify unmet capabilities.</span></li>
      <li><svg class="legend-swatch" viewBox="0 0 64 20" aria-hidden="true"><defs><marker id="legend-arrow-seq" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-accent)"/></marker></defs><line x1="2" y1="6" x2="50" y2="6" stroke="var(--color-accent)" stroke-width="2" marker-end="url(#legend-arrow-seq)"/><line x1="2" y1="14" x2="50" y2="14" stroke="var(--color-accent)" stroke-width="2"/></svg><span><strong>Recommended sequence.</strong> Distinct directed style. Suggested order, not a hard gate.</span></li>
      <li><svg class="legend-swatch" viewBox="0 0 64 20" aria-hidden="true"><line x1="2" y1="10" x2="58" y2="10" stroke="var(--color-border-control)" stroke-width="2" stroke-dasharray="5 4"/></svg><span><strong>Optional enrichment.</strong> Dashed branch with label. Optional work excluded from required-completion denominator.</span></li>
      <li><span class="badge">Review</span><span><strong>Review.</strong> Separate badge/list connection. Scheduled revisit; does not form a prerequisite cycle.</span></li>
    </ul>
  </figure>`;

  const canonicalStatusesLegendHtml = OBJECTIVE_PROFICIENCY_BADGE_STATUSES.map(
    (st) => `<span class="badge badge-proficiency-status" data-proficiency-status="${st}">${st}</span>`,
  ).join(" ");
  const proficiencyGlyph = (status: string): string => {
    if (status === "demonstrated" || status === "unassessed") return statusGlyph("gate", gateTone(status), 20);
    return statusGlyph("module", status === "not_started" ? "todo" : "doing", 20);
  };
  const proficiencyRowsHtml = basePlanModel.objectiveTracks.map((obj) => `<tr data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
    <td><strong>${escapeHtml(obj.title)}</strong><div class="meta-text">${escapeHtml(obj.objectiveVersionId)}</div></td>
    <td><span class="st-status-static">${proficiencyGlyph(obj.proficiencyStatus)}<span class="st-sr">${escapeHtml(obj.proficiencyStatus)} (${escapeHtml(obj.proficiencyBadge.nonColorCue)})</span></span></td>
    <td><span class="st-status-static">${statusGlyph("module", executionTone(obj.executionStatus), 20)}<span class="st-sr">${escapeHtml(obj.executionStatus)} (${escapeHtml(obj.executionBadge.nonColorCue)})</span></span></td>
    <td>${escapeHtml(obj.proficiencyBadge.evidenceSupport)} (${obj.proficiencyBadge.evidenceRefs.length > 0 ? escapeHtml(obj.proficiencyBadge.evidenceRefs.join(", ")) : "none"}) <button type="button" class="btn-secondary" data-action="view-evidence" data-objective-id="${escapeHtml(obj.objectiveId)}">View evidence</button></td>
  </tr>`).join("\n");

  const resourceCards = basePlanModel.outlineActivities.flatMap((act) => act.resourceProvenanceCards)
    .filter((card, idx, arr) => arr.findIndex((item) => item.resourceVersionId === card.resourceVersionId) === idx);
  const resourcesHtml = resourceCards.map((card) => {
    const rights = `<span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(card.rightsBadge.basis)}</span>`;
    const cert = card.optionalCertificationBadge
      ? `<span class="badge badge-cert-cost" data-optional-certification="true">Optional certification ${formatMinorCurrency(4900, "USD")}</span>`
      : `<span class="badge badge-cert-none">Core access ${formatMinorCurrency(0, "USD")}</span>`;
    const openLink = card.canonicalUrl
      ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary">Open source</a>`
      : "";
    return `<article class="resource-catalog-card" data-resource-version-id="${escapeHtml(card.resourceVersionId)}" data-opaque-surface="true">
      <header class="activity-row"><h3>${escapeHtml(card.title)}</h3>${rights}${cert}${openLink}</header>
      <p>Publisher: ${escapeHtml(card.verifiedPublisher)}</p>
      <p class="prose">Version captured: <time datetime="${escapeHtml(card.versionTimestamp)}">${escapeHtml(card.versionTimestamp)}</time>. Access: <strong>${escapeHtml(card.accessModel)}</strong>. Rights (${escapeHtml(card.rightsBadge.basis)}): ${escapeHtml(card.rightsBadge.label)}</p>
      <p class="prose">${escapeHtml(card.selectionRationale)}</p>
      ${card.optionalCertificationBadge ? `<p class="warning-copy">${escapeHtml(card.optionalCertificationBadge.label)} Separate optional cost ${formatMinorCurrency(4900, "USD")}. Opening the source does not mark the activity complete.</p>` : `<p>No paid certification is required for core access (${formatMinorCurrency(0, "USD")}). Opening the source does not mark the activity complete.</p>`}
    </article>`;
  }).join("\n");

  const fourBucketsHtml = Object.values(costBreakdown.buckets).map((bucket) => `<div class="cost-bucket-card" data-bucket-id="${escapeHtml(bucket.bucketId)}">
    <h3>${escapeHtml(bucket.label)}</h3>
    <p class="bucket-mechanism">Mechanism: <code>${escapeHtml(bucket.billingMechanism)}</code></p>
    <p class="bucket-summary"><strong>${escapeHtml(bucket.formattedSummary)}</strong></p>
    <ul class="bucket-lines">${bucket.lineItems.map((li) => `<li data-line-id="${escapeHtml(li.id)}" data-unknown-price="${li.isUnknownPrice}">${escapeHtml(li.label)}: <strong>${escapeHtml(li.formattedAmount)}</strong></li>`).join("")}</ul>
  </div>`).join("\n");

  const upvoteInfo = publicationState.revisionVotes[0] ?? {
    publicationId: DEFAULT_PUBLIC_CURRICULUM.publication_id,
    publicationRevisionId: DEFAULT_PUBLIC_CURRICULUM.publication_revision_id,
    upvoteCount: 14, viewerHasUpvoted: false,
  };
  const ownedCard = publicationState.ownedPublicationCards[0];
  const revisionHistoryHtml = publicationState.ownedRevisions.map((rev) => `<li>Revision ${rev.revision_number} <code>${escapeHtml(rev.publication_revision_id)}</code>. State: ${escapeHtml(rev.state)}. Visibility: ${escapeHtml(rev.visibility)}. Upvotes: ${rev.upvote_count ?? "withheld"}. Published <time datetime="${escapeHtml(rev.published_at)}">${escapeHtml(rev.published_at)}</time>.</li>`).join("");
  const adaptationChoiceCopy = adaptationChoice === "accept_reviewed"
    ? "Accept revision was reviewed on this screen. No live adaptation route accepted it, so the current plan stays in place."
    : adaptationChoice === "keep_current"
      ? "Current plan kept. The proposal was not accepted."
      : "Recommended describes this product suggestion. It is not a scientific certainty. The proposal is not accepted automatically.";
  const adaptationBody = `<p>Preserved math depth: <code>${escapeHtml(adaptationDiff.preserved_math_depth ?? "formal")}</code>. Proposal SHA-256: <code>${escapeHtml(adaptationDiff.proposal_sha256)}</code>.</p>
    <p>Before: ${adaptationDiff.impact.before_minutes} min. After: ${adaptationDiff.impact.after_minutes} min (${adaptationDiff.impact.delta_minutes >= 0 ? "+" : ""}${adaptationDiff.impact.delta_minutes} min).</p>
    <p class="prose">${escapeHtml(adaptationDiff.impact.schedule_impact_summary ?? "")}</p>
    <p class="prose">${escapeHtml(adaptationDiff.impact.inference_charge_summary ?? "")}</p>
    ${(adaptationDiff.impact.warnings ?? []).map((warning) => `<p class="warning-copy">${escapeHtml(warning)}</p>`).join("")}
    <h3>Waived instruction</h3>
    <ul>${adaptationDiff.waivers.map((waiver) => `<li><code>${escapeHtml(waiver.node_id)}</code>. Evidence: <code>${escapeHtml(waiver.qualifying_evidence_refs.join(", "))}</code>. ${escapeHtml(waiver.rationale)} <button type="button" class="btn-secondary" data-action="view-evidence" data-evidence-ref="${escapeHtml(waiver.qualifying_evidence_refs[0] ?? "")}">View evidence</button></li>`).join("")}</ul>
    <h3>New bridges</h3>
    <ul>${adaptationDiff.buckets.added.map((added) => `<li><code>${escapeHtml(added.node_id ?? "")}</code>. ${escapeHtml(added.rationale ?? "")}</li>`).join("")}</ul>
    <div class="action-row"><button type="button" class="btn-primary" data-action="accept-revision">Accept revision</button><button type="button" class="btn-secondary" data-action="keep-current-plan">Keep current plan</button></div>
    <p class="prose">${adaptationChoiceCopy}</p>`;

  const scheduleSessions = (Array.isArray(schedule["sessions"]) ? schedule["sessions"] : [])
    .filter((session): session is Record<string, unknown> => Boolean(session && typeof session === "object"));
  const timezoneLabel = reminderState.timezone === "America/New_York" ? "Eastern Time" : reminderState.timezone;
  const scheduleRowsHtml = scheduleSessions.map((session) => {
    const sessionId = typeof session["session_id"] === "string" ? session["session_id"] : "session";
    const startAt = typeof session["start_at"] === "string" ? session["start_at"] : "";
    const duration = typeof session["duration_minutes"] === "number" ? session["duration_minutes"] : 0;
    const preview = rescheduleSessionId === sessionId
      ? `<p class="prose">Preview for ${escapeHtml(sessionId)}: ${escapeHtml(rescheduleValue || "choose a date and time")}. Timezone ${escapeHtml(reminderState.timezone)} (${escapeHtml(timezoneLabel)}). Ambiguous local times need an explicit choice. This screen does not write a live schedule.</p>`
      : "";
    return `<li class="schedule-row">
      <p><strong>${escapeHtml(shortSessionLabel(startAt))}</strong> · ${duration} min · <time datetime="${escapeHtml(startAt)}">${escapeHtml(startAt)}</time></p>
      <label class="field" for="reschedule-${escapeHtml(sessionId)}">New local time
        <input id="reschedule-${escapeHtml(sessionId)}" type="datetime-local" data-reschedule-for="${escapeHtml(sessionId)}" name="reschedule-${escapeHtml(sessionId)}">
      </label>
      <button type="button" class="btn-secondary" data-action="reschedule-session" data-session-id="${escapeHtml(sessionId)}">Reschedule</button>
      ${preview}
    </li>`;
  }).join("\n");

  const practiceFeedback = practiceSubmitted
    ? `<p class="prose" role="status">Submitted${practiceChoice ? `: ${escapeHtml(practiceChoice)}` : ""}. This check is not demonstrated competence.</p>`
    : `<p class="meta-text">Selecting an option does not submit or advance.</p>`;
  const hintHtml = hintRequested ? `<p class="prose" role="status">Hint: the scale keeps the dot-product variance from growing with d_k. Assistance is recorded without a penalty.</p>` : "";
  const solutionHtml = workedSolutionRevealed ? `<p class="prose" role="status">Worked solution: softmax(QK^T / sqrt(d_k)) V. Studying the solution records assistance and does not mark the objective demonstrated.</p>` : "";
  const recoveryBanner = `<p class="status-banner" role="${todayState.asyncRecoveryBanner.role}"><strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)} ${escapeHtml(todayState.asyncRecoveryBanner.actionableNextStep)}</p>`;

  const openDialogId = inputState.openDialogId ?? null;
  const isLearn = activeTopLevel === "Learn";
  const dialogOpen = (id: string) => openDialogId === id ? " open" : "";

  return `<div class="curriculum-app-shell" data-theme="${resolvedThemeMode}" data-theme-preference="${themePreference}" data-solid-surfaces="${solidSurfaces}" data-reduce-motion="${reduceMotion}" data-breakpoint="${layout.breakpoint}" data-navigation-chrome="${layout.navigationChrome}" data-current-top-level="${activeTopLevel}" data-current-learn-sub="${activeLearnSub}" data-current-plan-view="${activePlanView}" data-selected-module-id="${escapeHtml(basePlanModel.selectedModuleId ?? "")}" data-selected-activity-id="${escapeHtml(basePlanModel.selectedActivityId ?? "")}" style="--active-canvas: ${palette.colors.canvas}; --active-surface: ${studySurface.backgroundColor};">
  <a class="skip-link" href="#main-workspace">Skip to main study workspace</a>
  <header class="app-header nav-chrome-glass" role="banner">
    <div class="brand-cluster"><span class="brand-title">Curriculum.io</span></div>
    <nav class="top-level-nav" aria-label="Primary navigation">${topNavHtml}</nav>
    <div class="header-status">
      <span class="duration-pill" data-study-minutes="${todayState.totalStudyMinutes}">Study minutes ${todayState.totalStudyMinutes}</span>
      <span class="duration-pill" data-self-reported-count="${todayState.selfReportedCompletedCount}">Self-reported ${todayState.selfReportedCompletedCount}</span>
    </div>
  </header>
  <div class="app-body-grid">
    <aside class="app-sidebar" aria-label="Learn sections">
      <div class="sidebar-section"><nav class="learn-sub-nav" aria-label="Learn sub-navigation">${learnSubNavHtml}</nav></div>
      <div class="sidebar-section"><p class="meta-text">${escapeHtml(basePlanModel.goal.title)}</p><p class="meta-text">Effort ${basePlanModel.totalDurationTriplet.min}/${basePlanModel.totalDurationTriplet.point}/${basePlanModel.totalDurationTriplet.max} min</p></div>
    </aside>
    <main id="main-workspace" class="app-main-workspace" role="main" tabindex="-1">
      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${isLearn}"${isLearn ? "" : " hidden"}>
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${isLearn && activeLearnSub === "Today"}"${isLearn && activeLearnSub === "Today" ? "" : " hidden"}>
          <div class="section-header">
            <h1 class="page-title">Today</h1>
            <div class="plan-toolbar">
              <label class="field" for="selected-plan">Selected plan
                <select id="selected-plan" name="selected-plan"><option selected>${escapeHtml(basePlanModel.goal.title)}</option></select>
              </label>
              <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-new-curriculum">New Curriculum</button>
            </div>
          </div>
          ${recoveryBanner}
          <div class="st-layout">
            ${todayStudyBoardHtml}
            ${selectedDetailHtml}
          </div>
          <section class="surface-panel next-session-panel" data-opaque-surface="true" data-review-separation-valid="${nextSession?.reviewSeparation.valid ?? todayState.reviewSeparationValid}">
            <h2>Next session</h2>
            ${nextActivity ? `<p>Capability: ${escapeHtml(nextActivity.moduleTitle)}</p><p>Task: ${escapeHtml(nextActivity.title)}</p><p>Effort ${nextActivity.durationTriplet.min}/${nextActivity.durationTriplet.point}/${nextActivity.durationTriplet.max} min. <strong>${nextActivity.requirementLevel === "optional" ? "Optional" : "Required"}</strong></p><p class="prose">Required access and setup: ${escapeHtml(nextAccessText)}</p><p class="prose"><strong>Why this is next.</strong> ${escapeHtml(nextActivity.scheduledReason)}</p><div class="action-row"><a class="btn-primary" href="#study-workspace">Continue attention mechanisms</a></div>` : `<p>No session is scheduled.</p>`}
            <ul class="today-activity-list">${nextActivitiesHtml}</ul>
          </section>
          <section class="surface-panel study-workspace" id="study-workspace" data-opaque-surface="true">
            <h2>Study</h2>
            <p class="prose">One task: ${escapeHtml(nextActivity?.title ?? "Scaled dot-product attention")}. ${escapeHtml(nextActivity?.requirementLevel === "optional" ? "Optional" : "Required")}.</p>
            <div class="math-formula-surface" data-opaque-surface="true" role="${attentionFormula.role}" aria-label="${escapeHtml(attentionFormula.ariaLabel)}">${attentionFormula.mathml}</div>
            <fieldset class="choice-group">
              <legend>Which statement matches the scaling term?</legend>
              ${choiceRadio("practice-choice", "variance", "It keeps dot-product variance near 1", "The scale is part of the formula, not a score for you.", practiceChoice === "variance")}
              ${choiceRadio("practice-choice", "speed", "It is a speed score for the learner", "A target duration is not a timed ability score.", practiceChoice === "speed")}
              ${choiceRadio("practice-choice", "optional", "It marks the activity optional", "Required and optional stay explicit labels.", practiceChoice === "optional")}
            </fieldset>
            ${practiceFeedback}
            <div class="action-row">
              <button type="button" class="btn-secondary" data-action="request-hint">Request hint</button>
              <button type="button" class="btn-secondary" data-action="study-worked-solution">Study worked solution</button>
              <button type="button" class="btn-primary" data-action="submit-practice">Submit</button>
            </div>
            ${hintHtml}
            ${solutionHtml}
            <div class="honest-two-layer-summary">
              <h3>Honest Two-Layer Status Summary (@S17, @S23)</h3>
              <p class="prose">Self-reporting an activity as completed records study effort idempotently (<code>self_reported_completed</code>) but never upgrades objective proficiency to <code>demonstrated</code> without reviewed assessment evidence.</p>
            </div>
          </section>
          <section class="review-queue" data-review-separation-valid="${todayState.reviewSeparationValid}">
            <h2>Review queue</h2>
            <p class="prose">Due and scheduled spaced review stays in a separate session.</p>
            <ul class="today-activity-list">${reviewItemsHtml}</ul>
          </section>
          <section class="completed-history">
            <h2>Completed work</h2>
            ${completedHtml}
          </section>
          <div class="action-row">
            <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Plan">Plan</button>
            <button type="button" class="btn-secondary" data-action="navigate-top" data-destination="Settings">Schedule</button>
          </div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-plan" data-learn-panel="Plan" data-active="${isLearn && activeLearnSub === "Plan"}"${isLearn && activeLearnSub === "Plan" ? "" : " hidden"}>
          <div class="section-header">
            <h1 class="page-title">Plan</h1>
            <div class="plan-toolbar">
              <div class="plan-view-switcher" role="group" aria-label="Map or outline">
                ${PLAN_SYNCHRONIZED_VIEWS.map((view) => `<button type="button" class="btn-secondary${view === activePlanView ? " is-active" : ""}" data-action="switch-plan-view" data-plan-view="${view}" aria-pressed="${view === activePlanView}">${view}</button>`).join("\n")}
              </div>
              <button type="button" class="btn-primary" data-action="activate-revision" data-curriculum-id="${escapeHtml(revisionActivationReq.curriculumId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">Activate plan</button>
            </div>
          </div>
          <p class="prose">${escapeHtml(basePlanModel.goal.summary)}</p>
          <p>${requiredSummary}. ${evidenceSummary}. ${reviewSummary}.</p>
          <p class="prose">Included: ${escapeHtml(basePlanModel.goal.includedTopics.join(", ") || "none")}. Excluded: ${escapeHtml(basePlanModel.goal.excludedTopics.join(", ") || "none")}. ${escapeHtml(basePlanModel.goal.scopeNote)}</p>
          ${relationshipLegend}
          <div class="plan-split">
            <div class="plan-focus-column">
              <div class="plan-map-container" data-plan-surface="Map" data-active="${activePlanView === "Map"}" data-opaque-surface="true">
                <div class="map-controls-bar" role="toolbar" aria-label="Map viewport controls">
                  ${renderMapControl("zoom_in", "Zoom In", "Zoom in", "zoom-in")}
                  ${renderMapControl("zoom_out", "Zoom Out", "Zoom out", "zoom-out")}
                  ${renderMapControl("fit_view", "Reset View", "Fit", "reset")}
                  ${renderMapControl("reset_focus", "Focus Neighborhood", "Reset focus", "focus")}
                </div>
                ${renderPlanDagSvgHtml(basePlanModel)}
                <p class="meta-text">Arrow keys move between modules. Selecting a module does not require pinch, drag, or hover.</p>
              </div>
              <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">${outlineModulesHtml}</div>
            </div>
            ${selectedDetailHtml}
          </div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${isLearn && activeLearnSub === "Progress"}"${isLearn && activeLearnSub === "Progress" ? "" : " hidden"}>
          <h1 class="page-title">Progress</h1>
          <div class="progress-summaries">
            <section class="surface-panel progress-summary" data-opaque-surface="true"><h2>Required activities completed</h2><p><strong>${requiredSummary}</strong></p></section>
            <section class="surface-panel progress-summary" data-opaque-surface="true"><h2>Objectives with qualifying evidence</h2><p><strong>${evidenceSummary}</strong></p></section>
            <section class="surface-panel progress-summary" data-opaque-surface="true"><h2>Reviews due</h2><p><strong>${reviewSummary}</strong></p></section>
          </div>
          <div class="st-layout">
            ${progressStudyBoardHtml}
            ${selectedDetailHtml}
          </div>
          <section class="surface-panel" data-opaque-surface="true">
            <h2>Objective evidence ledger</h2>
            <p class="meta-text">Canonical proficiency states: ${canonicalStatusesLegendHtml}</p>
            <div class="table-responsive"><table class="proficiency-table"><thead><tr><th scope="col">Objective</th><th scope="col">Proficiency status</th><th scope="col">Activity execution</th><th scope="col">Evidence</th></tr></thead><tbody>${proficiencyRowsHtml}</tbody></table></div>
          </section>
          <section class="surface-panel diagnostic-panel" data-diagnostic-session-id="${escapeHtml(diagnosticState.diagnostic_session_id)}" data-diagnostic-state="${escapeHtml(diagnosticState.state)}" data-opaque-surface="true">
            <h2>Topic Diagnostic</h2>
            <p>Sampled objectives: <code>${escapeHtml(diagnosticState.target_objective_version_ids.join(", ") || "none")}</code></p>
            <p>Assessed: <code>${escapeHtml(diagnosticState.assessed_objective_version_ids.join(", ") || "none")}</code>. Unassessed: <code>${escapeHtml(diagnosticState.unassessed_objective_version_ids.join(", ") || "none")}</code>.</p>
            <p class="prose">The effort target (maximum minutes) selects the sample and limits learner burden. The effort target is not a speed score. Reaching it does not lock or mark a response wrong.</p>
            <p class="prose">Local control: ${escapeHtml(diagnosticControl)}. Pause suspends this task view. Stop leaves unassessed objectives unknown. Continue reads the same active session.</p>
            <div class="action-row">
              <button type="button" class="btn-secondary" data-action="diagnostic-pause">Pause</button>
              <button type="button" class="btn-secondary" data-action="diagnostic-stop-early">Stop</button>
              <button type="button" class="btn-secondary" data-action="diagnostic-continue">Continue</button>
            </div>
          </section>
          <section class="surface-panel adaptation-review" data-opaque-surface="true">
            <h2>Adaptation review</h2>
            ${adaptationBody}
            <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-adaptation-diff">Open full diff</button>
          </section>
        </section>

        <section class="learn-sub-panel" id="panel-learn-resources" data-learn-panel="Resources" data-active="${isLearn && activeLearnSub === "Resources"}"${isLearn && activeLearnSub === "Resources" ? "" : " hidden"}>
          <h1 class="page-title">Resources</h1>
          <div class="resources-grid">${resourcesHtml}</div>
        </section>
      </section>

      <section class="top-level-panel" id="panel-explore" data-top-panel="Explore" data-active="${activeTopLevel === "Explore"}"${activeTopLevel === "Explore" ? "" : " hidden"}>
        <h1 class="page-title">Explore</h1>
        <form class="discovery-filters" role="search" aria-label="Discovery filters">
          <label class="field" for="discovery-query">Search query <input id="discovery-query" type="search" name="query"></label>
          <label class="field" for="discovery-topic">Topic <input id="discovery-topic" type="text" name="topic"></label>
          <label class="field" for="discovery-depth">Mathematical depth
            <select id="discovery-depth" name="math_depth"><option>Intuitive</option><option>Applied</option><option selected>Formal</option></select>
          </label>
          <fieldset class="choice-group"><legend>Access</legend>
            ${choiceRadio("access", "free_only", "Free-only", "Hide revisions that allow paid materials.", false)}
            ${choiceRadio("access", "paid_allowed", "Paid allowed", "Include revisions that allow paid materials.", true)}
          </fieldset>
          <fieldset class="choice-group"><legend>Ordering</legend>
            ${choiceRadio("ordering", "newest", "Newest", "Default order is the newest public revision.", true)}
            ${choiceRadio("ordering", "upvotes", "Popular upvotes", "Popular means upvotes for the displayed revision.", false)}
          </fieldset>
          <button type="button" class="btn-secondary" data-action="load-more">Load more</button>
        </form>
        ${loadMoreNote ? `<p class="prose" role="status">${escapeHtml(loadMoreNote)}</p>` : ""}
        <article class="surface-panel public-template-card" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" data-opaque-surface="true">
          <p class="warning-copy">Community publication — not automatically educationally reviewed</p>
          <h2>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.title)}</h2>
          <p class="prose">${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.summary)}</p>
          <p>Intended audience: learners studying transformer foundations. Mathematical depth: Formal. Prerequisites: tokenization before attention. Access: free learning materials, with inference priced separately. Revision ${DEFAULT_PUBLIC_CURRICULUM.revision_number}.</p>
          <p>Author: ${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publisher.display_name)}. License: <code>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_terms.content_license_id)}</code>.</p>
          <p class="meta-text">Selecting <code>public-module-attention</code> includes prerequisite <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", "))}</code>.</p>
          <div class="action-row">
            <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-partial-adoption">Use this curriculum</button>
            <button type="button" class="btn-secondary upvote-btn" data-action="toggle-upvote" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" aria-pressed="${upvoteInfo.viewerHasUpvoted}">▲ Upvote Revision (${upvoteInfo.upvoteCount ?? 0})</button>
            <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Publication preview</button>
          </div>
        </article>
        <section class="surface-panel my-publications" data-opaque-surface="true">
          <h2>My Publications</h2>
          <p class="prose">Owner state is requested with <code>Cache-Control: no-store</code> (${escapeHtml(publicationState.cachePolicy)}).</p>
          ${ownedCard ? `<p><strong>${escapeHtml(ownedCard.displayTitleText)}</strong>. State: ${escapeHtml(ownedCard.state)}. Visibility: ${escapeHtml(ownedCard.visibility)}. ${escapeHtml(ownedCard.upvoteDisplayText)}.</p>` : ""}
          <h3>Revision history</h3>
          <ol>${revisionHistoryHtml}</ol>
          <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies. Historical votes are not transferred.</p>
          <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-unpublish">Unpublish</button>
        </section>
      </section>

      <section class="top-level-panel" id="panel-settings" data-top-panel="Settings" data-active="${activeTopLevel === "Settings"}"${activeTopLevel === "Settings" ? "" : " hidden"}>
        <h1 class="page-title">Settings</h1>
        <div class="settings-stack">
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Account</h2>
            <p>Signed-in learner <code>learner-default</code>.</p>
            <p class="prose">Account-provider sign-in and payment checkout are not connected in this build. This screen does not invent a successful profile or payment response.</p>
          </section>
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Appearance</h2>
            <div class="theme-selector-group" role="group" aria-label="Theme">
              ${(["light", "dark", "system"] as const).map((mode) => `<button type="button" class="btn-secondary${themePreference === mode ? " is-active" : ""}" data-action="set-theme" data-theme-value="${mode}" aria-pressed="${themePreference === mode}">${mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}</button>`).join("\n")}
            </div>
            <label class="switch-field"><input type="checkbox" data-action="toggle-solid-surfaces"${solidSurfaces ? " checked" : ""}> Solid surfaces</label>
            <label class="switch-field"><input type="checkbox" data-action="toggle-reduce-motion"${reduceMotion ? " checked" : ""}> Reduce motion</label>
            <p class="meta-text">System reduced transparency, contrast, and motion preferences take precedence over effects.</p>
          </section>
          <section class="surface-panel settings-group" id="settings-schedule" data-opaque-surface="true">
            <h2>Reminders &amp; Schedule</h2>
            <label class="switch-field"><input type="checkbox" data-action="toggle-reminders"${remindersOn ? " checked" : ""}> Enable reminders</label>
            <p class="prose">Browser notification permission is requested only after Enable reminders. A denied or unsupported permission leaves Today and the schedule usable. Initial notification copy stays generic.</p>
            <p>Timezone: <code>${escapeHtml(reminderState.timezone)}</code> (${escapeHtml(timezoneLabel)}).</p>
            <p>Quiet hours: ${escapeHtml(reminderState.quiet_hours.start_local_time)}–${escapeHtml(reminderState.quiet_hours.end_local_time)}. Lead time ${reminderState.lead_time_minutes} min. Reminders are ${remindersPaused ? "paused" : "not paused"}.</p>
            <label class="field" for="snooze-minutes">Snooze
              <select id="snooze-minutes" name="snooze"><option>15 minutes</option><option>30 minutes</option><option>60 minutes</option></select>
            </label>
            <div class="action-row">
              <button type="button" class="btn-secondary" data-action="snooze-reminder">Snooze</button>
              <button type="button" class="btn-secondary" data-action="pause-reminders">${remindersPaused ? "Resume reminders" : "Pause"}</button>
            </div>
            ${snoozeNote ? `<p class="prose" role="status">${escapeHtml(snoozeNote)}</p>` : ""}
            <p class="prose disclosure-text">${escapeHtml(reminderState.bestEffortDeliveryDisclosure)} Snoozing or missing a session does not change assessed proficiency.</p>
            <h3>Schedule</h3>
            <ul class="schedule-list">${scheduleRowsHtml}</ul>
          </section>
          <section class="surface-panel settings-group" data-byok-mode="${escapeHtml(byokState.mode)}" data-allow-hosted-fallback="${byokState.allowHostedFallback}" data-opaque-surface="true">
            <h2>AI Connections</h2>
            <p class="prose">Mode: ${escapeHtml(byokState.mode)}. Hosted fallback is off. Saving a key does not authorize a chargeable model test. The service stores the key encrypted, identifies the provider, and the provider bills inference.</p>
            <p class="prose disclosure-text">${escapeHtml(byokState.serverCustodyDisclosure)}</p>
            <p class="prose disclosure-text">${escapeHtml(byokState.externalBillingDisclosure)}</p>
            <label class="field" for="byok-key">Provider key <span class="meta-text">Transient and optional until you replace a key</span>
              <input id="byok-key" name="provider-key" type="${keyVisible ? "text" : "password"}" autocomplete="off" spellcheck="false" data-transient-key="true" value="">
            </label>
            <button type="button" class="btn-secondary" data-action="toggle-key-visibility">${keyVisible ? "Hide" : "Show"}</button>
            <ul class="credential-list">
              ${byokState.credentials.map((cred) => `<li class="credential-item" data-credential-ref="${escapeHtml(cred.credential_ref)}" data-provider-id="${escapeHtml(cred.provider_id)}">
                <p><strong>${escapeHtml(cred.label ?? cred.provider_id)}</strong> <code>${escapeHtml(cred.masked_hint)}</code> <span class="badge">${escapeHtml(cred.status)}</span></p>
                <p class="meta-text">Provider <code>${escapeHtml(cred.provider_id)}</code>. Version <code>${escapeHtml(cred.etag ?? "")}</code>. Updated ${escapeHtml(cred.updated_at ?? "unknown")}. The saved secret is not shown again.</p>
                <div class="action-row">
                  <button type="button" class="btn-secondary" data-action="replace-key" data-credential-ref="${escapeHtml(cred.credential_ref)}">Replace key</button>
                  <button type="button" class="btn-danger" data-action="delete-connection" data-credential-ref="${escapeHtml(cred.credential_ref)}">Delete connection</button>
                </div>
                <p class="prose">Replace key submits a new transient value and does not move queued jobs to another account. Delete connection removes this app's encrypted copy. It does not revoke the key at the issuer.</p>
              </li>`).join("\n")}
            </ul>
            ${keyActionNote ? `<p class="prose" role="status">${escapeHtml(keyActionNote)}</p>` : ""}
          </section>
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Usage &amp; Billing</h2>
            ${costBreakdown.byokEstimateDisclaimer ? `<p class="prose disclosure-text">${escapeHtml(costBreakdown.byokEstimateDisclaimer)}</p>` : ""}
            <p>Available hosted balance: <strong>${formatMinorCurrency(billingState.wallet.available_minor, billingState.wallet.currency)}</strong>. Reserved ceiling hold: <strong>${formatMinorCurrency(billingState.wallet.reserved_minor, billingState.wallet.currency)}</strong>.</p>
            <div class="four-bucket-grid">${fourBucketsHtml}</div>
          </section>
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Privacy</h2>
            <p class="prose">Export includes ${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}. Export excludes ${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}.</p>
            <p class="prose warning-copy">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
            <p class="prose warning-copy">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
            <p class="prose">${escapeHtml(privacyState.disclosures.financialAuditRetention)}</p>
            <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-account-deletion">Export &amp; deletion</button>
          </section>
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>About / Terms</h2>
            <p class="prose">This software is source-available. An individual may self-host it for personal use. Organizational deployment is not permitted. This screen does not offer an organization switcher, classroom dashboard, or enterprise plan.</p>
          </section>
        </div>
      </section>
    </main>
  </div>
  <nav class="compact-bottom-nav nav-chrome-glass" aria-label="Compact mobile navigation">${bottomNavHtml}</nav>

  <dialog id="dialog-new-curriculum" closedby="any" aria-labelledby="dialog-new-curriculum-title" data-opaque-surface="true"${dialogOpen("dialog-new-curriculum")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-new-curriculum-title">New Curriculum &amp; Preferences</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p class="prose">Goal and scope → Background and approach → Time and access → Review and generate</p>
      <section>
        <h3>Goal and scope</h3>
        <label class="field" for="intake-goal">What do you want to learn? <span class="meta-text">Required</span>
          <input id="intake-goal" name="goal" type="text" autocomplete="off" autofocus>
        </label>
        <label class="field" for="intake-use">Intended use <span class="meta-text">Optional</span>
          <input id="intake-use" name="intended-use" type="text" autocomplete="off" placeholder="Building applications, foundations, or research">
        </label>
        <p class="prose">A broad goal opens editable scope choices. A finite catalog plan is not exhaustive. Included and excluded topics stay visible before generation.</p>
      </section>
      <section>
        <h3>Background and approach</h3>
        <fieldset class="choice-group">
          <legend>What I already know</legend>
          <ul class="knowledge-list">
            <li>Linear algebra: introductory matrix operations demonstrated <button type="button" class="btn-secondary" data-action="view-evidence" data-evidence-topic="linear-algebra">View evidence</button></li>
            <li>Matrix calculus: not assessed <button type="button" class="btn-secondary" data-action="check-prerequisites">Check prerequisites</button></li>
          </ul>
          <p class="prose">Claims and observations stay separate from assessed proficiency. Editing this self-report does not change assessed evidence.</p>
        </fieldset>
        <fieldset class="choice-group">
          <legend>Mathematical depth</legend>
          ${choiceRadio("math-depth", "intuitive", "Intuitive", "Conceptual explanations with necessary mathematical ideas.", false)}
          ${choiceRadio("math-depth", "applied", "Applied", "Mathematics used for implementation and evaluation.", false)}
          ${choiceRadio("math-depth", "formal", "Formal", "Relevant assumptions, derivations, and proof or mathematical reasoning where appropriate. Proofs are not promised for every engineering activity.", true)}
          <p>Inherited: Tokenization — Formal. This follows the global default.</p>
          <p>${depthOverrideReset ? "Matrix calculus override removed. Inherited depth follows the global default." : "Override: Matrix calculus — Formal."}</p>
          <label class="field" for="topic-depth-override">Per-topic override <span class="meta-text">Optional</span>
            <select id="topic-depth-override" name="topic-depth-override"><option>Matrix calculus — Formal</option></select>
          </label>
          <button type="button" class="btn-secondary" data-action="reset-depth-override">Reset to default</button>
        </fieldset>
        <fieldset class="choice-group">
          <legend>How I want to start</legend>
          ${choiceRadio("start-order", "theory_first", "Theory first", "Instruction begins with the formal treatment.", false)}
          ${choiceRadio("start-order", "application_first", "Application first", "An early working example can precede formal derivation. This is compatible with Formal depth.", true)}
          ${choiceRadio("start-order", "balanced", "Balanced", "Theory and application alternate. This is instructional order, not a learning-style diagnosis.", false)}
        </fieldset>
        <fieldset class="choice-group">
          <legend>Familiar material</legend>
          ${choiceRadio("familiar-material", "condense", "Condense", "Shorter treatment of familiar material.", false)}
          ${choiceRadio("familiar-material", "retain_full", "Keep full treatment", "Retain the full explanation.", false)}
          ${choiceRadio("familiar-material", "skip_if_demonstrated", "Skip only when demonstrated", "Skip only when qualifying evidence exists.", true)}
        </fieldset>
      </section>
      <section>
        <h3>Time and access</h3>
        <label class="field" for="weekly-minutes">Weekly minutes <span class="meta-text">Required</span>
          <input id="weekly-minutes" name="weekly-minutes" type="text" value="120">
        </label>
        <p>Timezone: America/New_York (Eastern Time). Deadline: <span class="meta-text">Optional</span> none set.</p>
        <fieldset class="choice-group"><legend>Materials access</legend>
          ${choiceRadio("materials-access", "free_only", "Free-only", "Use free learning materials only.", false)}
          ${choiceRadio("materials-access", "paid_allowed", "Paid allowed", "Paid materials stay separate from inference charges.", true)}
        </fieldset>
        <p class="prose warning-copy">Service fees, hosted inference, externally billed BYOK inference, learning materials, certification, and compute stay distinct. Free materials do not imply free generation. An unknown merchant price stays Price unknown (verify externally), not $0.00.</p>
      </section>
      <section>
        <h3>Review and generate</h3>
        <ul>
          <li>Mathematical depth: Formal, with Matrix calculus ${depthOverrideReset ? "inherited" : "overridden"}.</li>
          <li>Start: Application first.</li>
          <li>Familiar material: Skip only when demonstrated.</li>
          <li>Linear algebra: introductory matrix operations demonstrated. Matrix calculus: not assessed.</li>
        </ul>
        <p class="prose">Generating a draft does not activate the plan, schedule reminders, or start a charge.</p>
        <button type="button" class="btn-primary" data-action="review-generate">Review and generate</button>
        ${intakeNote ? `<p class="prose" role="status">${escapeHtml(intakeNote)}</p>` : ""}
      </section>
    </form>
  </dialog>

  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title" data-opaque-surface="true"${dialogOpen("dialog-adaptation-diff")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      ${adaptationBody}
    </form>
  </dialog>

  <dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title" data-opaque-surface="true"${dialogOpen("dialog-partial-adoption")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-partial-adoption-title">Partial Curriculum Adoption &amp; Prerequisite Closure</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Requested Module: <code>${escapeHtml(partialAdoptionScope.requestedModuleIds.join(", "))}</code></p>
      <p>Auto-Included Prerequisite Modules: <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", ") || "none")}</code></p>
      <p>Resolved Module Scope: <code>${escapeHtml(partialAdoptionScope.resolvedModuleIds.join(" → "))}</code></p>
      <p class="prose">Use this curriculum personalizes a private draft. It copies no author evidence, progress, votes, key, or spending authority. Deterministic adoption is $0.00 AI inference and does not activate the plan.</p>
    </form>
  </dialog>

  <dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title" data-opaque-surface="true"${dialogOpen("dialog-publication-preview")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-publication-preview-title">Publication Preview &amp; Private Field Redaction</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Preview ID: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.preview_id)}</code>. Visibility: Public — appears in discovery and can be read by others. Unlisted — anyone with the link can read it; excluded from app-controlled discovery. Unlisted does not mean confidential.</p>
      <p>Excluded Private Fields (Never Published): <code>${escapeHtml(publicationState.excludedPrivateFields.join(", "))}</code></p>
      <p>Terms Policy: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms_policy_id)}</code> (${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms.content_license_id)})</p>
    </form>
  </dialog>

  <dialog id="dialog-unpublish" closedby="any" aria-labelledby="dialog-unpublish-title" data-opaque-surface="true"${dialogOpen("dialog-unpublish")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-unpublish-title">Unpublish</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies.</p>
      <p class="prose">This screen does not call a live unpublish route and does not report success.</p>
    </form>
  </dialog>

  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title" data-opaque-surface="true"${dialogOpen("dialog-account-deletion")}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Export Scope Included: <code>${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}</code></p>
      <p>Export Scope Excluded: <code>${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}</code></p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.financialAuditRetention)} Deletion does not promise immediate removal from every backup.</p>
    </form>
  </dialog>

  <script data-dialog-light-dismiss-fallback="true">
${getDialogLightDismissFallbackScript()}
  </script>
</div>`;
}
export function createCurriculumWebAppController(initialState: CurriculumWebAppStateInput = {}) {
  let topLevel: TopLevelDestination = initialState.topLevel ?? "Learn";
  let learnSubDestination: LearnSubDestination = initialState.learnSubDestination ?? "Today";
  let planView: PlanSynchronizedView = initialState.planView ?? "Map";
  let selectedModuleId: string | null = initialState.selectedModuleId ?? "module-foundations";
  let selectedActivityId: string | null = initialState.selectedActivityId ?? "activity-theory";
  let focusedNodeId: string | null = initialState.focusedNodeId ?? selectedModuleId;
  let zoom = initialState.zoom ?? 1;
  const viewportWidthPx = initialState.viewportWidthPx ?? 1280;
  const textScalePercent = initialState.textScalePercent ?? 100;
  let themePreference: ThemePreference = initialState.themePreference ?? "light";
  let solidSurfaces = initialState.solidSurfaces ?? false;
  let reduceMotion = initialState.reduceMotion ?? false;
  let hintRequested = initialState.hintRequested ?? false;
  let workedSolutionRevealed = initialState.workedSolutionRevealed ?? false;
  let practiceSubmitted = initialState.practiceSubmitted ?? false;
  let practiceChoice: string | null = initialState.practiceChoice ?? null;
  let studyAheadActivityId: string | null = initialState.studyAheadActivityId ?? null;
  const skippedActivityIds: string[] = [...(initialState.skippedActivityIds ?? [])];
  let remindersEnabled = initialState.remindersEnabled ?? true;
  let remindersPaused = initialState.remindersPaused ?? false;
  let keyVisible = initialState.keyVisible ?? false;
  let diagnosticControl: "active" | "paused" | "stopped" = initialState.diagnosticControl ?? "active";
  let adaptationChoice: "pending" | "accept_reviewed" | "keep_current" = initialState.adaptationChoice ?? "pending";
  let loadMoreNote: string | null = initialState.loadMoreNote ?? null;
  let intakeNote: string | null = initialState.intakeNote ?? null;
  let keyActionNote: string | null = initialState.keyActionNote ?? null;
  let snoozeNote: string | null = initialState.snoozeNote ?? null;
  let rescheduleSessionId: string | null = initialState.rescheduleSessionId ?? null;
  let rescheduleValue: string | null = initialState.rescheduleValue ?? null;
  let depthOverrideReset = initialState.depthOverrideReset ?? false;
  let studyDetailOpen = initialState.studyDetailOpen ?? false;
  const adoptedSelectedModuleIds: string[] = [...(initialState.adoptedSelectedModuleIds ?? ["public-module-attention"])];
  let upvotedRevisionIds: string[] = [...(initialState.upvotedRevisionIds ?? [])];
  let openDialogId: string | null = initialState.openDialogId ?? null;

  const curriculum = initialState.curriculum ?? DEFAULT_SYNTHETIC_CURRICULUM;
  const schedule = initialState.schedule ?? DEFAULT_SYNTHETIC_SCHEDULE;
  const proficiency = initialState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const catalogResources = initialState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;

  const todayController = createTodayViewController({
    curriculum, schedule, proficiency, catalogResources,
    ...(initialState.activityStates ? { initialActivityStates: initialState.activityStates } : {}),
  });

  const recordedProgressEvents: ProgressEventInput[] = [];
  for (const ev of initialState.recordedProgressEvents ?? []) {
    recordedProgressEvents.push(ev);
    todayController.recordProgressEvent(ev);
  }

  const buildCurrentPlanModel = (): PlanMapAndOutlineModel =>
    buildPlanMapAndOutlineModel({
      curriculum, proficiency, activityStates: todayController.getState().activityExecutionStates,
      catalogResources, viewportWidthPx, selectedModuleId, selectedActivityId, focusedNodeId, zoom,
    });

  const getState = () => {
    const tState = todayController.getState();
    return {
      topLevel, learnSubDestination, planView, selectedModuleId, selectedActivityId, focusedNodeId,
      zoom, viewportWidthPx, textScalePercent, themePreference, solidSurfaces, reduceMotion,
      activityStates: tState.activityExecutionStates,
      recordedProgressEvents: [...recordedProgressEvents] as readonly ProgressEventInput[],
      recordedReceipts: tState.recordedEvents,
      totalStudyMinutes: tState.totalStudyMinutes,
      selfReportedCompletedCount: tState.selfReportedCompletedCount,
      adoptedSelectedModuleIds: [...adoptedSelectedModuleIds] as readonly string[],
      upvotedRevisionIds: [...upvotedRevisionIds] as readonly string[],
      openDialogId, hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice,
      studyAheadActivityId, skippedActivityIds: [...skippedActivityIds] as readonly string[],
      remindersEnabled, remindersPaused, keyVisible, diagnosticControl, adaptationChoice,
      loadMoreNote, intakeNote, keyActionNote, snoozeNote, rescheduleSessionId, rescheduleValue,
      depthOverrideReset, studyDetailOpen,
    };
  };

  return {
    getState,
    renderHtml: (): string => {
      const { activityStates: _a, ...restState } = getState();
      return renderCurriculumWebAppHtml({ ...initialState, ...restState });
    },
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
      studyDetailOpen = true;
      const matchedMod = buildCurrentPlanModel().outlineModules.find((m) => m.moduleId === moduleId);
      if (matchedMod?.activityIds.length && (!selectedActivityId || !matchedMod.activityIds.includes(selectedActivityId))) {
        selectedActivityId = matchedMod.activityIds[0] ?? null;
      }
      return getState();
    },
    selectPlanActivity(activityId: string, explicitModuleId?: string, _sourceView?: PlanSynchronizedView) {
      selectedActivityId = activityId;
      studyDetailOpen = true;
      const targetModId =
        explicitModuleId ?? buildCurrentPlanModel().outlineModules.find((m) => m.activityIds.includes(activityId))?.moduleId;
      if (targetModId) {
        selectedModuleId = targetModId;
        focusedNodeId = targetModId;
      }
      return getState();
    },
    applyMapControl(control: MapNonDraggingControl) {
      zoom =
        control === "zoom_in" ? clamp(Number((zoom + 0.25).toFixed(2)), 0.5, 2)
        : control === "zoom_out" ? clamp(Number((zoom - 0.25).toFixed(2)), 0.5, 2) : 1;
      return getState();
    },
    navigateMapKeyboard(key: MapKeyboardKey) {
      const nextModel = buildCurrentPlanModel().navigateKeyboard(key, focusedNodeId ?? undefined);
      focusedNodeId = nextModel.focusedNodeId;
      if (nextModel.selectedModuleId) selectedModuleId = nextModel.selectedModuleId;
      if (nextModel.selectedActivityId) selectedActivityId = nextModel.selectedActivityId;
      return getState();
    },
    recordTodayActivityCompletion(activityId: string, explicitEventId?: string): RecordedProgressEventReceipt {
      const eventId = explicitEventId ?? `evt-complete-${activityId}`;
      const ev: ProgressEventInput = { eventId, activityId, type: "self_reported_completed" };
      if (!recordedProgressEvents.some((e) => (e.eventId ?? e.event_id) === eventId)) {
        recordedProgressEvents.push(ev);
      }
      return todayController.recordProgressEvent(ev);
    },
    setThemePreference(theme: ThemePreference) {
      themePreference = theme;
      return getState();
    },
    toggleUpvote(publicationRevisionId = DEFAULT_PUBLIC_CURRICULUM.publication_revision_id) {
      upvotedRevisionIds = upvotedRevisionIds.includes(publicationRevisionId)
        ? upvotedRevisionIds.filter((id) => id !== publicationRevisionId)
        : [...upvotedRevisionIds, publicationRevisionId];
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
    applyUiAction(action: string, data: Readonly<Record<string, string | undefined>> = {}, submittedChoice: string | null = null) {
      let handled = true;
      if (action === "close-study-detail") studyDetailOpen = false;
      else if (action === "toggle-solid-surfaces") solidSurfaces = !solidSurfaces;
      else if (action === "toggle-reduce-motion") reduceMotion = !reduceMotion;
      else if (action === "request-hint") hintRequested = true;
      else if (action === "study-worked-solution") workedSolutionRevealed = true;
      else if (action === "submit-practice") {
        practiceSubmitted = true;
        practiceChoice = submittedChoice;
      } else if (action === "study-ahead" && data["activityId"]) studyAheadActivityId = data["activityId"];
      else if (action === "skip-activity" && data["activityId"]) {
        const activityId = data["activityId"];
        if (!skippedActivityIds.includes(activityId)) skippedActivityIds.push(activityId);
      } else if (action === "diagnostic-pause") diagnosticControl = "paused";
      else if (action === "diagnostic-stop-early") diagnosticControl = "stopped";
      else if (action === "diagnostic-continue") diagnosticControl = "active";
      else if (action === "accept-revision") adaptationChoice = "accept_reviewed";
      else if (action === "keep-current-plan") adaptationChoice = "keep_current";
      else if (action === "toggle-reminders") remindersEnabled = !remindersEnabled;
      else if (action === "pause-reminders") remindersPaused = !remindersPaused;
      else if (action === "snooze-reminder") snoozeNote = "Snooze does not change assessed proficiency. Delivery stays best effort.";
      else if (action === "toggle-key-visibility") keyVisible = !keyVisible;
      else if (action === "replace-key") keyActionNote = "Replace key keeps the new value transient. Queued jobs stay on the current key version. No key was stored by this screen.";
      else if (action === "delete-connection") keyActionNote = "Delete connection would remove this app's encrypted copy only. It would not revoke the key at the issuer. No live delete was sent.";
      else if (action === "load-more") loadMoreNote = "No further public revisions are available in this preview.";
      else if (action === "reschedule-session" && data["sessionId"]) {
        rescheduleSessionId = data["sessionId"];
        rescheduleValue = data["rescheduleValue"] ?? "";
      } else if (action === "reset-depth-override") depthOverrideReset = true;
      else if (action === "review-generate") intakeNote = "Review recorded. Generation was not started and the plan was not activated. Chargeable inference needs a separate authorization.";
      else if (action === "view-evidence" || action === "check-prerequisites") handled = true;
      else handled = false;
      return { handled, state: getState() };
    },
  };
}
export type CurriculumWebAppController = ReturnType<typeof createCurriculumWebAppController>;
export type CurriculumWebAppResolvedState = ReturnType<CurriculumWebAppController["getState"]>;

export interface MountableRootElement {
  innerHTML: string;
  querySelector?: (selector: string) => unknown;
  querySelectorAll?: (selector: string) => Iterable<unknown>;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

export function mountCurriculumWebApp(
  rootElement: MountableRootElement,
  initialState: CurriculumWebAppStateInput = {},
): CurriculumWebAppController {
  const controller = createCurriculumWebAppController(initialState);

  function bindDialogs(): void {
    if (typeof rootElement.querySelectorAll !== "function") return;
    const dialogs = Array.from(rootElement.querySelectorAll('dialog[closedby="any"]')) as Array<{
      close?: () => void;
      getBoundingClientRect?: () => { top: number; left: number; width: number; height: number };
      addEventListener?: (type: string, listener: (ev: { target?: unknown; clientX?: number; clientY?: number }) => void) => void;
    }>;

    const supportsClosedBy =
      typeof globalThis.HTMLDialogElement !== "undefined" && "closedBy" in globalThis.HTMLDialogElement.prototype;

    if (!supportsClosedBy) {
      for (const dialog of dialogs) {
        dialog.addEventListener?.("click", (event) => {
          if (event.target !== dialog || typeof dialog.getBoundingClientRect !== "function") return;
          const rect = dialog.getBoundingClientRect();
          const clientX = event.clientX ?? -1;
          const clientY = event.clientY ?? -1;
          const inContent =
            rect.top <= clientY && clientY <= rect.top + rect.height && rect.left <= clientX && clientX <= rect.left + rect.width;
          if (!inContent) {
            dialog.close?.();
            controller.closeDialog();
          }
        });
      }
    }
  }

  function syncDom(): void {
    rootElement.innerHTML = controller.renderHtml();
    bindDialogs();
    const activeDialogId = controller.getState().openDialogId;
    if (activeDialogId && typeof rootElement.querySelector === "function") {
      const dialogEl = rootElement.querySelector(`#${activeDialogId}`) as { open?: boolean; showModal?: () => void } | null;
      if (dialogEl && typeof dialogEl.showModal === "function" && !dialogEl.open) {
        try {
          dialogEl.showModal();
        } catch {
          // Synthetic DOM fallback: [open] attribute is already set.
        }
      }
    }
  }

  syncDom();

  rootElement.addEventListener?.("click", (rawEvent: unknown) => {
    const ev = rawEvent as {
      target?: { closest?: (s: string) => { dataset?: Record<string, string | undefined> } | null } | null;
      preventDefault?: () => void;
    };
    const ds = ev.target?.closest?.("[data-action]")?.dataset;
    if (!ds) return;
    const action = ds["action"];

    if (action === "navigate-top" && ds["destination"]) controller.navigateTopLevel(ds["destination"] as TopLevelDestination);
    else if (action === "navigate-learn-sub" && ds["subDestination"]) controller.navigateLearnSubDestination(ds["subDestination"] as LearnSubDestination);
    else if (action === "switch-plan-view" && ds["planView"]) controller.switchPlanView(ds["planView"] as PlanSynchronizedView);
    else if (action === "select-map-node") {
      const modId = ds["moduleId"] ?? ds["nodeId"];
      if (!modId) return;
      controller.selectPlanModule(modId, "Map");
    } else if (action === "select-outline-module" && ds["moduleId"]) controller.selectPlanModule(ds["moduleId"], "Outline");
    else if (action === "select-outline-activity" && ds["activityId"]) controller.selectPlanActivity(ds["activityId"], ds["moduleId"], "Outline");
    else if (action === "map-control" && ds["mapControl"]) controller.applyMapControl(ds["mapControl"] as MapNonDraggingControl);
    else if (action === "complete-activity" && ds["activityId"]) controller.recordTodayActivityCompletion(ds["activityId"], ds["eventId"]);
    else if (action === "set-theme" && ds["themeValue"]) controller.setThemePreference(ds["themeValue"] as ThemePreference);
    else if (action === "toggle-upvote") controller.toggleUpvote(ds["revisionId"]);
    else if (action === "open-dialog" && ds["dialogId"]) controller.openDialog(ds["dialogId"]);
    else if (action === "close-dialog") {
      ev.preventDefault?.();
      controller.closeDialog();
    } else {
      const data: Record<string, string | undefined> = { ...ds };
      if (action === "submit-practice" && typeof rootElement.querySelector === "function") {
        const checked = rootElement.querySelector('input[name="practice-choice"]:checked') as { value?: string } | null;
        data["practiceChoice"] = checked?.value;
      }
      if (action === "reschedule-session" && ds["sessionId"] && typeof rootElement.querySelector === "function") {
        const input = rootElement.querySelector(`[data-reschedule-for="${ds["sessionId"]}"]`) as { value?: string } | null;
        data["rescheduleValue"] = input?.value ?? "";
      }
      const submittedChoice = data["practiceChoice"] ?? null;
      if (!action || !controller.applyUiAction(action, data, submittedChoice).handled) return;
    }
    syncDom();
  });

  rootElement.addEventListener?.("keydown", (rawEvent: unknown) => {
    const ev = rawEvent as { key?: string; target?: { closest?: (s: string) => unknown } | null; preventDefault?: () => void };
    if (
      ev.key && ev.target?.closest?.(".map-node") &&
      (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter")
    ) {
      ev.preventDefault?.();
      controller.navigateMapKeyboard(ev.key as MapKeyboardKey);
      syncDom();
    }
  });

  const withSync =
    <Args extends unknown[], R>(fn: (...args: Args) => R) =>
    (...args: Args): R => {
      const res = fn(...args);
      syncDom();
      return res;
    };

  return {
    getState: () => controller.getState(),
    renderHtml: () => controller.renderHtml(),
    navigateTopLevel: withSync(controller.navigateTopLevel),
    navigateLearnSubDestination: withSync(controller.navigateLearnSubDestination),
    switchPlanView: withSync(controller.switchPlanView),
    selectPlanModule: withSync(controller.selectPlanModule),
    selectPlanActivity: withSync(controller.selectPlanActivity),
    applyMapControl: withSync(controller.applyMapControl),
    navigateMapKeyboard: withSync(controller.navigateMapKeyboard),
    recordTodayActivityCompletion: withSync(controller.recordTodayActivityCompletion),
    setThemePreference: withSync(controller.setThemePreference),
    toggleUpvote: withSync(controller.toggleUpvote),
    openDialog: withSync(controller.openDialog),
    closeDialog: withSync(controller.closeDialog),
    applyUiAction: withSync(controller.applyUiAction),
  };
}

