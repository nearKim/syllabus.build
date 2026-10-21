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
  type HostedCreditWalletSnapshot, type OwnedPublicationItem, type PublicCurriculumPayload, type PublicationPreviewPayload,
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
  | "check" | "status-done" | "status-open" | "status-progress" | "status-review";

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
  "status-done": `<circle cx="8" cy="8" r="5.25"/><path d="M5.2 8.2 7.15 10.15 10.9 6"/>`,
  "status-open": `<circle cx="8" cy="8" r="5.25"/>`,
  "status-progress": `<circle cx="8" cy="8" r="5.25"/><path d="M8 4.7V8l2.2 1.35"/>`,
  "status-review": `<circle cx="8" cy="8" r="5.25"/><path d="M8 5.15v3.2M8 11.05h.01"/>`,
};

function sfIcon(name: SfIconName, size: 15 | 16 = 16): string {
  return `<svg class="sf-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SF_ICON_PATHS[name]}</svg>`;
}

function statusIconName(status: string): SfIconName {
  if (status === "completed" || status === "self_reported_completed") return "status-done";
  if (status === "in_progress") return "status-progress";
  if (status === "needs_review") return "status-review";
  return "status-open";
}

function statusMark(status: string): string {
  const tone = status === "completed" || status === "self_reported_completed" ? " is-done" : status === "in_progress" ? " is-progress" : "";
  return `<span class="status-icon${tone}">${sfIcon(statusIconName(status), 15)}<span class="visually-hidden">${escapeHtml(status)}</span></span>`;
}

function durationPill(minutes: number, title?: string): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="duration-pill"${titleAttr}>${minutes}m</span>`;
}

function disclosure(summary: string, body: string): string {
  return `<details class="minimal-disclosure"><summary>${escapeHtml(summary)}</summary>${body}</details>`;
}

function renderTopDestButton(dest: TopLevelDestination, className: string, isCurrent: boolean): string {
  const icon: SfIconName = dest === "Learn" ? "learn" : dest === "Explore" ? "explore" : "settings";
  return `<button type="button" class="${className}${isCurrent ? " is-active" : ""}" data-action="navigate-top" data-destination="${dest}" aria-current="${isCurrent ? "page" : "false"}">${sfIcon(icon, 16)}<span>${dest}</span></button>`;
}

function renderLearnSubButton(sub: LearnSubDestination, isCurrent: boolean): string {
  const icon: SfIconName = sub === "Today" ? "today" : sub === "Plan" ? "plan" : sub === "Progress" ? "progress" : "resources";
  return `<button type="button" class="nav-sub-btn${isCurrent ? " is-active" : ""}" data-action="navigate-learn-sub" data-sub-destination="${sub}" aria-current="${isCurrent ? "page" : "false"}">${sfIcon(icon, 16)}<span>${sub}</span></button>`;
}

function renderMapControl(control: "zoom_in" | "zoom_out" | "fit_view" | "reset_focus", label: string, icon: SfIconName): string {
  return `<button type="button" class="btn-secondary map-control-btn" data-action="map-control" data-map-control="${control}" aria-label="${label}" title="${label}">${sfIcon(icon, 16)}</button>`;
}

function diagramTitle(title: string, max = 28): string {
  const stripped = title.replace(/^Module\s+\d+:\s*/i, "");
  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}

function topicLabel(topicId: string): string {
  return topicId
    .replace(/^topic-/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function shortSessionLabel(startAt: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return startAt.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date);
}

function renderSessionFlowSvg(
  steps: readonly { readonly label: string; readonly done: boolean; readonly active: boolean }[],
  studyMinutes: number,
  plannedMinutes: number,
): string {
  const ringR = 50;
  const ringC = 2 * Math.PI * ringR;
  const ratio = plannedMinutes > 0 ? Math.min(1, Math.max(0, studyMinutes / plannedMinutes)) : 0;
  const filled = ratio * ringC;
  const ringCx = 86;
  const ringCy = 84;
  const count = Math.max(steps.length, 1);
  const startX = 248;
  const endX = 664;
  const span = count === 1 ? 0 : (endX - startX) / (count - 1);
  const nodeY = 72;
  const nodes = steps.map((step, index) => {
    const cx = Math.round(startX + span * index);
    const fill = step.done ? "var(--color-accent)" : step.active ? "var(--color-accent-surface)" : "var(--color-surface)";
    const stroke = step.done ? "none" : "var(--color-border-control)";
    const mark = step.done
      ? `<path d="M${cx - 6} ${nodeY} l4 4 8-8" fill="none" stroke="var(--color-surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      : step.active
        ? `<circle cx="${cx}" cy="${nodeY}" r="3.5" fill="var(--color-accent)" stroke="none"/>`
        : "";
    const connector = index === 0 ? "" : `<line x1="${Math.round(startX + span * (index - 1) + 22)}" y1="${nodeY}" x2="${cx - 22}" y2="${nodeY}" stroke="${steps[index - 1]?.done ? "var(--color-accent)" : "var(--color-border-control)"}" stroke-width="1.5" stroke-linecap="round"/>`;
    return `${connector}<g><circle cx="${cx}" cy="${nodeY}" r="18" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${mark}<text x="${cx}" y="112" text-anchor="middle" fill="var(--color-text-primary)" font-size="13" font-weight="600" font-family="var(--font-sans)">${escapeHtml(step.label)}</text></g>`;
  }).join("");
  const aria = `Session flow and study ring. ${steps.map((step) => `${step.label} ${step.done ? "complete" : "open"}`).join(", ")}. ${studyMinutes} study minutes of ${plannedMinutes} planned.`;
  return `<svg class="session-flow-svg" role="img" aria-label="${escapeHtml(aria)}" viewBox="0 0 720 148" width="100%"><circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="var(--color-border-subtle)" stroke-width="8"/>${filled > 0 ? `<circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="var(--color-accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${(ringC - filled).toFixed(2)}" transform="rotate(-90 ${ringCx} ${ringCy})"/>` : ""}<text x="${ringCx}" y="80" text-anchor="middle" fill="var(--color-text-primary)" font-size="28" font-weight="600" font-family="var(--font-sans)">${studyMinutes}</text><text x="${ringCx}" y="100" text-anchor="middle" fill="var(--color-text-secondary)" font-size="12" font-weight="600" font-family="var(--font-sans)">min</text>${nodes}</svg>`;
}

function renderProficiencyPartitionSvg(
  topics: readonly { readonly label: string; readonly demonstrated: number; readonly total: number }[],
): string {
  const demonstrated = topics.reduce((sum, topic) => sum + topic.demonstrated, 0);
  const total = topics.reduce((sum, topic) => sum + topic.total, 0);
  const ratio = total > 0 ? Math.min(1, demonstrated / total) : 0;
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const filled = ratio * ringC;
  const height = Math.max(176, 40 + topics.length * 48);
  const ringCy = Math.round(height / 2);
  const rows = topics.map((topic, index) => {
    const y = 28 + index * 48;
    const frac = topic.total > 0 ? Math.min(1, topic.demonstrated / topic.total) : 0;
    const track = 280;
    const demoW = frac <= 0 ? 0 : Math.max(10, Math.round(track * frac));
    return `<g><text x="168" y="${y + 13}" fill="var(--color-text-primary)" font-size="13" font-weight="600" font-family="var(--font-sans)">${escapeHtml(topic.label)}</text><rect x="328" y="${y}" width="${track}" height="16" rx="8" fill="var(--color-surface-secondary)"/>${demoW > 0 ? `<rect x="328" y="${y}" width="${demoW}" height="16" rx="8" fill="var(--color-success-text)"/>` : ""}<text x="656" y="${y + 13}" text-anchor="end" fill="var(--color-text-secondary)" font-size="12" font-weight="600" font-family="var(--font-sans)">${topic.demonstrated}/${topic.total}</text></g>`;
  }).join("");
  const aria = `Proficiency and diagnostic partition. Demonstrated ${demonstrated} of ${total}. Unassessed ${Math.max(0, total - demonstrated)}.`;
  return `<svg class="proficiency-partition-svg" role="img" aria-label="${escapeHtml(aria)}" viewBox="0 0 680 ${height}" width="100%"><circle cx="78" cy="${ringCy}" r="${ringR}" fill="none" stroke="var(--color-border-subtle)" stroke-width="8"/>${filled > 0 ? `<circle cx="78" cy="${ringCy}" r="${ringR}" fill="none" stroke="var(--color-success-text)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${(ringC - filled).toFixed(2)}" transform="rotate(-90 78 ${ringCy})"/>` : ""}<text x="78" y="${ringCy + 4}" text-anchor="middle" fill="var(--color-text-primary)" font-size="16" font-weight="600" font-family="var(--font-sans)">${demonstrated}/${total}</text><circle cx="40" cy="${height - 18}" r="4" fill="var(--color-success-text)"/><text x="50" y="${height - 14}" fill="var(--color-text-secondary)" font-size="11" font-family="var(--font-sans)">Demonstrated</text><circle cx="138" cy="${height - 18}" r="4" fill="var(--color-border-subtle)"/><text x="148" y="${height - 14}" fill="var(--color-text-secondary)" font-size="11" font-family="var(--font-sans)">Unassessed</text>${rows}</svg>`;
}

function renderWalletGaugeSvg(
  availableMinor: number,
  reservedMinor: number,
  buckets: readonly { readonly id: string; readonly label: string; readonly knownMinor: number; readonly unknown: boolean; readonly amountLabel: string }[],
): string {
  const available = Math.max(0, availableMinor);
  const reserved = Math.max(0, reservedMinor);
  const walletTotal = available + reserved;
  const ratio = walletTotal > 0 ? available / walletTotal : 0;
  const ringR = 48;
  const ringC = 2 * Math.PI * ringR;
  const filled = Math.min(1, Math.max(0, ratio)) * ringC;
  const maxMinor = Math.max(1, ...buckets.map((bucket) => bucket.knownMinor));
  const rows = buckets.map((bucket, index) => {
    const y = 36 + index * 42;
    const track = 240;
    const fillW = bucket.knownMinor <= 0 ? 0 : Math.max(8, Math.round((bucket.knownMinor / maxMinor) * track));
    return `<g data-bucket-id="${escapeHtml(bucket.id)}"><text x="180" y="${y}" fill="var(--color-text-primary)" font-size="13" font-weight="600" font-family="var(--font-sans)">${escapeHtml(bucket.label)}</text><rect x="276" y="${y - 12}" width="${track}" height="14" rx="7" fill="${bucket.unknown ? "none" : "var(--color-surface-secondary)"}"${bucket.unknown ? ` stroke="var(--color-border-control)" stroke-dasharray="4 3"` : ""}/>${fillW > 0 ? `<rect x="276" y="${y - 12}" width="${fillW}" height="14" rx="7" fill="var(--color-accent)"/>` : ""}<text x="656" y="${y}" text-anchor="end" fill="var(--color-text-secondary)" font-size="12" font-weight="600" font-family="var(--font-sans)">${escapeHtml(bucket.amountLabel)}</text></g>`;
  }).join("");
  const aria = `Wallet gauge ${formatMinorCurrency(available)}. Four bucket cost bars.`;
  return `<svg class="wallet-gauge-svg" role="img" aria-label="${escapeHtml(aria)}" viewBox="0 0 680 196" width="100%"><circle cx="84" cy="98" r="${ringR}" fill="none" stroke="var(--color-border-subtle)" stroke-width="8"/>${filled > 0 ? `<circle cx="84" cy="98" r="${ringR}" fill="none" stroke="var(--color-accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${(ringC - filled).toFixed(2)}" transform="rotate(-90 84 98)"/>` : ""}<text x="84" y="96" text-anchor="middle" fill="var(--color-text-primary)" font-size="15" font-weight="600" font-family="var(--font-sans)">${escapeHtml(formatMinorCurrency(available))}</text><text x="84" y="114" text-anchor="middle" fill="var(--color-text-secondary)" font-size="11" font-weight="600" font-family="var(--font-sans)">available</text>${rows}</svg>`;
}

function renderModuleFlowSvg(
  modules: readonly { readonly id: string; readonly title: string; readonly prerequisiteIds: readonly string[] }[],
): string {
  const nodeW = 210;
  const nodeH = 56;
  const gap = 88;
  const count = Math.max(modules.length, 1);
  const width = Math.max(640, 32 + count * nodeW + Math.max(0, count - 1) * gap);
  const y = 46;
  const positions = new Map<string, number>();
  modules.forEach((mod, index) => positions.set(mod.id, 20 + index * (nodeW + gap)));
  const edges = modules.flatMap((mod) => mod.prerequisiteIds.map((predId) => {
    const x1 = positions.get(predId);
    const x2 = positions.get(mod.id);
    if (x1 === undefined || x2 === undefined) return "";
    const yMid = y + nodeH / 2;
    const start = x1 + nodeW;
    const end = x2;
    const mid = (start + end) / 2;
    return `<path d="M ${start} ${yMid} C ${mid} ${yMid}, ${mid} ${yMid}, ${end - 8} ${yMid}" fill="none" stroke="var(--color-border-control)" stroke-width="1.5" marker-end="url(#module-flow-arrow)"/>`;
  })).join("");
  const nodes = modules.map((mod) => {
    const x = positions.get(mod.id) ?? 0;
    return `<g><rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="14" fill="var(--color-surface)" stroke="var(--color-border-subtle)" stroke-width="1"/><text x="${x + nodeW / 2}" y="${y + 34}" text-anchor="middle" fill="var(--color-text-primary)" font-size="14" font-weight="600" font-family="var(--font-sans)">${escapeHtml(diagramTitle(mod.title))}</text></g>`;
  }).join("");
  const aria = `Module dependency flow. ${modules.map((mod) => diagramTitle(mod.title)).join(" to ")}.`;
  return `<svg class="module-flow-svg" role="img" aria-label="${escapeHtml(aria)}" viewBox="0 0 ${width} 148" width="100%"><defs><marker id="module-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-border-control)"/></marker></defs>${edges}${nodes}</svg>`;
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
      const strokeColor = "none";
      const strokeWidth = "0";
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
    preview: DEFAULT_PUBLICATION_PREVIEW, ownedPublications: DEFAULT_OWNED_PUBLICATIONS, theme: resolvedThemeMode,
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

  const pipelineOrder = ["theory", "worked_example", "coding"] as const;
  const pipelineLabels: Record<(typeof pipelineOrder)[number], string> = {
    theory: "Theory", worked_example: "Worked Example", coding: "Coding",
  };
  const pipelineSource = todayState.todayCards.find((card) =>
    pipelineOrder.every((type) => card.activityBreakdown.some((act) => act.type === type)),
  ) ?? todayState.todayCards[0];
  const pipelineSteps = pipelineOrder.map((type) => {
    const act = pipelineSource?.activityBreakdown.find((item) => item.type === type);
    const status = act?.executionStatus ?? "not_started";
    return {
      label: pipelineLabels[type],
      done: status === "completed" || status === "self_reported_completed",
      active: status === "in_progress",
    };
  });
  const sessionFlowSvg = renderSessionFlowSvg(pipelineSteps, todayState.totalStudyMinutes, pipelineSource?.durationMinutes ?? 0);

  const todayCardsHtml = todayState.todayCards
    .map((card) => {
      const activitiesHtml = card.activityBreakdown
        .map((act) => {
          const isCompleted = act.executionStatus === "self_reported_completed" || act.executionStatus === "completed";
          const id = escapeHtml(act.activityId);
          return `<li class="today-activity-item" data-activity-id="${id}" data-execution-status="${escapeHtml(act.executionStatus)}" data-proficiency-status="${escapeHtml(act.objectiveProficiencyStatus)}" data-opaque-surface="true">
                  <div class="activity-row">${statusMark(act.executionStatus)}<span class="activity-title">${escapeHtml(act.title)}</span>${durationPill(act.durationTriplet.point, `${act.durationTriplet.min}/${act.durationTriplet.point}/${act.durationTriplet.max} min`)}<button type="button" class="btn-primary btn-complete" data-action="complete-activity" data-activity-id="${id}" data-event-id="evt-complete-${id}" aria-pressed="${isCompleted}" aria-label="${isCompleted ? "Self-reported completed" : "Mark self-reported completed"}">${sfIcon("check", 15)}<span>${isCompleted ? "Done" : "Complete"}</span></button></div>
                  ${disclosure("Details", `<div class="two-layer-badges"><span class="badge badge-execution" data-layer="activity_execution">Activity execution: ${escapeHtml(act.executionStatus)}</span><span class="badge badge-proficiency" data-layer="objective_proficiency">Objective proficiency: ${escapeHtml(act.objectiveProficiencyStatus)} (never conflated)</span></div><p class="activity-reason">${escapeHtml(act.scheduledReason)}</p>`)}
                </li>`;
        })
        .join("\n              ");

      return `<article class="study-card today-session-card" data-session-id="${escapeHtml(card.sessionId)}" data-review-separation-valid="${card.reviewSeparation.valid}" data-opaque-surface="true">
            <header class="activity-row"><h3>${escapeHtml(shortSessionLabel(card.startAt))}</h3>${durationPill(card.durationMinutes)}</header>
            <ul class="today-activity-list">${activitiesHtml}</ul>
            ${disclosure("Schedule", `<p class="meta-text">Starts: <time datetime="${escapeHtml(card.startAt)}">${escapeHtml(card.startAt)}</time></p><span class="badge badge-review-separation" data-review-separation-valid="${card.reviewSeparation.valid}">${escapeHtml(card.reviewSeparation.separationSummary)}</span>`)}
          </article>`;
    })
    .join("\n          ");

  const outlineModulesHtml = basePlanModel.outlineModules
    .map((mod) => {
      const isSelectedMod = mod.moduleId === basePlanModel.selectedModuleId;
      const activitiesHtml = mod.activities
        .map((act) => {
          const isSelectedAct = act.activityId === basePlanModel.selectedActivityId;
          const bridgeHtml = act.prerequisiteBridgeRecommendation?.recommended
            ? `<div class="prerequisite-bridge-warning" role="status" data-mastery-gated="${act.masteryGated}"><strong>Prerequisite Bridge Warning:</strong> ${escapeHtml(act.prerequisiteBridgeRecommendation.reason)}</div>`
            : "";
          const provenanceHtml = act.resourceProvenanceCards
            .map(
              (card) => `<div class="provenance-chip" data-resource-version-id="${escapeHtml(card.resourceVersionId)}">
                <span>Publisher: <strong>${escapeHtml(card.verifiedPublisher)}</strong></span>
                <span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(card.rightsBadge.label)}</span>
                ${card.optionalCertificationBadge ? `<span class="badge badge-cert-optional">${escapeHtml(card.optionalCertificationBadge.label)}</span>` : ""}
                ${card.canonicalUrl ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="resource-link">Open verified resource</a>` : ""}
              </div>`,
            )
            .join("\n                ");

          return `<li class="outline-activity-card${isSelectedAct ? " is-selected" : ""}" data-activity-id="${escapeHtml(act.activityId)}" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${isSelectedAct}" data-opaque-surface="true">
                <div class="activity-row"><button type="button" class="row-hit" data-action="select-outline-activity" data-activity-id="${escapeHtml(act.activityId)}" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${isSelectedAct}">${statusMark(act.executionStatus)}<strong>${escapeHtml(act.title)}</strong>${durationPill(act.durationTriplet.point, `${act.durationTriplet.min}/${act.durationTriplet.point}/${act.durationTriplet.max} min`)}</button></div>
                ${disclosure("Sources", `<div class="two-layer-badges"><span class="badge badge-execution">${escapeHtml(act.executionBadge.nonColorCue)}</span><span class="badge badge-proficiency">${escapeHtml(act.objectiveProficiencyBadge.nonColorCue)}</span></div>${bridgeHtml}<div class="provenance-list">${provenanceHtml}</div>`)}
              </li>`;
        })
        .join("\n              ");

      return `<article class="study-card outline-module-card${isSelectedMod ? " is-selected" : ""}" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${isSelectedMod}" data-opaque-surface="true">
            <header class="activity-row">${statusMark(mod.executionStatus)}<h3>${escapeHtml(mod.title)}</h3>${durationPill(mod.durationTriplet.point, `Module Triplet: ${mod.durationTriplet.min}/${mod.durationTriplet.point}/${mod.durationTriplet.max} min`)}<button type="button" class="btn-secondary" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${isSelectedMod}" aria-label="${isSelectedMod ? "Selected Module" : "Select Module"}">${isSelectedMod ? "Selected" : "Select"}</button></header>
            ${disclosure("Module", `<p class="meta-text">${escapeHtml(mod.summary)}</p><span class="badge badge-triplet">Module Triplet: ${mod.durationTriplet.min}/${mod.durationTriplet.point}/${mod.durationTriplet.max} min</span>`)}
            <ul class="outline-activity-list">${activitiesHtml}</ul>
          </article>`;
    })
    .join("\n          ");

  const canonicalStatusesLegendHtml = OBJECTIVE_PROFICIENCY_BADGE_STATUSES.map(
    (st) => `<span class="badge badge-proficiency-status" data-proficiency-status="${st}">${st}</span>`,
  ).join(" ");

  const proficiencyRowsHtml = basePlanModel.objectiveTracks
    .map(
      (obj) => `<tr data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
              <td><strong>${escapeHtml(obj.title)}</strong><div class="meta-text">${escapeHtml(obj.objectiveVersionId)}</div></td>
              <td><span class="badge badge-proficiency" data-status="${escapeHtml(obj.proficiencyStatus)}">${escapeHtml(obj.proficiencyStatus)} (${escapeHtml(obj.proficiencyBadge.nonColorCue)})</span></td>
              <td><span class="badge badge-execution">${escapeHtml(obj.executionStatus)} (${escapeHtml(obj.executionBadge.nonColorCue)})</span></td>
              <td>${escapeHtml(obj.proficiencyBadge.evidenceSupport)} (${obj.proficiencyBadge.evidenceRefs.length > 0 ? escapeHtml(obj.proficiencyBadge.evidenceRefs.join(", ")) : "none"})</td>
            </tr>`,
    )
    .join("\n              ");

  const resourceCards = basePlanModel.outlineActivities
    .flatMap((a) => a.resourceProvenanceCards)
    .filter((card, idx, arr) => arr.findIndex((c) => c.resourceVersionId === card.resourceVersionId) === idx);

  const resourcesHtml = resourceCards
    .map((card) => {
      const rights = `<span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(card.rightsBadge.basis)}</span>`;
      const cert = card.optionalCertificationBadge
        ? `<span class="badge badge-cert-cost" data-optional-certification="true">Cert ${formatMinorCurrency(4900, "USD")}</span>`
        : `<span class="badge badge-cert-none">$0.00</span>`;
      const openLink = card.canonicalUrl
        ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" aria-label="Open External Source (Does Not Auto-Complete Activity)">Open</a>`
        : "";
      const detail = `<p class="meta-text">Version captured: <time datetime="${escapeHtml(card.versionTimestamp)}">${escapeHtml(card.versionTimestamp)}</time> · Access model: <strong>${escapeHtml(card.accessModel)}</strong></p><p>${escapeHtml(card.selectionRationale)}</p><p>Rights (${escapeHtml(card.rightsBadge.basis)}): ${escapeHtml(card.rightsBadge.label)}</p>${card.optionalCertificationBadge ? `<p>${escapeHtml(card.optionalCertificationBadge.label)}. Separate optional cost (${formatMinorCurrency(4900, "USD")}).</p>` : `<p>No paid certification required ($0.00 core access).</p>`}`;
      return `<article class="study-card resource-catalog-card" data-resource-version-id="${escapeHtml(card.resourceVersionId)}" data-opaque-surface="true">
            <header class="activity-row"><h3>${escapeHtml(card.title)}</h3>${rights}${cert}${openLink}</header>
            <p class="meta-text">Publisher: ${escapeHtml(card.verifiedPublisher)}</p>
            ${disclosure("Provenance", detail)}
          </article>`;
    })
    .join("\n          ");

  const fourBucketsHtml = Object.values(costBreakdown.buckets)
    .map(
      (bucket) => `<div class="cost-bucket-card" data-bucket-id="${escapeHtml(bucket.bucketId)}" data-opaque-surface="true">
              <h4>${escapeHtml(bucket.label)}</h4>
              <p class="bucket-mechanism">Mechanism: <code>${escapeHtml(bucket.billingMechanism)}</code></p>
              <p class="bucket-summary"><strong>${escapeHtml(bucket.formattedSummary)}</strong></p>
              <ul class="bucket-lines">${bucket.lineItems.map((li) => `<li data-line-id="${escapeHtml(li.id)}" data-unknown-price="${li.isUnknownPrice}">${escapeHtml(li.label)}: <strong>${escapeHtml(li.formattedAmount)}</strong></li>`).join("")}</ul>
            </div>`,
    )
    .join("\n            ");

  const upvoteInfo = publicationState.revisionVotes[0] ?? {
    publicationId: DEFAULT_PUBLIC_CURRICULUM.publication_id,
    publicationRevisionId: DEFAULT_PUBLIC_CURRICULUM.publication_revision_id,
    upvoteCount: 14, viewerHasUpvoted: false,
  };

  const partitionTopics = proficiency.topic_coverage.map((topic) => {
    const demonstrated = typeof topic.demonstrated_objective_count === "number" ? topic.demonstrated_objective_count : 0;
    const assessed = Array.isArray(topic.assessed_objective_version_ids) ? topic.assessed_objective_version_ids.length : 0;
    const unassessed = Array.isArray(topic.unassessed_objective_version_ids) ? topic.unassessed_objective_version_ids.length : 0;
    const total = typeof topic.total_objective_count === "number" ? topic.total_objective_count : assessed + unassessed;
    return { label: topicLabel(topic.topic_id), demonstrated, total: Math.max(total, demonstrated) };
  });
  const proficiencyPartitionSvg = renderProficiencyPartitionSvg(partitionTopics);
  const walletGaugeSvg = renderWalletGaugeSvg(
    billingState.wallet.available_minor,
    billingState.wallet.reserved_minor,
    (["app_service_access", "ai_inference", "learning_materials", "certification_and_compute"] as const).map((id) => {
      const bucket = costBreakdown.buckets[id];
      const label = id === "app_service_access" ? "App" : id === "ai_inference" ? "Inference" : id === "learning_materials" ? "Materials" : "Cert";
      return {
        id: bucket.bucketId,
        label,
        knownMinor: bucket.knownTotalMinor,
        unknown: bucket.hasUnknownPrices,
        amountLabel: bucket.hasUnknownPrices ? "Unknown" : formatMinorCurrency(bucket.knownTotalMinor, bucket.currency),
      };
    }),
  );
  const moduleFlowSvg = renderModuleFlowSvg(DEFAULT_PUBLIC_CURRICULUM.content.modules.map((mod) => ({
    id: mod.module_id, title: mod.title, prerequisiteIds: mod.prerequisite_module_ids ?? [],
  })));

  const openDialogId = inputState.openDialogId ?? null;
  const isLearn = activeTopLevel === "Learn";

  return `<div class="curriculum-app-shell" data-theme="${resolvedThemeMode}" data-theme-preference="${themePreference}" data-breakpoint="${layout.breakpoint}" data-navigation-chrome="${layout.navigationChrome}" data-current-top-level="${activeTopLevel}" data-current-learn-sub="${activeLearnSub}" data-current-plan-view="${activePlanView}" data-selected-module-id="${escapeHtml(basePlanModel.selectedModuleId ?? "")}" data-selected-activity-id="${escapeHtml(basePlanModel.selectedActivityId ?? "")}" style="--active-canvas: ${palette.colors.canvas}; --active-surface: ${studySurface.backgroundColor};">
  <a class="skip-link" href="#main-workspace">Skip to main study workspace</a>
  <header class="app-header nav-chrome-glass" role="banner">
    <div class="brand-cluster"><span class="brand-title">Curriculum.io</span></div>
    <nav class="top-level-nav" aria-label="Primary navigation">${topNavHtml}</nav>
    <div class="header-status">
      <span class="duration-pill" data-study-minutes="${todayState.totalStudyMinutes}" title="Study minutes">${todayState.totalStudyMinutes}m</span>
      <span class="duration-pill" data-self-reported-count="${todayState.selfReportedCompletedCount}" title="Self-reported completions">${todayState.selfReportedCompletedCount}</span>
    </div>
  </header>

  <div class="app-body-grid">
    <aside class="app-sidebar nav-chrome-glass" aria-label="Section 9.3 Workspace Navigation">
      <div class="sidebar-section"><nav class="learn-sub-nav" aria-label="Learn sub-navigation">${learnSubNavHtml}</nav></div>
      <div class="sidebar-section"><p class="meta-text">${escapeHtml(basePlanModel.goal.title)}</p>${durationPill(basePlanModel.totalDurationTriplet.point, `Total Duration Triplet: ${basePlanModel.totalDurationTriplet.min}/${basePlanModel.totalDurationTriplet.point}/${basePlanModel.totalDurationTriplet.max} min`)}</div>
    </aside>

    <main id="main-workspace" class="app-main-workspace reading-measure" role="main" tabindex="-1">
      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${isLearn}"${isLearn ? "" : " hidden"}>
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${isLearn && activeLearnSub === "Today"}"${isLearn && activeLearnSub === "Today" ? "" : " hidden"}>
          <div class="section-header"><h2>Today</h2></div>
          <figure class="diagram-hero">${sessionFlowSvg}</figure>
          ${disclosure("Status", `<div class="status-banner" role="${todayState.asyncRecoveryBanner.role}"><strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)} ${escapeHtml(todayState.asyncRecoveryBanner.actionableNextStep)}</div><div class="study-card honest-two-layer-summary" data-opaque-surface="true"><h3>Honest Two-Layer Status Summary (@S17, @S23)</h3><p>Self-reporting an activity as completed records study effort idempotently (<code>self_reported_completed</code>) but <strong>never</strong> upgrades objective proficiency to <code>demonstrated</code> without reviewed assessment evidence.</p><div class="math-formula-surface" data-opaque-surface="true" role="${attentionFormula.role}" aria-label="${escapeHtml(attentionFormula.ariaLabel)}"><div class="math-caption">Key Derivation Target (Scaled Dot-Product Attention):</div>${attentionFormula.mathml}</div></div>`)}
          <div class="today-sessions-grid">${todayCardsHtml}</div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-plan" data-learn-panel="Plan" data-active="${isLearn && activeLearnSub === "Plan"}"${isLearn && activeLearnSub === "Plan" ? "" : " hidden"}>
          <div class="section-header">
            <h2>Plan</h2>
            <div class="plan-toolbar">
              <div class="plan-view-switcher" role="group" aria-label="Synchronized Plan View Switcher">
                ${PLAN_SYNCHRONIZED_VIEWS.map((view) => {
                  const isActiveView = view === activePlanView;
                  return `<button type="button" class="btn-secondary${isActiveView ? " is-active" : ""}" data-action="switch-plan-view" data-plan-view="${view}" aria-pressed="${isActiveView}">${view}</button>`;
                }).join("\n                ")}
              </div>
              <button type="button" class="btn-primary" data-action="activate-revision" data-curriculum-id="${escapeHtml(revisionActivationReq.curriculumId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}" aria-label="Activate Revision (${escapeHtml(revisionActivationReq.revisionId)})">Activate</button>
            </div>
          </div>
          <div class="study-card plan-map-container" data-plan-surface="Map" data-active="${activePlanView === "Map"}" data-opaque-surface="true">
            <div class="map-controls-bar" role="toolbar" aria-label="Non-dragging Map Viewport Controls">
              ${renderMapControl("zoom_in", "Zoom In", "zoom-in")}
              ${renderMapControl("zoom_out", "Zoom Out", "zoom-out")}
              ${renderMapControl("fit_view", "Reset View", "reset")}
              ${renderMapControl("reset_focus", "Focus Neighborhood", "focus")}
            </div>
            ${renderPlanDagSvgHtml(basePlanModel)}
            ${disclosure("Keys", `<p class="meta-text">Use Arrow keys (ArrowRight/ArrowLeft/ArrowDown/ArrowUp) to navigate nodes without dragging. Selected Module: <code>${escapeHtml(basePlanModel.selectedModuleId ?? "none")}</code> · Selected Activity: <code>${escapeHtml(basePlanModel.selectedActivityId ?? "none")}</code></p>`)}
          </div>
          <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">${outlineModulesHtml}</div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${isLearn && activeLearnSub === "Progress"}"${isLearn && activeLearnSub === "Progress" ? "" : " hidden"}>
          <div class="section-header"><h2>Progress</h2><button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-adaptation-diff" aria-label="Open Adaptation Diff Preview">Diff</button></div>
          <figure class="diagram-hero">${proficiencyPartitionSvg}</figure>
          ${disclosure("Ledger", `<div class="study-card" data-opaque-surface="true"><h3>Objective Proficiency Table (Two-Layer Evidence Ledger)</h3><p class="meta-text">Canonical Proficiency States: ${canonicalStatusesLegendHtml}</p><div class="table-responsive"><table class="proficiency-table"><thead><tr><th scope="col">Objective</th><th scope="col">Proficiency Status</th><th scope="col">Activity Execution</th><th scope="col">Evidence Support &amp; Refs</th></tr></thead><tbody>${proficiencyRowsHtml}</tbody></table></div></div><div class="study-card diagnostic-panel" data-diagnostic-session-id="${escapeHtml(diagnosticState.diagnostic_session_id)}" data-diagnostic-state="${escapeHtml(diagnosticState.state)}" data-opaque-surface="true"><h3>Topic Diagnostic Panel (${escapeHtml(diagnosticState.diagnostic_session_id)})</h3><p>Session State: <strong>${escapeHtml(diagnosticState.state)}</strong> · Assessed Objectives: <code>${escapeHtml(diagnosticState.assessed_objective_version_ids.join(", ") || "none")}</code> · Unassessed Objectives: <code>${escapeHtml(diagnosticState.unassessed_objective_version_ids.join(", ") || "none")}</code></p><p class="meta-text">Stopping early preserves demonstrated objectives while explicitly keeping untested objectives <code>unassessed</code> rather than inferred from neighboring topics (@S19, @S64, @S70).</p><div class="action-row"><button type="button" class="btn-secondary" data-action="diagnostic-stop-early">Stop Diagnostic Early (Preserve Unassessed)</button></div></div>`)}
        </section>

        <section class="learn-sub-panel" id="panel-learn-resources" data-learn-panel="Resources" data-active="${isLearn && activeLearnSub === "Resources"}"${isLearn && activeLearnSub === "Resources" ? "" : " hidden"}>
          <div class="section-header"><h2>Resources</h2></div>
          <div class="resources-grid">${resourcesHtml}</div>
        </section>
      </section>

      <section class="top-level-panel" id="panel-explore" data-top-panel="Explore" data-active="${activeTopLevel === "Explore"}"${activeTopLevel === "Explore" ? "" : " hidden"}>
        <div class="section-header">
          <h2>Explore</h2>
          <div class="action-row">
            <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview" aria-label="Publication Preview and Redaction Audit">Preview</button>
            <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-partial-adoption" aria-label="Configure Partial Adoption">Adopt</button>
          </div>
        </div>
        <figure class="diagram-hero">${moduleFlowSvg}</figure>
        <article class="study-card public-template-card" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" data-opaque-surface="true">
          <header class="activity-row"><h3>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.title)}</h3><button type="button" class="btn-secondary upvote-btn" data-action="toggle-upvote" data-publication-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_id)}" data-revision-id="${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_revision_id)}" aria-pressed="${upvoteInfo.viewerHasUpvoted}">▲ Upvote Revision (${upvoteInfo.upvoteCount ?? 0})</button></header>
          ${disclosure("Template", `<p class="meta-text">Published by <strong>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publisher.display_name)}</strong> · License: <code>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.publication_terms.content_license_id)}</code> · Revision #${DEFAULT_PUBLIC_CURRICULUM.revision_number}</p><p>${escapeHtml(DEFAULT_PUBLIC_CURRICULUM.content.summary)}</p><p class="meta-text">Transitive Prerequisite Resolution: Selecting <code>public-module-attention</code> automatically includes prerequisite <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", "))}</code>.</p>`)}
        </article>
      </section>

      <section class="top-level-panel" id="panel-settings" data-top-panel="Settings" data-active="${activeTopLevel === "Settings"}"${activeTopLevel === "Settings" ? "" : " hidden"}>
        <div class="section-header"><h2>Settings</h2></div>
        <figure class="diagram-hero">${walletGaugeSvg}</figure>
        ${disclosure("Buckets", `${costBreakdown.byokEstimateDisclaimer ? `<p class="disclosure-text">${escapeHtml(costBreakdown.byokEstimateDisclaimer)}</p>` : ""}<p>Available Hosted Balance: <strong>${formatMinorCurrency(billingState.wallet.available_minor, billingState.wallet.currency)}</strong> · Reserved Ceiling Hold: <strong>${formatMinorCurrency(billingState.wallet.reserved_minor, billingState.wallet.currency)}</strong></p><div class="four-bucket-grid">${fourBucketsHtml}</div>`)}
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Theme</h3>
          <div class="theme-selector-group" role="group" aria-label="Theme Mode Selector">
            ${(["light", "dark", "system"] as const).map((mode) => `<button type="button" class="btn-secondary${themePreference === mode ? " is-active" : ""}" data-action="set-theme" data-theme-value="${mode}" aria-pressed="${themePreference === mode}">${mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}</button>`).join("\n            ")}
          </div>
        </article>
        <article class="study-card settings-card" data-byok-mode="${escapeHtml(byokState.mode)}" data-allow-hosted-fallback="${byokState.allowHostedFallback}" data-opaque-surface="true">
          <h3>Keys</h3>
          <ul class="credential-list">
            ${byokState.credentials.map((cred) => `<li class="credential-item activity-row" data-credential-ref="${escapeHtml(cred.credential_ref)}" data-provider-id="${escapeHtml(cred.provider_id)}"><strong>${escapeHtml(cred.label ?? cred.provider_id)}</strong><code>${escapeHtml(cred.masked_hint)}</code><span class="badge">${escapeHtml(cred.status)}</span></li>`).join("\n            ")}
          </ul>
          ${disclosure("Custody", `<p class="disclosure-text">${escapeHtml(byokState.serverCustodyDisclosure)}</p><p class="disclosure-text">${escapeHtml(byokState.externalBillingDisclosure)}</p><ul>${byokState.credentials.map((cred) => `<li><code>${escapeHtml(cred.provider_id)}</code> ETag <code>${escapeHtml(cred.etag ?? "")}</code></li>`).join("")}</ul>`)}
        </article>
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Reminders</h3>
          <div class="activity-row"><span class="duration-pill">${escapeHtml(reminderState.timezone)}</span><span class="duration-pill">${escapeHtml(reminderState.quiet_hours.start_local_time)}-${escapeHtml(reminderState.quiet_hours.end_local_time)}</span><span class="duration-pill">${reminderState.lead_time_minutes}m</span></div>
          ${disclosure("Delivery", `<p class="disclosure-text">${escapeHtml(reminderState.bestEffortDeliveryDisclosure)}</p>`)}
        </article>
        <article class="study-card settings-card" data-opaque-surface="true">
          <h3>Privacy</h3>
          <div class="action-row"><button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-account-deletion" aria-label="Review Account Export and Destructive Deletion">Export &amp; deletion</button></div>
          ${disclosure("Privacy", `<p>${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>`)}
        </article>
      </section>
    </main>
  </div>

  <nav class="compact-bottom-nav nav-chrome-glass" aria-label="Compact mobile navigation">
    ${bottomNavHtml}
  </nav>

  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title" data-opaque-surface="true"${openDialogId === "dialog-adaptation-diff" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Preserved Math Depth: <code>${escapeHtml(adaptationDiff.preserved_math_depth ?? "formal")}</code> · Proposal SHA-256: <code>${escapeHtml(adaptationDiff.proposal_sha256.slice(0, 16))}…</code></p>
      <p>Schedule Impact: ${adaptationDiff.impact.before_minutes}m → ${adaptationDiff.impact.after_minutes}m (${adaptationDiff.impact.delta_minutes >= 0 ? "+" : ""}${adaptationDiff.impact.delta_minutes}m)</p>
      <div class="diff-buckets">
        <div><h3>Waived Instruction (Backed by Reviewed Anchor Evidence)</h3><ul>${adaptationDiff.waivers.map((w) => `<li><code>${escapeHtml(w.node_id)}</code> — Evidence: <code>${escapeHtml(w.qualifying_evidence_refs.join(", "))}</code> (${escapeHtml(w.rationale)})</li>`).join("")}</ul></div>
        <div><h3>Added Prerequisite Bridges (Unassessed Objectives Preserved)</h3><ul>${adaptationDiff.buckets.added.map((a) => `<li><code>${escapeHtml(a.node_id ?? "")}</code> — ${escapeHtml(a.rationale ?? "")}</li>`).join("")}</ul></div>
      </div>
    </form>
  </dialog>

  <dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title" data-opaque-surface="true"${openDialogId === "dialog-partial-adoption" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-partial-adoption-title">Partial Curriculum Adoption &amp; Prerequisite Closure</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Requested Module: <code>${escapeHtml(partialAdoptionScope.requestedModuleIds.join(", "))}</code></p>
      <p>Auto-Included Prerequisite Modules: <code>${escapeHtml(partialAdoptionScope.autoIncludedPrerequisiteModuleIds.join(", ") || "none")}</code></p>
      <p>Resolved Module Scope: <code>${escapeHtml(partialAdoptionScope.resolvedModuleIds.join(" → "))}</code></p>
      <p class="meta-text">Deterministic adoption executes at $0.00 AI inference cost without requiring BYOK keys or hosted wallet reservations.</p>
    </form>
  </dialog>

  <dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title" data-opaque-surface="true"${openDialogId === "dialog-publication-preview" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-publication-preview-title">Publication Preview &amp; Private Field Redaction</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Preview ID: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.preview_id)}</code> · Visibility: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.visibility)}</code></p>
      <p>Excluded Private Fields (Never Published): <code>${escapeHtml(publicationState.excludedPrivateFields.join(", "))}</code></p>
      <p>Terms Policy: <code>${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms_policy_id)}</code> (${escapeHtml(DEFAULT_PUBLICATION_PREVIEW.publication_terms.content_license_id)})</p>
    </form>
  </dialog>

  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title" data-opaque-surface="true"${openDialogId === "dialog-account-deletion" ? " open" : ""}>
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
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
  const solidSurfaces = initialState.solidSurfaces ?? false;
  const reduceMotion = initialState.reduceMotion ?? false;
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
      openDialogId,
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
      const matchedMod = buildCurrentPlanModel().outlineModules.find((m) => m.moduleId === moduleId);
      if (matchedMod?.activityIds.length && (!selectedActivityId || !matchedMod.activityIds.includes(selectedActivityId))) {
        selectedActivityId = matchedMod.activityIds[0] ?? null;
      }
      return getState();
    },
    selectPlanActivity(activityId: string, explicitModuleId?: string, _sourceView?: PlanSynchronizedView) {
      selectedActivityId = activityId;
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
    } else return;
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
  };
}
