import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  buildPlanMapAndOutlineModel, OBJECTIVE_PROFICIENCY_BADGE_STATUSES, renderAccessibleMathFormula,
  renderUntrustedCatalogText, resolveSurfaceStyle, resolveThemeMode, resolveThemePalette,
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
  buildFourBucketCostBreakdown, createHostedBillingController, formatMinorCurrency,
  type HostedCreditWalletSnapshot,
} from "./billingAndSharing.ts";
import { createAccountPrivacyController } from "./releaseAndA11yViews.ts";
import { clamp, escapeHtml, normalizeStringList } from "./shared.ts";
import { SfIcon, StatusGlyph, type SegmentStyle, type SfIconName } from "./components/Icons.tsx";
import {
  DEEP_DIVE_MODES, FLOW_ORDERS, SPACED_REVIEW_MODES, TRACK_LABELS, TRACK_OF_TYPE,
  MacroStage, StepRow, StudyFlowBoard, displayUnitTitle, effortWords, executionTone,
  executionWords, fit, humanize, isClosed, isOneOf, plannedFlowOrder, rightsWords, unitProgress,
  type DeepDiveMode, type FlowOrder, type FlowView, type SpacedReviewMode, type StudyActivity, type StudyModule,
} from "./components/StudyFlowBoard.tsx";
import {
  INSPECTOR_ID, InspectorDrawer, SETTABLE_STATUSES,
  type SelfCheckRubric, type SettableStatus,
} from "./components/InspectorDrawer.tsx";
import {
  AppSidebar, CompactBottomNav, HeaderBar, SessionExpiredBanner,
  type Account, type AuthStatus,
} from "./components/HeaderBar.tsx";
import {
  AuthDialog, PERSONAS, PERSONA_CHOICES, handleOf,
  type PersonaChoice, type ReturnDestination,
} from "./components/AuthDialog.tsx";
import {
  AdoptCurriculumDialog, ExploreMarketplace, MARKETPLACE_DOMAINS, MARKETPLACE_RIGORS, MARKETPLACE_SORTS,
  PublicationPreviewDialog, adoptedPlanOf, adoptionScopeOf, asRecord, goalTitleOf, mathDepthFor,
  publicProjectionOf, rawListOf,
  type ActiveCurriculum, type Adoption, type MarketplaceDomain, type MarketplaceListing,
  type MarketplaceRigor, type MarketplaceSort, type Vote,
} from "./components/ExploreMarketplace.tsx";
import { createCurriculumSignalStore, type CurriculumSignalStore } from "./state/store.ts";

export {
  createCurriculumSignalStore,
  type CurriculumSignalStore,
  type FlowOrder,
  type DeepDiveMode,
  type SpacedReviewMode,
  type AuthStatus,
  type Account,
  type PersonaChoice,
  type ReturnDestination,
  type MarketplaceDomain,
  type MarketplaceRigor,
  type MarketplaceSort,
  type MarketplaceListing,
  type Adoption,
  type Vote,
};

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
  readonly wallet?: HostedCreditWalletSnapshot; readonly openDialogId?: string | null;
  readonly hintRequested?: boolean; readonly workedSolutionRevealed?: boolean;
  readonly practiceSubmitted?: boolean; readonly practiceChoice?: string | null;
  readonly skippedActivityIds?: readonly string[];
  readonly remindersEnabled?: boolean; readonly remindersPaused?: boolean; readonly keyVisible?: boolean;
  readonly diagnosticControl?: "active" | "paused" | "stopped";
  readonly adaptationChoice?: "pending" | "accept_reviewed" | "keep_current";
  readonly loadMoreNote?: string | null; readonly intakeNote?: string | null;
  readonly keyActionNote?: string | null; readonly snoozeNote?: string | null;
  readonly rescheduleSessionId?: string | null; readonly rescheduleValue?: string | null;
  readonly depthOverrideReset?: boolean; readonly studyDetailOpen?: boolean;
  readonly flowOrder?: FlowOrder; readonly deepDive?: DeepDiveMode; readonly spacedReview?: SpacedReviewMode;
  readonly selectedCurriculumId?: string;
  readonly authStatus?: AuthStatus; readonly account?: Account; readonly returnTo?: ReturnDestination | null;
  readonly authNotice?: string | null;
  readonly marketplaceDomain?: MarketplaceDomain; readonly marketplaceRigor?: MarketplaceRigor;
  readonly marketplaceSort?: MarketplaceSort; readonly marketplaceQuery?: string;
  readonly votes?: readonly Vote[]; readonly adoptions?: readonly Adoption[];
  readonly publishedListings?: readonly MarketplaceListing[];
  readonly adoptPublicationId?: string | null; readonly adoptScope?: "full" | "units"; readonly adoptModuleIds?: readonly string[];
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
  schema_version: "0.2.0", curriculum_id: "curriculum-rag-python-001",
  revision_id: "revision-attention-v2", revision_number: 2, predecessor_revision_id: "revision-attention-v1",
  account_id: "learner-default", created_at: "2026-10-20T16:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Build and Evaluate RAG Systems in Python",
    summary: "Start a Python RAG system from its model foundations: subword tokenization and scaled dot-product attention, with verified resources.",
    included_topics: ["tokenization tradeoffs", "scaled dot-product attention", "matrix calculus"],
    excluded_topics: ["distributed cluster orchestration"],
    scope_note: "This synthetic plan covers the tokenization and attention foundations only. Retrieval and evaluation units are not included yet. Self-reported activity completion never substitutes for demonstrated proficiency.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  instruction_preferences_applied: { math_depth: "formal", topic_math_depth_overrides: [], known_material_review: "skip_if_demonstrated" },
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
      content: {
        task_prompt: "Run the external test suite to verify lossless UTF-8 round-trip encoding.",
        deliverable_description: "A reversible tokenizer and a tensor shape validator that pass the external round-trip and shape tests.",
        assessment_ref: null, execution_mode: "external",
      },
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

const makeCatalogEntry = (
  resource_version_id: string, title: string, slug: string, provider: readonly [id: string, name: string], model: string,
  segments: readonly (readonly [id: string, title: string])[] = [],
): CatalogResourceMetadataInput => ({
  resource_version_id, title, canonical_url: `https://example.invalid/catalog/${slug}`, captured_at: "2026-10-20T16:00:00Z",
  provider: { provider_id: provider[0], display_name: provider[1] },
  access: { model, certificate_included: false, access_verified_at: "2026-10-20T16:00:00Z" },
  ingestion_permissions: { basis: "link_and_metadata_only", permissions: { display_excerpts: "denied" } },
  segments: segments.map(([segment_id, segmentTitle]) => ({ segment_id, title: segmentTitle, verified: true })),
});

const OPEN_MATH_COMMONS = ["open-math-commons", "Open Math Commons (Curator Verified)"] as const;
const PUBLIC_DOMAIN_CLASSICS = ["public-domain-classics", "Public Domain Classics Library (Curator Verified)"] as const;
const OPEN_SYSTEMS_PRESS = ["open-systems-press", "Open Systems Press (Curator Verified)"] as const;

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
  "synthetic-resource-la-notes-v1": makeCatalogEntry(
    "synthetic-resource-la-notes-v1", "Open Linear Algebra Notes: Spectral Theory and Projections", "linear-algebra-notes", OPEN_MATH_COMMONS, "free",
    [["seg-la-eigen", "Chapter 6: Eigenvalues and Eigenvectors"], ["seg-la-svd", "Chapter 7: The Singular Value Decomposition"]],
  ),
  "synthetic-resource-la-problem-sets-v1": makeCatalogEntry(
    "synthetic-resource-la-problem-sets-v1", "Public Problem Sets with Worked Solutions: Linear Algebra", "linear-algebra-problem-sets",
    ["open-course-problem-bank", "Open Course Problem Bank"], "free",
    [["seg-la-ps1", "Problem Set 1: Eigenvalues and Projections"], ["seg-la-ps2", "Problem Set 2: The SVD and Low-Rank Approximation"]],
  ),
  "synthetic-resource-la-lab-v1": makeCatalogEntry(
    "synthetic-resource-la-lab-v1", "Numerical Linear Algebra Lab: Iterative Eigensolvers", "eigensolver-lab", OPEN_MATH_COMMONS, "free",
  ),
  "synthetic-resource-war-and-peace-v1": makeCatalogEntry(
    "synthetic-resource-war-and-peace-v1", "War and Peace (Louise and Aylmer Maude translation)", "war-and-peace-maude", PUBLIC_DOMAIN_CLASSICS, "free",
    [["seg-wp-book-3", "Book Three: Austerlitz"], ["seg-wp-book-9", "Book Nine, Chapter 1: What causes a historical event"]],
  ),
  "synthetic-resource-anna-karenina-v1": makeCatalogEntry(
    "synthetic-resource-anna-karenina-v1", "Anna Karenina (Constance Garnett translation)", "anna-karenina-garnett", PUBLIC_DOMAIN_CLASSICS, "free",
    [["seg-ak-part-7", "Part Seven: Anna's final journey"], ["seg-ak-part-8", "Part Eight: Levin's resolution"]],
  ),
  "synthetic-resource-berlin-essay-v1": makeCatalogEntry(
    "synthetic-resource-berlin-essay-v1", "The Hedgehog and the Fox: An Essay on Tolstoy's View of History (Isaiah Berlin)", "hedgehog-and-the-fox",
    ["university-press-catalog", "University Press Catalog"], "library_loan",
  ),
  "synthetic-resource-rust-async-book-v1": makeCatalogEntry(
    "synthetic-resource-rust-async-book-v1", "Asynchronous Rust Under the Hood: Futures, Wakers, and Executors", "async-rust-under-the-hood",
    OPEN_SYSTEMS_PRESS, "free", [["seg-rs-futures", "Chapters 2–3: Futures, Pin, and Wakers"], ["seg-rs-reactor", "Chapter 5: Reactors and I/O Readiness"]],
  ),
  "synthetic-resource-rust-lab-v1": makeCatalogEntry(
    "synthetic-resource-rust-lab-v1", "Executor Lab: Test Harness and Reference Solutions", "executor-lab",
    OPEN_SYSTEMS_PRESS, "free", [["seg-rs-lab-executor", "Lab 1: A single-threaded executor"], ["seg-rs-lab-timer", "Lab 2: A timer wheel"]],
  ),
  "synthetic-resource-statmech-notes-v1": makeCatalogEntry(
    "synthetic-resource-statmech-notes-v1", "Open Lecture Notes: Statistical Physics", "statistical-physics-notes",
    ["open-physics-commons", "Open Physics Commons (Curator Verified)"], "free",
    [["seg-sm-ensembles", "Chapter 2: Ensembles and the Partition Function"], ["seg-sm-ising", "Chapter 5: The Ising Model"]],
  ),
  "synthetic-resource-statmech-problems-v1": makeCatalogEntry(
    "synthetic-resource-statmech-problems-v1", "Public Problem Sets with Worked Solutions: Statistical Physics", "statistical-physics-problem-sets",
    ["open-course-problem-bank", "Open Course Problem Bank"], "free",
    [["seg-sm-ps1", "Problem Set 1: Partition Functions"], ["seg-sm-ps2", "Problem Set 2: Phase Transitions"]],
  ),
};

const LINEAR_ALGEBRA_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-linear-algebra-002",
  revision_id: "revision-linear-algebra-v1", revision_number: 1, predecessor_revision_id: null,
  account_id: "learner-default", created_at: "2026-10-20T16:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Linear Algebra & Spectral Methods",
    summary: "Compute eigenvalues, orthogonal projections, and the singular value decomposition, then use the SVD for low-rank approximation.",
    included_topics: ["eigenvalues", "orthogonal projections", "singular value decomposition"],
    excluded_topics: ["numerical stability proofs"],
    scope_note: "Each unit ends at a public problem set with published worked solutions.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  instruction_preferences_applied: { math_depth: "formal", topic_math_depth_overrides: [], known_material_review: "skip_if_demonstrated" },
  objectives: [
    {
      objective_id: "objective-la-spectral", objective_version_id: "objective-la-spectral-v1", topic_id: "topic-eigenvalues",
      title: "Compute eigenvalues and orthogonal projections, and explain their geometry",
      description: "Relate eigenvectors to invariant directions and orthogonal projections to least-squares fits.",
      success_criterion: "Diagonalize a symmetric 3×3 matrix and project a vector onto its column space, justifying each step.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["la-gate-spectral"], prior_evidence_refs: [],
    },
    {
      objective_id: "objective-la-svd", objective_version_id: "objective-la-svd-v1", topic_id: "topic-svd",
      title: "Derive the singular value decomposition and use it for low-rank approximation",
      description: "Connect singular values to the eigenvalues of AᵀA and to the best rank-k approximation.",
      success_criterion: "Compute the SVD of a 2×2 matrix by hand and state the Eckart–Young error of its best rank-1 approximation.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["la-gate-svd"], prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [{ from_objective_id: "objective-la-spectral", to_objective_id: "objective-la-svd" }],
  modules: [
    {
      module_id: "la-module-spectral", title: "Module 1: Eigenvalues & Orthogonal Projections",
      summary: "Eigenpairs of symmetric matrices, diagonalization, and projection onto a column space.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-la-spectral"],
      activity_ids: ["la-read-eigen", "la-example-projection", "la-lab-power-iteration", "la-gate-spectral"],
    },
    {
      module_id: "la-module-svd", title: "Module 2: Singular Value Decomposition",
      summary: "The SVD, its link to AᵀA, and the Eckart–Young theorem.",
      requirement_level: "required", prerequisite_module_ids: ["la-module-spectral"], objective_ids: ["objective-la-svd"],
      activity_ids: ["la-read-svd", "la-example-svd", "la-gate-svd", "la-review-svd"],
    },
  ],
  activities: [
    {
      activity_id: "la-read-eigen", type: "theory", title: "Read: Eigenvalues, Eigenvectors, and Diagonalization",
      requirement_level: "required", objective_ids: ["objective-la-spectral"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-eigen"], "Open notes with a full treatment of the spectral theorem.")],
      duration_estimate: makeDurationEstimate([0, 20, 0, 0, 0], [0, 15, 0, 0, 0], [0, 30, 0, 0, 0]),
      content: { study_prompt: "Work out why a real symmetric matrix has orthogonal eigenvectors." },
    },
    {
      activity_id: "la-example-projection", type: "worked_example", title: "Worked Example: Projecting onto a Column Space",
      requirement_level: "required", objective_ids: ["objective-la-spectral"], prerequisite_activity_ids: ["la-read-eigen"],
      resource_assignments: [makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-eigen"], "Derives the projection matrix from the normal equations.")],
      duration_estimate: makeDurationEstimate([5, 10, 5, 0, 0], [4, 8, 4, 0, 0], [8, 14, 8, 0, 0]),
      content: { example_prompt: "Follow the derivation of P = A(AᵀA)⁻¹Aᵀ from the normal equations.", guidance_level: "full" },
    },
    {
      activity_id: "la-lab-power-iteration", type: "coding", title: "Implement Power Iteration and Check It Against NumPy",
      requirement_level: "required", objective_ids: ["objective-la-spectral"], prerequisite_activity_ids: ["la-example-projection"],
      resource_assignments: [makeResAssign("synthetic-resource-la-lab-v1", "supplemental", [], "External lab with a reference solution and tests.")],
      duration_estimate: makeDurationEstimate([0, 5, 20, 0, 0], [0, 4, 15, 0, 0], [0, 8, 30, 0, 0]),
      content: {
        task_prompt: "Implement power iteration and compare its dominant eigenpair with numpy.linalg.eigh.",
        deliverable_description: "A script that prints the dominant eigenvalue, its error against NumPy, and the iteration count.",
        assessment_ref: null, execution_mode: "external",
      },
    },
    {
      activity_id: "la-gate-spectral", type: "quiz", title: "Problem Set 1: Eigenvalues & Projections",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-la-spectral"], prerequisite_activity_ids: ["la-lab-power-iteration"],
      resource_assignments: [makeResAssign("synthetic-resource-la-problem-sets-v1", "primary", ["seg-la-ps1"], "Public problem set with published worked solutions.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 30, 0], [0, 0, 0, 20, 0], [0, 0, 0, 45, 0]),
      content: { assessment_ref: "assessment-la-public-set-1", attempt_policy_ref: "attempt-policy-published-solutions" },
    },
    {
      activity_id: "la-read-svd", type: "theory", title: "Read: The Singular Value Decomposition",
      requirement_level: "required", objective_ids: ["objective-la-svd"], prerequisite_activity_ids: ["la-gate-spectral"],
      resource_assignments: [makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-svd"], "Builds the SVD from the spectral theorem.")],
      duration_estimate: makeDurationEstimate([0, 20, 0, 0, 0], [0, 15, 0, 0, 0], [0, 30, 0, 0, 0]),
      content: { study_prompt: "Connect the singular values of A to the eigenvalues of AᵀA." },
    },
    {
      activity_id: "la-example-svd", type: "worked_example", title: "Worked Example: SVD of a 2×2 Matrix by Hand",
      requirement_level: "required", objective_ids: ["objective-la-svd"], prerequisite_activity_ids: ["la-read-svd"],
      resource_assignments: [makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-svd"], "A fully worked 2×2 example.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Compute U, Σ, and V for a 2×2 matrix and check that UΣVᵀ reproduces it.", guidance_level: "full" },
    },
    {
      activity_id: "la-gate-svd", type: "quiz", title: "Problem Set 2: SVD & Low-Rank Approximation",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-la-svd"], prerequisite_activity_ids: ["la-example-svd"],
      resource_assignments: [makeResAssign("synthetic-resource-la-problem-sets-v1", "primary", ["seg-la-ps2"], "Public problem set with published worked solutions.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 30, 0], [0, 0, 0, 20, 0], [0, 0, 0, 45, 0]),
      content: { assessment_ref: "assessment-la-public-set-2", attempt_policy_ref: "attempt-policy-published-solutions" },
    },
    {
      activity_id: "la-review-svd", type: "review", title: "Spaced Review: Eckart–Young and Projections",
      requirement_level: "required", objective_ids: ["objective-la-svd"], prerequisite_activity_ids: ["la-gate-svd"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 10], [0, 0, 0, 0, 8], [0, 0, 0, 0, 15]),
      content: { recall_prompt: "Without notes, state the Eckart–Young theorem and explain why a projection minimizes error.", assessment_ref: null },
    },
  ],
  certification_options: [],
};

const LINEAR_ALGEBRA_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-linear-algebra-1", schedule_revision_id: "schedule-revision-linear-algebra-1",
  version: 1, curriculum_revision_id: "revision-linear-algebra-v1", timezone: "America/New_York", weekly_minutes: 150,
  sessions: [
    { session_id: "la-session-1", start_at: "2026-10-27T18:00:00-04:00", duration_minutes: 65, activity_ids: ["la-read-eigen", "la-example-projection", "la-lab-power-iteration"], reminder_enabled: true },
    { session_id: "la-session-2", start_at: "2026-10-29T18:00:00-04:00", duration_minutes: 30, activity_ids: ["la-gate-spectral"], reminder_enabled: true },
    { session_id: "la-session-3", start_at: "2026-11-02T18:00:00-05:00", duration_minutes: 75, activity_ids: ["la-read-svd", "la-example-svd", "la-gate-svd"], reminder_enabled: true },
    { session_id: "la-session-4", start_at: "2026-11-05T18:00:00-05:00", duration_minutes: 10, activity_ids: ["la-review-svd"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

const TOLSTOY_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-tolstoy-lit-003",
  revision_id: "revision-tolstoy-v1", revision_number: 1, predecessor_revision_id: null,
  account_id: "learner-default", created_at: "2026-10-20T16:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Tolstoy's Major Novels: War & Peace and Anna Karenina",
    summary: "Read Tolstoy's two major novels for their argument about history and their method of moral interiority, and test each reading in a written synthesis.",
    included_topics: ["historical determinism", "free indirect discourse", "literary realism"],
    excluded_topics: ["Russian-language close reading"],
    scope_note: "No public quiz bank covers this material. Each gate is a written synthesis that you check against a rubric.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  instruction_preferences_applied: { math_depth: "intuitive", topic_math_depth_overrides: [], known_material_review: "retain_full" },
  objectives: [
    {
      objective_id: "objective-tl-agency", objective_version_id: "objective-tl-agency-v1", topic_id: "topic-war-and-peace",
      title: "Analyze Tolstoy's account of historical determinism and individual agency in War and Peace",
      description: "Weigh the novel's battle scenes against its essay chapters on what causes historical events.",
      success_criterion: "Write a synthesis that links one battle scene to one essay chapter and evaluates Isaiah Berlin's reading.",
      level: "advanced", requirement_level: "required", assessment_activity_ids: ["tl-gate-war-and-peace"], prior_evidence_refs: [],
    },
    {
      objective_id: "objective-tl-interiority", objective_version_id: "objective-tl-interiority-v1", topic_id: "topic-anna-karenina",
      title: "Explain how Anna Karenina renders moral interiority through narrative technique",
      description: "Trace how free indirect discourse and the double plot shape the reader's moral judgment.",
      success_criterion: "Show how one passage of free indirect discourse shapes the reader's judgment of Anna, and set it against Levin's ending.",
      level: "advanced", requirement_level: "required", assessment_activity_ids: ["tl-gate-anna-karenina"], prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [],
  modules: [
    {
      module_id: "tl-module-war-and-peace", title: "Module 1: War and Peace: Historical Determinism & Agency",
      summary: "Austerlitz, the essay chapters on historical causation, and Berlin's hedgehog and fox.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-tl-agency"],
      activity_ids: ["tl-read-war-and-peace", "tl-read-berlin", "tl-close-austerlitz", "tl-gate-war-and-peace", "tl-review-war-and-peace"],
    },
    {
      module_id: "tl-module-anna-karenina", title: "Module 2: Anna Karenina: Realism & Moral Interiority",
      summary: "Free indirect discourse in Anna's final journey, and the double plot that ends with Levin.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-tl-interiority"],
      activity_ids: ["tl-read-anna-karenina", "tl-close-obiralovka", "tl-gate-anna-karenina", "tl-review-anna-karenina"],
    },
  ],
  activities: [
    {
      activity_id: "tl-read-war-and-peace", type: "theory", title: "Read War and Peace: Book Three and the Opening of Book Nine",
      requirement_level: "required", objective_ids: ["objective-tl-agency"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-war-and-peace-v1", "primary", ["seg-wp-book-3", "seg-wp-book-9"], "Public-domain translation of the full novel.")],
      duration_estimate: makeDurationEstimate([0, 60, 0, 0, 0], [0, 45, 0, 0, 0], [0, 90, 0, 0, 0]),
      content: { study_prompt: "Mark each moment where a character believes they control events, and each passage where the narrator says they do not." },
    },
    {
      activity_id: "tl-read-berlin", type: "theory", title: "Read Isaiah Berlin: The Hedgehog and the Fox",
      requirement_level: "required", objective_ids: ["objective-tl-agency"], prerequisite_activity_ids: ["tl-read-war-and-peace"],
      resource_assignments: [makeResAssign("synthetic-resource-berlin-essay-v1", "primary", [], "The standard critical reading of Tolstoy's view of history.")],
      duration_estimate: makeDurationEstimate([0, 40, 0, 0, 0], [0, 30, 0, 0, 0], [0, 60, 0, 0, 0]),
      content: { study_prompt: "Find Berlin's claim that Tolstoy was a fox by nature who believed in being a hedgehog." },
    },
    {
      activity_id: "tl-close-austerlitz", type: "worked_example", title: "Close Reading: Prince Andrei Under the Sky at Austerlitz",
      requirement_level: "required", objective_ids: ["objective-tl-agency"], prerequisite_activity_ids: ["tl-read-war-and-peace"],
      resource_assignments: [makeResAssign("synthetic-resource-war-and-peace-v1", "primary", ["seg-wp-book-3"], "The Austerlitz chapters.")],
      duration_estimate: makeDurationEstimate([0, 15, 10, 0, 0], [0, 10, 8, 0, 0], [0, 20, 15, 0, 0]),
      content: { example_prompt: "Follow a guided reading of the wounded Andrei watching the sky, and of how Napoleon shrinks in his eyes.", guidance_level: "full" },
    },
    {
      activity_id: "tl-gate-war-and-peace", type: "quiz", title: "Synthesis Gate: Agency and Determinism in War and Peace",
      requirement_level: "required", objective_ids: ["objective-tl-agency"], prerequisite_activity_ids: ["tl-read-berlin", "tl-close-austerlitz"],
      resource_assignments: [makeResAssign("synthetic-resource-war-and-peace-v1", "primary", ["seg-wp-book-9"], "Cite the essay chapters directly.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 40, 0], [0, 0, 0, 30, 0], [0, 0, 0, 60, 0]),
      content: { assessment_ref: "assessment-tolstoy-war-and-peace", attempt_policy_ref: "attempt-policy-self-check" },
    },
    {
      activity_id: "tl-review-war-and-peace", type: "review", title: "Spaced Reflection: Free Will After Austerlitz",
      requirement_level: "required", objective_ids: ["objective-tl-agency"], prerequisite_activity_ids: ["tl-gate-war-and-peace"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 10], [0, 0, 0, 0, 8], [0, 0, 0, 0, 15]),
      content: { recall_prompt: "Without reopening the novel, restate your synthesis in five sentences, then check it against the rubric again.", assessment_ref: "assessment-tolstoy-war-and-peace" },
    },
    {
      activity_id: "tl-read-anna-karenina", type: "theory", title: "Read Anna Karenina: Parts Seven and Eight",
      requirement_level: "required", objective_ids: ["objective-tl-interiority"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-anna-karenina-v1", "primary", ["seg-ak-part-7", "seg-ak-part-8"], "Public-domain translation of the full novel.")],
      duration_estimate: makeDurationEstimate([0, 60, 0, 0, 0], [0, 45, 0, 0, 0], [0, 90, 0, 0, 0]),
      content: { study_prompt: "Mark where the narration moves inside Anna's or Levin's mind without quotation marks." },
    },
    {
      activity_id: "tl-close-obiralovka", type: "worked_example", title: "Close Reading: Anna's Final Journey to Obiralovka",
      requirement_level: "required", objective_ids: ["objective-tl-interiority"], prerequisite_activity_ids: ["tl-read-anna-karenina"],
      resource_assignments: [makeResAssign("synthetic-resource-anna-karenina-v1", "primary", ["seg-ak-part-7"], "The carriage ride and the station.")],
      duration_estimate: makeDurationEstimate([0, 15, 10, 0, 0], [0, 10, 8, 0, 0], [0, 20, 15, 0, 0]),
      content: { example_prompt: "Follow a guided reading of the carriage ride as the narration takes on Anna's perception.", guidance_level: "full" },
    },
    {
      activity_id: "tl-gate-anna-karenina", type: "quiz", title: "Synthesis Gate: Moral Interiority in Anna Karenina",
      requirement_level: "required", objective_ids: ["objective-tl-interiority"], prerequisite_activity_ids: ["tl-close-obiralovka"],
      resource_assignments: [makeResAssign("synthetic-resource-anna-karenina-v1", "primary", ["seg-ak-part-7", "seg-ak-part-8"], "Cite both parts directly.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 40, 0], [0, 0, 0, 30, 0], [0, 0, 0, 60, 0]),
      content: { assessment_ref: "assessment-tolstoy-anna-karenina", attempt_policy_ref: "attempt-policy-self-check" },
    },
    {
      activity_id: "tl-review-anna-karenina", type: "review", title: "Spaced Reflection: Levin and Anna as Counterpoints",
      requirement_level: "required", objective_ids: ["objective-tl-interiority"], prerequisite_activity_ids: ["tl-gate-anna-karenina"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 10], [0, 0, 0, 0, 8], [0, 0, 0, 0, 15]),
      content: { recall_prompt: "Explain from memory why the novel ends with Levin and not with Anna, then check your answer against the rubric.", assessment_ref: "assessment-tolstoy-anna-karenina" },
    },
  ],
  certification_options: [],
};

const TOLSTOY_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-tolstoy-1", schedule_revision_id: "schedule-revision-tolstoy-1",
  version: 1, curriculum_revision_id: "revision-tolstoy-v1", timezone: "America/New_York", weekly_minutes: 180,
  sessions: [
    { session_id: "tl-session-1", start_at: "2026-10-27T20:00:00-04:00", duration_minutes: 85, activity_ids: ["tl-read-war-and-peace", "tl-close-austerlitz"], reminder_enabled: true },
    { session_id: "tl-session-2", start_at: "2026-10-30T20:00:00-04:00", duration_minutes: 80, activity_ids: ["tl-read-berlin", "tl-gate-war-and-peace"], reminder_enabled: true },
    { session_id: "tl-session-3", start_at: "2026-11-03T20:00:00-05:00", duration_minutes: 95, activity_ids: ["tl-review-war-and-peace", "tl-read-anna-karenina", "tl-close-obiralovka"], reminder_enabled: true },
    { session_id: "tl-session-4", start_at: "2026-11-06T20:00:00-05:00", duration_minutes: 40, activity_ids: ["tl-gate-anna-karenina"], reminder_enabled: true },
    { session_id: "tl-session-5", start_at: "2026-11-10T20:00:00-05:00", duration_minutes: 10, activity_ids: ["tl-review-anna-karenina"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

const RAG_PLAN: ActiveCurriculum = {
  curriculumId: "curriculum-rag-python-001", domain: "Engineering", assessmentMode: "Reviewed Quiz",
  curriculum: DEFAULT_SYNTHETIC_CURRICULUM, schedule: DEFAULT_SYNTHETIC_SCHEDULE, publicationId: "publication-synthetic-001", draft: false,
};

// The base plans in queue order. The first one is selected by default.
const ACTIVE_CURRICULA: readonly ActiveCurriculum[] = [
  RAG_PLAN,
  {
    curriculumId: "curriculum-linear-algebra-002", domain: "Mathematics", assessmentMode: "Public Quiz Bank",
    curriculum: LINEAR_ALGEBRA_CURRICULUM, schedule: LINEAR_ALGEBRA_SCHEDULE, publicationId: "publication-linear-algebra-001", draft: false,
  },
  {
    curriculumId: "curriculum-tolstoy-lit-003", domain: "Literature", assessmentMode: "Self-Check Rubric",
    curriculum: TOLSTOY_CURRICULUM, schedule: TOLSTOY_SCHEDULE, publicationId: "publication-tolstoy-001", draft: false,
  },
];

const planIn = (plans: readonly ActiveCurriculum[], curriculumId: unknown): ActiveCurriculum =>
  plans.find((plan) => plan.curriculumId === curriculumId) ?? RAG_PLAN;

const RUST_ASYNC_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-rust-async-004",
  revision_id: "revision-rust-async-v1", revision_number: 1, predecessor_revision_id: null,
  account_id: "curator-ferris", created_at: "2026-10-18T12:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Rust Async Runtime Internals",
    summary: "Build a small async executor from the Future trait up, then add a reactor, a timer wheel, and work stealing.",
    included_topics: ["futures and polling", "wakers", "reactors", "work stealing"],
    excluded_topics: ["production tuning of tokio"],
    scope_note: "Each unit ends at a code lab whose test suite is the gate.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  instruction_preferences_applied: { math_depth: "applied", topic_math_depth_overrides: [], known_material_review: "skip_if_demonstrated" },
  objectives: [
    {
      objective_id: "objective-rs-poll", objective_version_id: "objective-rs-poll-v1", topic_id: "topic-async-futures",
      title: "Explain how futures are polled, woken, and pinned",
      description: "Trace one future from creation through Poll::Pending and a wakeup to Poll::Ready.",
      success_criterion: "A single-threaded executor runs three dependent futures to completion and passes the lab's wakeup tests.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["rs-gate-executor"], prior_evidence_refs: [],
    },
    {
      objective_id: "objective-rs-scheduling", objective_version_id: "objective-rs-scheduling-v1", topic_id: "topic-async-scheduling",
      title: "Schedule I/O readiness, timers, and stolen tasks in a runtime",
      description: "Connect epoll readiness and a timer wheel to the executor's task queue.",
      success_criterion: "The executor wakes a sleeping task within 5 ms of its deadline and passes the lab's timer tests under load.",
      level: "advanced", requirement_level: "required", assessment_activity_ids: ["rs-gate-timer"], prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [{ from_objective_id: "objective-rs-poll", to_objective_id: "objective-rs-scheduling" }],
  modules: [
    {
      module_id: "rs-module-futures", title: "Module 1: Futures, Wakers, and the Poll Model",
      summary: "The Future trait, Pin, Waker, and a minimal executor.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-rs-poll"],
      activity_ids: ["rs-read-futures", "rs-example-waker", "rs-gate-executor"],
    },
    {
      module_id: "rs-module-scheduling", title: "Module 2: Reactors, Timers, and Work Stealing",
      summary: "I/O readiness with epoll, a timer wheel, and work-stealing queues.",
      requirement_level: "required", prerequisite_module_ids: ["rs-module-futures"], objective_ids: ["objective-rs-scheduling"],
      activity_ids: ["rs-read-reactor", "rs-example-stealing", "rs-gate-timer", "rs-review-pinning"],
    },
  ],
  activities: [
    {
      activity_id: "rs-read-futures", type: "theory", title: "Read: The Future Trait and Poll-Based Execution",
      requirement_level: "required", objective_ids: ["objective-rs-poll"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-rust-async-book-v1", "primary", ["seg-rs-futures"], "Covers Future, Poll, and Pin from first principles.")],
      duration_estimate: makeDurationEstimate([0, 25, 0, 0, 0], [0, 20, 0, 0, 0], [0, 35, 0, 0, 0]),
      content: { study_prompt: "Explain why a future must be pinned before it is polled." },
    },
    {
      activity_id: "rs-example-waker", type: "worked_example", title: "Worked Example: Hand-Rolling a Waker",
      requirement_level: "required", objective_ids: ["objective-rs-poll"], prerequisite_activity_ids: ["rs-read-futures"],
      resource_assignments: [makeResAssign("synthetic-resource-rust-async-book-v1", "primary", ["seg-rs-futures"], "Builds a RawWaker vtable step by step.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Follow how a RawWakerVTable wakes a task that returned Poll::Pending.", guidance_level: "full" },
    },
    {
      activity_id: "rs-gate-executor", type: "coding", title: "Gate Lab: Build a Single-Threaded Executor",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-rs-poll"], prerequisite_activity_ids: ["rs-example-waker"],
      resource_assignments: [makeResAssign("synthetic-resource-rust-lab-v1", "primary", ["seg-rs-lab-executor"], "Lab repository with the executor test suite.")],
      duration_estimate: makeDurationEstimate([0, 5, 40, 0, 0], [0, 4, 30, 0, 0], [0, 8, 60, 0, 0]),
      content: {
        task_prompt: "Implement block_on and a task queue that runs spawned futures until each one is ready.",
        deliverable_description: "An executor crate that passes the lab's wakeup and ordering tests.",
        assessment_ref: "assessment-rs-executor-tests", execution_mode: "external",
      },
    },
    {
      activity_id: "rs-read-reactor", type: "theory", title: "Read: Reactors and I/O Readiness with epoll",
      requirement_level: "required", objective_ids: ["objective-rs-scheduling"], prerequisite_activity_ids: ["rs-gate-executor"],
      resource_assignments: [makeResAssign("synthetic-resource-rust-async-book-v1", "primary", ["seg-rs-reactor"], "Connects OS readiness events to wakers.")],
      duration_estimate: makeDurationEstimate([0, 25, 0, 0, 0], [0, 20, 0, 0, 0], [0, 35, 0, 0, 0]),
      content: { study_prompt: "Trace how an epoll readiness event becomes a call to Waker::wake." },
    },
    {
      activity_id: "rs-example-stealing", type: "worked_example", title: "Worked Example: Work-Stealing Task Queues",
      requirement_level: "optional", objective_ids: ["objective-rs-scheduling"], prerequisite_activity_ids: ["rs-read-reactor"],
      resource_assignments: [makeResAssign("synthetic-resource-rust-async-book-v1", "supplemental", ["seg-rs-reactor"], "Optional deep dive on multi-threaded schedulers.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Follow how an idle worker steals half of a busy worker's queue.", guidance_level: "faded" },
    },
    {
      activity_id: "rs-gate-timer", type: "coding", title: "Gate Lab: Add a Timer Wheel to the Executor",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-rs-scheduling"], prerequisite_activity_ids: ["rs-read-reactor"],
      resource_assignments: [makeResAssign("synthetic-resource-rust-lab-v1", "primary", ["seg-rs-lab-timer"], "Lab repository with the timer test suite.")],
      duration_estimate: makeDurationEstimate([0, 5, 45, 0, 0], [0, 4, 35, 0, 0], [0, 8, 70, 0, 0]),
      content: {
        task_prompt: "Add a hashed timer wheel and wake each sleeping task when its deadline passes.",
        deliverable_description: "An executor that passes the lab's timer accuracy and load tests.",
        assessment_ref: "assessment-rs-timer-tests", execution_mode: "external",
      },
    },
    {
      activity_id: "rs-review-pinning", type: "review", title: "Spaced Review: Pinning and Wakeups",
      requirement_level: "required", objective_ids: ["objective-rs-poll"], prerequisite_activity_ids: ["rs-gate-timer"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 10], [0, 0, 0, 0, 8], [0, 0, 0, 0, 15]),
      content: { recall_prompt: "Without notes, explain why moving a pinned future would be unsound.", assessment_ref: null },
    },
  ],
  certification_options: [],
};

const RUST_ASYNC_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-rust-async-1", schedule_revision_id: "schedule-revision-rust-async-1",
  version: 1, curriculum_revision_id: "revision-rust-async-v1", timezone: "America/New_York", weekly_minutes: 180,
  sessions: [
    { session_id: "rs-session-1", start_at: "2026-10-28T19:00:00-04:00", duration_minutes: 50, activity_ids: ["rs-read-futures", "rs-example-waker"], reminder_enabled: true },
    { session_id: "rs-session-2", start_at: "2026-10-31T10:00:00-04:00", duration_minutes: 45, activity_ids: ["rs-gate-executor"], reminder_enabled: true },
    { session_id: "rs-session-3", start_at: "2026-11-04T19:00:00-05:00", duration_minutes: 100, activity_ids: ["rs-read-reactor", "rs-example-stealing", "rs-gate-timer"], reminder_enabled: true },
    { session_id: "rs-session-4", start_at: "2026-11-07T10:00:00-05:00", duration_minutes: 10, activity_ids: ["rs-review-pinning"], reminder_enabled: false },
  ],
  generated_at: "2026-10-18T12:00:00Z",
};

const STAT_MECH_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-statmech-005",
  revision_id: "revision-statmech-v1", revision_number: 1, predecessor_revision_id: null,
  account_id: "curator-ada", created_at: "2026-10-08T10:00:00Z", revision_reason: "initial_generation",
  goal: {
    title: "Statistical Mechanics & Thermodynamics",
    summary: "Derive thermodynamics from ensembles and the partition function, then use free energy to explain phase transitions.",
    included_topics: ["ensembles", "partition functions", "phase transitions"],
    excluded_topics: ["quantum field theory methods"],
    scope_note: "Each unit ends at a public problem set with published worked solutions.",
  },
  language: "en", sequence_preference_applied: "theory_first",
  instruction_preferences_applied: { math_depth: "formal", topic_math_depth_overrides: [], known_material_review: "skip_if_demonstrated" },
  objectives: [
    {
      objective_id: "objective-sm-ensembles", objective_version_id: "objective-sm-ensembles-v1", topic_id: "topic-ensembles",
      title: "Derive thermodynamic quantities from a partition function",
      description: "Connect the canonical ensemble to mean energy, entropy, and heat capacity.",
      success_criterion: "Compute the mean energy and heat capacity of a two-level system from its partition function.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["sm-gate-ensembles"], prior_evidence_refs: [],
    },
    {
      objective_id: "objective-sm-phase", objective_version_id: "objective-sm-phase-v1", topic_id: "topic-phase-transitions",
      title: "Explain phase transitions with free energy and the Ising model",
      description: "Use free-energy minimization and mean-field theory to locate a critical point.",
      success_criterion: "Derive the mean-field critical temperature of the Ising model and sketch the magnetization below it.",
      level: "advanced", requirement_level: "required", assessment_activity_ids: ["sm-gate-phase"], prior_evidence_refs: [],
    },
  ],
  prerequisite_edges: [{ from_objective_id: "objective-sm-ensembles", to_objective_id: "objective-sm-phase" }],
  modules: [
    {
      module_id: "sm-module-ensembles", title: "Module 1: Ensembles and the Partition Function",
      summary: "Microcanonical and canonical ensembles, and the quantities a partition function yields.",
      requirement_level: "required", prerequisite_module_ids: [], objective_ids: ["objective-sm-ensembles"],
      activity_ids: ["sm-read-ensembles", "sm-example-two-level", "sm-gate-ensembles"],
    },
    {
      module_id: "sm-module-phase", title: "Module 2: Free Energy and Phase Transitions",
      summary: "Free energy, the Ising model, and mean-field theory.",
      requirement_level: "required", prerequisite_module_ids: ["sm-module-ensembles"], objective_ids: ["objective-sm-phase"],
      activity_ids: ["sm-read-free-energy", "sm-example-mean-field", "sm-gate-phase", "sm-review-fluctuations"],
    },
  ],
  activities: [
    {
      activity_id: "sm-read-ensembles", type: "theory", title: "Read: Microcanonical and Canonical Ensembles",
      requirement_level: "required", objective_ids: ["objective-sm-ensembles"], prerequisite_activity_ids: [],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ensembles"], "Open lecture notes with full derivations.")],
      duration_estimate: makeDurationEstimate([0, 30, 0, 0, 0], [0, 25, 0, 0, 0], [0, 45, 0, 0, 0]),
      content: { study_prompt: "Derive the Boltzmann factor from the microcanonical ensemble of a large reservoir." },
    },
    {
      activity_id: "sm-example-two-level", type: "worked_example", title: "Worked Example: The Two-Level System",
      requirement_level: "required", objective_ids: ["objective-sm-ensembles"], prerequisite_activity_ids: ["sm-read-ensembles"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ensembles"], "A complete worked example of the Schottky anomaly.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Follow the heat capacity of a two-level system to its Schottky peak.", guidance_level: "full" },
    },
    {
      activity_id: "sm-gate-ensembles", type: "quiz", title: "Problem Set 1: Partition Functions",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-sm-ensembles"], prerequisite_activity_ids: ["sm-example-two-level"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-problems-v1", "primary", ["seg-sm-ps1"], "Public problem set with published worked solutions.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 35, 0], [0, 0, 0, 25, 0], [0, 0, 0, 50, 0]),
      content: { assessment_ref: "assessment-sm-public-set-1", attempt_policy_ref: "attempt-policy-published-solutions" },
    },
    {
      activity_id: "sm-read-free-energy", type: "theory", title: "Read: Free Energy, Entropy, and the Ising Model",
      requirement_level: "required", objective_ids: ["objective-sm-phase"], prerequisite_activity_ids: ["sm-gate-ensembles"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ising"], "The Ising model and its mean-field treatment.")],
      duration_estimate: makeDurationEstimate([0, 30, 0, 0, 0], [0, 25, 0, 0, 0], [0, 45, 0, 0, 0]),
      content: { study_prompt: "Explain why minimizing free energy, and not energy alone, decides the stable phase." },
    },
    {
      activity_id: "sm-example-mean-field", type: "worked_example", title: "Worked Example: Mean-Field Magnetization",
      requirement_level: "required", objective_ids: ["objective-sm-phase"], prerequisite_activity_ids: ["sm-read-free-energy"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ising"], "Solves the self-consistency equation graphically.")],
      duration_estimate: makeDurationEstimate([5, 10, 15, 0, 0], [4, 8, 10, 0, 0], [8, 14, 20, 0, 0]),
      content: { example_prompt: "Solve m = tanh(βJzm) graphically and find where nonzero solutions appear.", guidance_level: "full" },
    },
    {
      activity_id: "sm-gate-phase", type: "quiz", title: "Problem Set 2: Phase Transitions",
      requirement_level: "required", mastery_gated: true, objective_ids: ["objective-sm-phase"], prerequisite_activity_ids: ["sm-example-mean-field"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-problems-v1", "primary", ["seg-sm-ps2"], "Public problem set with published worked solutions.")],
      duration_estimate: makeDurationEstimate([0, 0, 0, 35, 0], [0, 0, 0, 25, 0], [0, 0, 0, 50, 0]),
      content: { assessment_ref: "assessment-sm-public-set-2", attempt_policy_ref: "attempt-policy-published-solutions" },
    },
    {
      activity_id: "sm-review-fluctuations", type: "review", title: "Spaced Review: Fluctuations and Response",
      requirement_level: "required", objective_ids: ["objective-sm-phase"], prerequisite_activity_ids: ["sm-gate-phase"],
      resource_assignments: [],
      duration_estimate: makeDurationEstimate([0, 0, 0, 0, 10], [0, 0, 0, 0, 8], [0, 0, 0, 0, 15]),
      content: { recall_prompt: "Without notes, relate the heat capacity to energy fluctuations in the canonical ensemble.", assessment_ref: null },
    },
  ],
  certification_options: [],
};

const STAT_MECH_SCHEDULE: Record<string, unknown> = {
  schedule_id: "schedule-statmech-1", schedule_revision_id: "schedule-revision-statmech-1",
  version: 1, curriculum_revision_id: "revision-statmech-v1", timezone: "America/New_York", weekly_minutes: 150,
  sessions: [
    { session_id: "sm-session-1", start_at: "2026-10-29T18:00:00-04:00", duration_minutes: 55, activity_ids: ["sm-read-ensembles", "sm-example-two-level"], reminder_enabled: true },
    { session_id: "sm-session-2", start_at: "2026-11-01T10:00:00-05:00", duration_minutes: 35, activity_ids: ["sm-gate-ensembles"], reminder_enabled: true },
    { session_id: "sm-session-3", start_at: "2026-11-05T18:00:00-05:00", duration_minutes: 60, activity_ids: ["sm-read-free-energy", "sm-example-mean-field"], reminder_enabled: true },
    { session_id: "sm-session-4", start_at: "2026-11-08T10:00:00-05:00", duration_minutes: 35, activity_ids: ["sm-gate-phase"], reminder_enabled: true },
    { session_id: "sm-session-5", start_at: "2026-11-12T18:00:00-05:00", duration_minutes: 10, activity_ids: ["sm-review-fluctuations"], reminder_enabled: false },
  ],
  generated_at: "2026-10-08T10:00:00Z",
};

const MARKETPLACE_LISTINGS: readonly MarketplaceListing[] = [
  {
    publicationId: "publication-synthetic-001", revisionId: "public-revision-synthetic-001", subject: "Engineering", gateStyle: "Reviewed Quiz",
    handle: "@alex", upvotes: 14, adoptions: 142, publishedAt: "2026-10-20T16:00:00Z",
    ownerAccountId: "learner-default", sourceCurriculumId: "curriculum-rag-python-001", basedOn: null,
    curriculum: DEFAULT_SYNTHETIC_CURRICULUM, schedule: DEFAULT_SYNTHETIC_SCHEDULE,
  },
  {
    publicationId: "publication-linear-algebra-001", revisionId: "public-revision-linear-algebra-001", subject: "Mathematics", gateStyle: "Public Quiz Bank",
    handle: "@spectral_sam", upvotes: 31, adoptions: 87, publishedAt: "2026-10-12T15:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: LINEAR_ALGEBRA_CURRICULUM, schedule: LINEAR_ALGEBRA_SCHEDULE,
  },
  {
    publicationId: "publication-tolstoy-001", revisionId: "public-revision-tolstoy-001", subject: "Literature", gateStyle: "Self-Check Rubric",
    handle: "@tolstoy_seminar", upvotes: 19, adoptions: 23, publishedAt: "2026-10-16T18:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: TOLSTOY_CURRICULUM, schedule: TOLSTOY_SCHEDULE,
  },
  {
    publicationId: "publication-rust-async-001", revisionId: "public-revision-rust-async-001", subject: "Systems", gateStyle: "Code Lab Gate",
    handle: "@ferris_ops", upvotes: 48, adoptions: 64, publishedAt: "2026-10-18T12:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: RUST_ASYNC_CURRICULUM, schedule: RUST_ASYNC_SCHEDULE,
  },
  {
    publicationId: "publication-statmech-001", revisionId: "public-revision-statmech-001", subject: "Physics", gateStyle: "Problem Set Gate",
    handle: "@ada_curates", upvotes: 27, adoptions: 39, publishedAt: "2026-10-08T10:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: STAT_MECH_CURRICULUM, schedule: STAT_MECH_SCHEDULE,
  },
];

// Actions that need no valid session: signing in or out, browsing the Marketplace, appearance, and view layout.
const OPEN_ACTIONS: ReadonlySet<string> = new Set([
  "submit-sign-in", "sign-in-passkey", "switch-persona", "simulate-session-expired", "sign-out",
  "set-marketplace-domain", "set-marketplace-rigor", "set-marketplace-sort", "set-marketplace-query", "load-more",
  "close-study-detail", "toggle-solid-surfaces", "toggle-reduce-motion", "set-flow-order", "set-deep-dive", "set-spaced-review",
  "view-evidence", "check-prerequisites",
]);

// A topic with no public quiz bank is checked against a rubric. A gate or review links one through content.assessment_ref.
const SELF_CHECK_RUBRICS: Readonly<Record<string, SelfCheckRubric>> = {
  "assessment-tolstoy-war-and-peace": {
    prompt: "Compare Prince Andrei's disillusionment at Austerlitz (Book Three) with Tolstoy's thesis on historical determinism at the opening of Book Nine, and evaluate how Isaiah Berlin's hedgehog and fox framework applies.",
    criteria: [
      "Ties Andrei's view of the sky at Austerlitz to a specific claim about the limits of individual will.",
      "Cites one passage from Book Nine on how countless small causes produce a historical event.",
      "Takes a position on Berlin's claim that Tolstoy was a fox who believed in being a hedgehog, with evidence from both the battle scenes and the essay chapters.",
    ],
  },
  "assessment-tolstoy-anna-karenina": {
    prompt: "Trace how free indirect discourse in Anna's final journey (Part Seven) shapes the reader's moral judgment, and set it against Levin's resolution at the end of Part Eight.",
    criteria: [
      "Identifies two sentences where the narration takes on Anna's perception, and explains what that does to the reader's sympathy.",
      "Explains how the novel pairs Anna's plot with Levin's, using one concrete parallel between their stories.",
      "States whether the ending endorses Levin's resolution or leaves it open, and supports the claim with the final chapter of Part Eight.",
    ],
  },
};

const DEFAULT_DIAGNOSTIC_SESSION: DiagnosticSessionFixture = {
  diagnostic_session_id: "diagnostic-synthetic-001", curriculum_id: "curriculum-rag-python-001",
  curriculum_revision_id: "revision-attention-v2", state: "active",
  target_objective_version_ids: ["objective-tokenization-v1", "objective-attention-v1"],
  assessed_objective_version_ids: ["objective-tokenization-v1"], unassessed_objective_version_ids: ["objective-attention-v1"],
  proficiency_snapshot_ref: "proficiency-snapshot-001", stop_reason: null,
};

const DEFAULT_ADAPTATION_PROPOSAL: AdaptationProposalFixture = {
  proposal_id: "adaptation-synthetic-001", curriculum_id: "curriculum-rag-python-001",
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

function sfIcon(name: SfIconName, size: 15 | 16 = 16): string {
  return renderToString(h(SfIcon, { name, size }));
}

function statusGlyph(type: "module" | "gate", tone: "todo" | "doing" | "done", size = 20): string {
  return renderToString(h(StatusGlyph, { type, tone, size }));
}

function renderFlowBoard(
  idPrefix: string,
  modules: readonly StudyModule[],
  selectedModuleId: string | null,
  selectedActivityId: string | null,
  view: FlowView,
): string {
  return renderToString(h(StudyFlowBoard, { idPrefix, modules, selectedModuleId, selectedActivityId, view }));
}

function renderMacroStage(modules: readonly StudyModule[], selectedModuleId: string | null): string {
  return renderToString(h(MacroStage, { modules, selectedModuleId }));
}

function renderStepRow(
  activity: StudyActivity,
  selectedActivityId: string | null,
  note: string,
  reviewSeparationValid?: boolean,
): string {
  return renderToString(h(StepRow, { activity, selectedActivityId, note, reviewSeparationValid }));
}

// The plan model keeps one prompt per activity, so a lab's deliverables and a gate's assessment come from the raw curriculum.
const rawContentOf = (curriculum: Record<string, unknown>, activityId: string): Readonly<Record<string, unknown>> =>
  asRecord(rawListOf(curriculum, "activities").find((entry) => entry["activity_id"] === activityId)?.["content"]);

const rubricOf = (curriculum: Record<string, unknown>, activityId: string): SelfCheckRubric | null => {
  const ref = rawContentOf(curriculum, activityId)["assessment_ref"];
  return typeof ref === "string" ? SELF_CHECK_RUBRICS[ref] ?? null : null;
};

const activityIdsOf = (curriculum: Record<string, unknown>): ReadonlySet<string> =>
  new Set(rawListOf(curriculum, "activities").map((entry) => entry["activity_id"]).filter((id): id is string => typeof id === "string"));

// The module that holds the given activity, or else the plan's first module, and the activity to open there.
function stepOf(curriculum: Record<string, unknown>, activityId?: string | null): { readonly moduleId: string; readonly activityId: string } {
  const modules = rawListOf(curriculum, "modules").map((mod) => ({ id: mod["module_id"], activityIds: normalizeStringList(mod["activity_ids"]) }));
  const holder = modules.find((mod) => activityId && mod.activityIds.includes(activityId)) ?? modules[0];
  return {
    moduleId: typeof holder?.id === "string" ? holder.id : "",
    activityId: activityId && holder?.activityIds.includes(activityId) ? activityId : holder?.activityIds[0] ?? "",
  };
}

interface TodayInput {
  readonly curriculum: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly activityStates: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly events: readonly ProgressEventInput[];
}

// One plan's Today view. All plans share one activity-state map, and each replays only its own progress events.
function buildTodayFor({ curriculum, schedule, proficiency, catalogResources, activityStates, events }: TodayInput) {
  const own = activityIdsOf(curriculum);
  const today = createTodayViewController({ curriculum, schedule, proficiency, catalogResources, initialActivityStates: activityStates });
  for (const ev of events) if (own.has(ev.activityId ?? ev.activity_id ?? "")) today.recordProgressEvent(ev);
  return today;
}

function deliverablesOf(curriculum: Record<string, unknown>, activityId: string): readonly string[] {
  const content = rawContentOf(curriculum, activityId);
  const listed: unknown = content["deliverables"];
  return [content["deliverable_description"], ...(Array.isArray(listed) ? listed : [])]
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => renderUntrustedCatalogText(item, { maxLength: 2000 }).text);
}

// An account's plans: the base plans, then its own adopted copies.
const plansFor = (accountId: string, adoptions: readonly Adoption[], listings: readonly MarketplaceListing[]): readonly ActiveCurriculum[] => [
  ...ACTIVE_CURRICULA,
  ...adoptions.filter((adoption) => adoption.accountId === accountId).flatMap((adoption) => {
    const listing = listings.find((entry) => entry.publicationId === adoption.publicationId);
    return listing ? [adoptedPlanOf(listing, adoption)] : [];
  }),
];

function renderInspector(props: Parameters<typeof InspectorDrawer>[0]): string {
  return renderToString(h(InspectorDrawer, props));
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

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(date);
}

// Map node labels: two title lines plus short status words. Full text stays in aria-label.
function titleLines(text: string, max: number): readonly [string, string] {
  const words = text.split(/\s+/);
  let first = "";
  let index = 0;
  for (; index < words.length; index++) {
    const next = first ? `${first} ${words[index] ?? ""}` : words[index] ?? "";
    if (first && next.length > max) break;
    first = next;
  }
  return [fit(first, max), fit(words.slice(index).join(" "), max)];
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
      const fillSurface = isSelected ? "var(--color-accent-surface)" : "var(--color-surface)";
      const elevFilter = isSelected ? "url(#node-elev-selected)" : "url(#node-elev)";
      const moduleIdAttr = node.kind === "module" ? node.nodeId : (planModel.selectedModuleId ?? "module-foundations");
      const durationText = node.durationTriplet ? effortWords(node.durationTriplet) : humanize(node.requirementLevel);
      const [line1, line2] = titleLines(displayUnitTitle(node.title), 28);
      const nodeTypeface = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', sans-serif";

      return `<g class="map-node" tabindex="0" role="button" data-action="select-map-node" data-node-id="${escapeHtml(node.nodeId)}" data-node-kind="${escapeHtml(node.kind)}" data-module-id="${escapeHtml(moduleIdAttr)}" data-selected="${isSelected}" data-in-neighborhood="${node.inFocusedNeighborhood}" data-opaque-surface="true" aria-pressed="${isSelected}" aria-label="${escapeHtml(`${node.kind}: ${node.title}. ${node.executionBadge.nonColorCue}. ${node.proficiencyBadge.nonColorCue}`)}" transform="translate(${node.x}, ${node.y})">
              <rect width="${node.width}" height="${node.height}" rx="14" ry="14" fill="${fillSurface}" stroke="${strokeColor}" stroke-width="1.5" filter="${elevFilter}" />
              <text x="16" y="24" fill="var(--color-text-primary)" font-size="12.5" font-weight="600" font-family="${nodeTypeface}" letter-spacing="-0.02em">${escapeHtml(line1)}</text>
              <text x="16" y="40" fill="var(--color-text-primary)" font-size="12.5" font-weight="600" font-family="${nodeTypeface}" letter-spacing="-0.02em">${escapeHtml(line2)}</text>
              <text x="16" y="60" fill="var(--color-text-secondary)" font-size="11" font-family="${nodeTypeface}">${escapeHtml(`${executionWords(node.executionStatus)} · ${humanize(node.proficiencyStatus)}`)}</text>
              <text x="16" y="77" fill="var(--color-accent)" font-size="11" font-weight="600" font-family="${nodeTypeface}">${escapeHtml(durationText)}</text>
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
  // A guest sees only public pages. Private panels, the drawer, and private dialogs are not rendered at all (UI-023).
  const authStatus: AuthStatus = inputState.authStatus ?? "authenticated";
  const account: Account = inputState.account ?? PERSONAS.learner;
  const signedOut = authStatus === "guest";
  const listings = [...MARKETPLACE_LISTINGS, ...(inputState.publishedListings ?? [])];
  const votes = inputState.votes ?? [];
  const adoptions = inputState.adoptions ?? [];
  const plans = plansFor(account.accountId, adoptions, listings);
  // A curriculum or schedule in the input replaces the selected plan's own, so single-plan callers keep working.
  const registered = planIn(plans, inputState.selectedCurriculumId);
  const selectedPlan: ActiveCurriculum = {
    ...registered, curriculum: inputState.curriculum ?? registered.curriculum, schedule: inputState.schedule ?? registered.schedule,
  };
  const { curriculum, schedule } = selectedPlan;
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

  const todayOf = (plan: ActiveCurriculum) => buildTodayFor({
    curriculum: plan.curriculum, schedule: plan.schedule, proficiency, catalogResources,
    activityStates: inputState.activityStates ?? {}, events: inputState.recordedProgressEvents ?? [],
  }).getState();
  const todayState = todayOf(selectedPlan);
  const planToday = plans.map((plan) => (plan === registered ? { plan: selectedPlan, today: todayState } : { plan, today: todayOf(plan) }));
  // Today queues active plans only. A draft waits on the Plan page until the learner activates it.
  const queue = planToday.filter(({ plan }) => !plan.draft);
  const openingStep = stepOf(curriculum, inputState.selectedActivityId);

  const basePlanModel = buildPlanMapAndOutlineModel({
    curriculum, proficiency, activityStates: todayState.activityExecutionStates, catalogResources, viewportWidthPx,
    selectedModuleId: inputState.selectedModuleId ?? openingStep.moduleId,
    selectedActivityId: inputState.selectedActivityId ?? openingStep.activityId,
    focusedNodeId: inputState.focusedNodeId ?? inputState.selectedModuleId ?? openingStep.moduleId,
    zoom: inputState.zoom ?? 1,
  });

  const navShell = createNavigationShellController({
    initialViewportWidthPx: viewportWidthPx, initialTextScalePercent: textScalePercent,
    initialAppearance: { themePreference, solidSurfaces, reduceMotion },
    planModules: basePlanModel.outlineModules.map((m) => ({
      moduleId: m.moduleId, title: m.title, required: m.required, prerequisiteModuleIds: m.prerequisiteModuleIds, activityIds: m.activityIds,
    })),
  });

  const activeTopLevel: TopLevelDestination = signedOut ? "Explore" : inputState.topLevel ?? "Learn";
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

  // Marketplace: public listings filtered and sorted for this viewer. Counts are public totals across accounts.
  const marketplaceDomain = inputState.marketplaceDomain ?? "All";
  const marketplaceRigor = inputState.marketplaceRigor ?? "All";
  const marketplaceSort = inputState.marketplaceSort ?? "top_upvoted";
  const marketplaceQuery = inputState.marketplaceQuery ?? "";
  const myPlans = signedOut ? [] : plans;
  const adoptScope = inputState.adoptScope ?? "full";
  const originListing = listings.find((listing) => listing.publicationId === selectedPlan.publicationId && listing.ownerAccountId !== account.accountId);
  const returnTo = inputState.returnTo ?? null;
  const authNotice = inputState.authNotice ?? null;

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

  const hintRequested = inputState.hintRequested ?? false;
  const workedSolutionRevealed = inputState.workedSolutionRevealed ?? false;
  const practiceSubmitted = inputState.practiceSubmitted ?? false;
  const practiceChoice = inputState.practiceChoice ?? null;
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
  const flowView: FlowView = {
    order: inputState.flowOrder ?? plannedFlowOrder(curriculum),
    deepDive: inputState.deepDive ?? "included",
    spacedReview: inputState.spacedReview ?? "included",
  };
  const isLearn = activeTopLevel === "Learn";

  const isExecutionDone = (status: string) => status === "completed" || status === "self_reported_completed";
  const nextSession = todayState.nextSession;
  const nextUp = nextSession?.activityBreakdown.find((act) => !isClosed(act.executionStatus)) ?? null;
  const modules = basePlanModel.outlineModules;
  const selectedModuleId = basePlanModel.selectedModuleId;
  const selectedActivityId = basePlanModel.selectedActivityId;
  const outlineById = new Map(basePlanModel.outlineActivities.map((act) => [act.activityId, act]));
  const stepRow = (activityId: string, note: string, reviewSeparationValid?: boolean): string => {
    const activity = outlineById.get(activityId);
    return activity ? renderStepRow(activity, selectedActivityId, note, reviewSeparationValid) : "";
  };

  const reviewRows = todayState.todayCards.flatMap((card) => card.activityBreakdown.filter((act) => act.type === "review").map((act) =>
    stepRow(act.activityId, `Scheduled ${shortSessionLabel(card.startAt)}. ${card.reviewSeparation.separationSummary} ${act.scheduledReason}`, card.reviewSeparation.valid),
  )).filter(Boolean);
  const completedRows = todayState.todayCards.flatMap((card) => card.activityBreakdown.filter((act) => isExecutionDone(act.executionStatus)))
    .map((act) => stepRow(act.activityId, "Self-reported completed. Objective proficiency is unchanged.")).filter(Boolean);
  const listOrEmpty = (rows: readonly string[], icon: SfIconName, empty: string): string => rows.length > 0
    ? `<ul class="today-activity-list step-list">${rows.join("")}</ul>`
    : `<p class="empty-state">${sfIcon(icon)}<span>${empty}</span></p>`;

  // Today's queue: one card per active plan, showing that plan's next session and its next open activity.
  const queueCardsHtml = queue.map(({ plan, today }) => {
    const id = escapeHtml(plan.curriculumId);
    const session = today.nextSession?.activityBreakdown ?? [];
    const open = session.filter((act) => !isClosed(act.executionStatus));
    const next = open[0];
    const done = session.length - open.length;
    const minutesLeft = open.reduce((sum, act) => sum + act.durationTriplet.point, 0);
    const percent = session.length === 0 ? 0 : Math.round((done / session.length) * 100);
    return `<article class="curriculum-card" data-curriculum-id="${id}" aria-labelledby="queue-${id}-title"${plan.curriculumId === selectedPlan.curriculumId ? ' aria-current="true"' : ""}>
            <p class="domain-pill">${escapeHtml(`${plan.domain} · ${plan.assessmentMode}`)}</p>
            <h2 id="queue-${id}-title" class="curriculum-card-title">${escapeHtml(goalTitleOf(plan.curriculum))}</h2>
            <p class="queue-progress"><span class="st-sr">Upcoming session: </span>${done}/${session.length} completed${minutesLeft > 0 ? ` · ${minutesLeft}m left` : ""}</p>
            <span class="macro-bar" aria-hidden="true"><span style="width: ${percent}%"></span></span>
            ${next ? `<div class="queue-next"><p class="queue-next-title">${escapeHtml(next.title)}</p><p class="queue-next-meta"><span>${next.durationTriplet.point}m</span><span class="track-badge">${TRACK_LABELS[TRACK_OF_TYPE[next.type]].badge}</span></p></div>` : `<p class="queue-next">Nothing is scheduled next.</p>`}
            <div class="queue-actions">
              ${next ? `<button type="button" class="btn-primary" data-action="resume-curriculum" data-curriculum-id="${id}" data-activity-id="${escapeHtml(next.activityId)}" data-module-id="${escapeHtml(next.moduleId)}">Resume<span aria-hidden="true">→</span></button>` : ""}
              <button type="button" class="btn-secondary" data-action="open-curriculum-plan" data-curriculum-id="${id}">Open Plan<span aria-hidden="true">→</span></button>
            </div>
          </article>`;
  }).join("");
  const planOptionsHtml = planToday.map(({ plan }) =>
    `<option value="${escapeHtml(plan.curriculumId)}"${plan.curriculumId === selectedPlan.curriculumId ? " selected" : ""}>${escapeHtml(goalTitleOf(plan.curriculum))}${plan.draft ? " · Draft" : ""}</option>`).join("");
  const studyMinutes = planToday.reduce((sum, { today }) => sum + today.totalStudyMinutes, 0);
  const selfReportedCount = planToday.reduce((sum, { today }) => sum + today.selfReportedCompletedCount, 0);

  const requiredActivities = basePlanModel.outlineActivities.filter((act) => act.required);
  const requiredCompleted = requiredActivities.filter((act) => isExecutionDone(act.executionStatus)).length;
  const demonstratedObjectives = basePlanModel.objectiveTracks.filter((obj) => obj.proficiencyStatus === "demonstrated").length;
  const reviewsDue = basePlanModel.outlineActivities.filter((act) => act.type === "review" && !isExecutionDone(act.executionStatus) && act.executionStatus !== "waived").length;
  const requiredSummary = `${requiredCompleted} of ${requiredActivities.length} required activities completed`;
  const evidenceSummary = `${demonstratedObjectives} of ${basePlanModel.objectiveTracks.length} objectives demonstrated`;
  const reviewSummary = `${reviewsDue} review${reviewsDue === 1 ? "" : "s"} due`;

  const macroStageHtml = renderMacroStage(modules, selectedModuleId);
  // The second row of Today's header card. Resume opens the drawer, which holds the details.
  const planProgress = unitProgress(basePlanModel.outlineActivities);
  const nextUpRowHtml = `<div class="today-next">
              <p class="next-up-progress">${planProgress.done}/${planProgress.total} completed${planProgress.left > 0 ? ` · ${planProgress.left}m left` : ""}</p>
              ${nextUp ? `<div class="next-up">
                <p class="next-up-text"><span class="next-up-label">Next:</span><span class="next-up-title">${escapeHtml(nextUp.title)}</span><span class="next-up-time">· ${nextUp.durationTriplet.point}m</span></p>
                <button type="button" class="btn-primary" data-action="select-outline-activity" data-activity-id="${escapeHtml(nextUp.activityId)}" data-module-id="${escapeHtml(nextUp.moduleId)}">Resume<span aria-hidden="true">→</span></button>
              </div>` : `<p class="next-up-text">Nothing is scheduled next.</p>`}
            </div>`;
  const todayBoardHtml = renderFlowBoard("flow-today", modules, selectedModuleId, selectedActivityId, flowView);
  const planBoardHtml = renderFlowBoard("flow-plan", modules, selectedModuleId, selectedActivityId, flowView);

  const selectedModule = modules.find((mod) => mod.moduleId === selectedModuleId) ?? modules[0];
  const selectedActivity = selectedModule?.activities.find((act) => act.activityId === selectedActivityId) ?? selectedModule?.activities[0];
  const topicOf = new Map(basePlanModel.objectiveTracks.map((obj) => [obj.objectiveId, obj.topicId]));
  const inspectorHtml = selectedModule && selectedActivity
    ? renderInspector({
      modules, mod: selectedModule, activity: selectedActivity, open: studyDetailOpen && isLearn,
      rigor: mathDepthFor(curriculum, selectedActivity.objectiveIds.flatMap((objectiveId) => topicOf.get(objectiveId) ?? [])),
      deliverables: deliverablesOf(curriculum, selectedActivity.activityId), catalogResources,
      rubric: rubricOf(curriculum, selectedActivity.activityId),
      skipRecorded: skippedActivityIds.has(selectedActivity.activityId),
    })
    : "";

  const legendArrow = (tone: "control" | "accent", style: SegmentStyle) =>
    `<svg class="legend-swatch" viewBox="0 0 64 20" width="64" height="20" aria-hidden="true" data-tone="${tone}" data-style="${style}"><line x1="2" y1="10" x2="50" y2="10" /><path class="arrow-head" d="M49 5 L59 10 L49 15 Z" /></svg>`;
  const relationshipLegend = `<figure class="relationship-legend">
    <figcaption>Relationship legend</figcaption>
    <ul>
      <li>${legendArrow("control", "solid")}<span><strong>Prerequisite.</strong> Solid directed edge. Required capability before an activity; identify unmet capabilities.</span></li>
      <li>${legendArrow("accent", "solid")}<span><strong>Recommended sequence.</strong> Distinct directed style. Suggested order, not a hard gate.</span></li>
      <li>${legendArrow("control", "dashed")}<span><strong>Optional enrichment.</strong> Dashed branch with label. Optional work excluded from required-completion denominator.</span></li>
      <li><span class="badge">Review</span><span><strong>Review.</strong> Separate badge/list connection. Scheduled revisit; does not form a prerequisite cycle.</span></li>
    </ul>
  </figure>`;

  const canonicalStatusesLegendHtml = OBJECTIVE_PROFICIENCY_BADGE_STATUSES.map(
    (st) => `<span class="badge badge-proficiency-status" data-proficiency-status="${st}">${humanize(st)}</span>`,
  ).join(" ");
  const proficiencyGlyph = (status: string): string => {
    if (status === "demonstrated" || status === "unassessed") return statusGlyph("gate", status === "demonstrated" ? "done" : "todo", 20);
    return statusGlyph("module", status === "not_started" ? "todo" : "doing", 20);
  };
  const proficiencyRowsHtml = basePlanModel.objectiveTracks.map((obj) => `<tr data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
    <td><strong>${escapeHtml(obj.title)}</strong><div class="meta-text">${escapeHtml(obj.objectiveVersionId)}</div></td>
    <td><span class="st-status-static">${proficiencyGlyph(obj.proficiencyStatus)}<span>${escapeHtml(humanize(obj.proficiencyStatus))}</span></span><span class="st-sr">${escapeHtml(obj.proficiencyBadge.nonColorCue)}</span></td>
    <td><span class="st-status-static">${statusGlyph("module", executionTone(obj.executionStatus), 20)}<span>${escapeHtml(executionWords(obj.executionStatus))}</span></span><span class="st-sr">${escapeHtml(obj.executionBadge.nonColorCue)}</span></td>
    <td><span class="evidence-cell">${escapeHtml(humanize(obj.proficiencyBadge.evidenceSupport))}${obj.proficiencyBadge.evidenceRefs.length > 0 ? ` · <code>${escapeHtml(obj.proficiencyBadge.evidenceRefs.join(", "))}</code>` : ""}</span> <button type="button" class="btn-secondary" data-action="view-evidence" data-objective-id="${escapeHtml(obj.objectiveId)}">View evidence</button></td>
  </tr>`).join("\n");

  const resourceCards = basePlanModel.outlineActivities.flatMap((act) => act.resourceProvenanceCards)
    .filter((card, idx, arr) => arr.findIndex((item) => item.resourceVersionId === card.resourceVersionId) === idx);
  const resourcesHtml = resourceCards.map((card) => {
    const cert = card.optionalCertificationBadge
      ? `<span class="badge badge-cert-cost" data-optional-certification="true">Optional certification ${formatMinorCurrency(4900, "USD")}</span>`
      : `<span class="badge badge-cert-none">Core access ${formatMinorCurrency(0, "USD")}</span>`;
    const openLink = card.canonicalUrl
      ? `<a href="${escapeHtml(card.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary">Open source<span class="st-sr"> in a new tab</span></a>`
      : "";
    return `<article class="resource-catalog-card" data-resource-version-id="${escapeHtml(card.resourceVersionId)}" data-opaque-surface="true">
      <div class="resource-main">
        <h3>${escapeHtml(card.title)}</h3>
        <p class="meta-text">${escapeHtml(card.verifiedPublisher)} · Version captured <time datetime="${escapeHtml(card.versionTimestamp)}">${escapeHtml(formatDate(card.versionTimestamp))}</time></p>
        <p class="badge-row"><span class="badge badge-rights" data-rights-basis="${escapeHtml(card.rightsBadge.basis)}">${escapeHtml(rightsWords(card.rightsBadge))}</span><span class="badge">${escapeHtml(humanize(card.accessModel))} access</span>${cert}</p>
        <p class="prose">${escapeHtml(card.selectionRationale)}</p>
        ${card.optionalCertificationBadge ? `<p class="prose warning-copy">${escapeHtml(card.optionalCertificationBadge.label)}. Separate optional cost ${formatMinorCurrency(4900, "USD")}. Opening the source does not mark the activity complete.</p>` : `<p class="prose meta-text">No paid certification is required for core access (${formatMinorCurrency(0, "USD")}). Opening the source does not mark the activity complete.</p>`}
      </div>
      ${openLink}
    </article>`;
  }).join("\n");

  const fourBucketsHtml = Object.values(costBreakdown.buckets).map((bucket) => `<div class="cost-bucket-card" data-bucket-id="${escapeHtml(bucket.bucketId)}">
    <h3>${escapeHtml(bucket.label)}</h3>
    <p class="bucket-mechanism">Mechanism: <code>${escapeHtml(bucket.billingMechanism)}</code></p>
    <p class="bucket-summary"><strong>${escapeHtml(bucket.formattedSummary)}</strong></p>
    <ul class="bucket-lines">${bucket.lineItems.map((li) => `<li data-line-id="${escapeHtml(li.id)}" data-unknown-price="${li.isUnknownPrice}">${escapeHtml(li.label)}: <strong>${escapeHtml(li.formattedAmount)}</strong></li>`).join("")}</ul>
  </div>`).join("\n");

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
      <div class="schedule-edit">
        <label class="field" for="reschedule-${escapeHtml(sessionId)}">New local time
          <input id="reschedule-${escapeHtml(sessionId)}" type="datetime-local" data-reschedule-for="${escapeHtml(sessionId)}" name="reschedule-${escapeHtml(sessionId)}">
        </label>
        <button type="button" class="btn-secondary" data-action="reschedule-session" data-session-id="${escapeHtml(sessionId)}">Reschedule</button>
      </div>
      ${preview}
    </li>`;
  }).join("\n");

  const practiceFeedback = practiceSubmitted
    ? `<p class="prose" role="status">Submitted${practiceChoice ? `: ${escapeHtml(practiceChoice)}` : ""}. This check is not demonstrated competence.</p>`
    : `<p class="meta-text">Selecting an option does not submit or advance.</p>`;
  const hintHtml = hintRequested ? `<p class="prose" role="status">Hint: the scale keeps the dot-product variance from growing with d_k. Assistance is recorded without a penalty.</p>` : "";
  const solutionHtml = workedSolutionRevealed ? `<p class="prose" role="status">Worked solution: softmax(QK^T / sqrt(d_k)) V. Studying the solution records assistance and does not mark the objective demonstrated.</p>` : "";
  // The ready state needs no banner. Any other state still shows above the Next-up bar.
  const recoveryBanner = todayState.asyncRecoveryBanner.state === "ready" ? "" : `<p class="status-banner" role="${todayState.asyncRecoveryBanner.role}"><strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)} ${escapeHtml(todayState.asyncRecoveryBanner.actionableNextStep)}</p>`;

  const openDialogId = inputState.openDialogId ?? null;
  const dialogOpen = (id: string) => ` data-open="${openDialogId === id}"`;
  const totalEffort = basePlanModel.totalDurationTriplet;

  return `<div class="curriculum-app-shell" data-theme="${resolvedThemeMode}" data-theme-preference="${themePreference}" data-solid-surfaces="${solidSurfaces}" data-reduce-motion="${reduceMotion}" data-auth-status="${authStatus}" data-breakpoint="${layout.breakpoint}" data-navigation-chrome="${layout.navigationChrome}" data-current-top-level="${activeTopLevel}" data-current-learn-sub="${activeLearnSub}" data-current-plan-view="${activePlanView}" data-selected-module-id="${escapeHtml(basePlanModel.selectedModuleId ?? "")}" data-selected-activity-id="${escapeHtml(basePlanModel.selectedActivityId ?? "")}" style="--active-canvas: ${palette.colors.canvas}; --active-surface: ${studySurface.backgroundColor};">
  <a class="skip-link" href="#main-workspace">Skip to main study workspace</a>
  ${renderToString(h(HeaderBar, {
    activeTopLevel,
    authStatus,
    signedOut,
    account,
    studyMinutes,
    selfReportedCount,
  }))}
  ${renderToString(h(SessionExpiredBanner, { authStatus }))}
  <div class="app-body-grid">
    ${renderToString(h(AppSidebar, {
      signedOut,
      activeTopLevel,
      activeLearnSub,
      goalTitle: basePlanModel.goal.title,
      totalEffort,
    }))}
    <main id="main-workspace" class="app-main-workspace" role="main" tabindex="-1">
      ${signedOut ? "" : `      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${isLearn}"${isLearn ? "" : " hidden"}>
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${isLearn && activeLearnSub === "Today"}"${isLearn && activeLearnSub === "Today" ? "" : " hidden"}>
          <div class="section-header today-page-header">
            <h1 class="page-title">Today</h1>
            <div class="plan-toolbar">
              <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-new-curriculum">New Curriculum</button>
            </div>
          </div>
          <section class="today-curricula-grid" aria-label="Active curricula">
          ${queueCardsHtml}
          </section>
          <div class="today-active-workspace">
            <header class="today-unified-header" data-opaque-surface="true">
              <div class="section-header">
                <div class="today-selected-heading">
                  <span class="today-selected-eyebrow">Focused curriculum</span>
                  <h2 class="today-selected-title">${escapeHtml(goalTitleOf(selectedPlan.curriculum))}</h2>
                </div>
                <div class="plan-toolbar">
                  <label class="field field-inline" for="selected-plan-control"><span>Selected plan</span>
                    <select id="selected-plan-control" name="selected-plan" data-action="select-curriculum">${planOptionsHtml}</select>
                  </label>
                </div>
              </div>
              ${recoveryBanner}
              ${nextUpRowHtml}
            </header>
            ${todayBoardHtml}
          </div>
          <section class="surface-panel study-workspace" id="study-workspace" data-opaque-surface="true">
            <h2>Study</h2>
            <p class="prose">One task: ${escapeHtml(nextUp?.title ?? "Scaled dot-product attention")}. ${escapeHtml(nextUp?.requirementLevel === "optional" ? "Optional" : "Required")}.</p>
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
              <h3>Honest Two-Layer Status Summary</h3>
              <p class="prose">Self-reporting an activity as completed records study effort idempotently (<code>self_reported_completed</code>) but never upgrades objective proficiency to <code>demonstrated</code> without reviewed assessment evidence.</p>
            </div>
          </section>
          <section class="today-bottom-grid" aria-label="Reviews and completed work" data-opaque-surface="true">
            <section class="review-queue" data-review-separation-valid="${todayState.reviewSeparationValid}" aria-labelledby="review-queue-title">
              <h2 id="review-queue-title">Review queue <span class="count-badge">${reviewRows.length}</span></h2>
              <p class="meta-text">Due and scheduled spaced review stays in a separate session.</p>
              ${listOrEmpty(reviewRows, "today", "No reviews are due.")}
            </section>
            <section class="completed-history" aria-labelledby="completed-history-title">
              <h2 id="completed-history-title">Completed work <span class="count-badge">${completedRows.length}</span></h2>
              ${listOrEmpty(completedRows, "check", "No self-reported completions yet.")}
            </section>
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
              <label class="field field-inline" for="plan-curriculum-control"><span>Curriculum</span>
                <select id="plan-curriculum-control" name="plan-curriculum" data-action="select-curriculum">${planOptionsHtml}</select>
              </label>
              <div class="plan-view-switcher segmented" role="group" aria-label="Map or outline">
                ${PLAN_SYNCHRONIZED_VIEWS.map((view) => `<button type="button" class="seg-btn" data-action="switch-plan-view" data-plan-view="${view}" aria-pressed="${view === activePlanView}">${view}</button>`).join("\n")}
              </div>
              <button type="button" class="btn-primary" data-action="activate-revision" data-curriculum-id="${escapeHtml(revisionActivationReq.curriculumId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">Activate plan</button>
              <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share to Marketplace</button>
            </div>
          </div>
          ${selectedPlan.draft ? `<p class="draft-notice" role="status">This plan is your private draft of ${originListing ? `${escapeHtml(originListing.handle)}'s template` : "a community template"}. Review it, then select Activate plan to add it to Today.</p>` : ""}
          <p class="prose plan-goal">${escapeHtml(basePlanModel.goal.summary)}</p>
          <p class="meta-text">${requiredSummary}. ${evidenceSummary}. ${reviewSummary}.</p>
          <p class="prose meta-text">Included: ${escapeHtml(basePlanModel.goal.includedTopics.join(", ") || "none")}. Excluded: ${escapeHtml(basePlanModel.goal.excludedTopics.join(", ") || "none")}. ${escapeHtml(basePlanModel.goal.scopeNote)}</p>
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
          <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">${planBoardHtml}</div>
          ${relationshipLegend}
        </section>

        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${isLearn && activeLearnSub === "Progress"}"${isLearn && activeLearnSub === "Progress" ? "" : " hidden"}>
          <h1 class="page-title">Progress</h1>
          <div class="progress-summaries">
            <section class="progress-summary"><h2>Required activities completed</h2><p>${requiredSummary}</p></section>
            <section class="progress-summary"><h2>Objectives with qualifying evidence</h2><p>${evidenceSummary}</p></section>
            <section class="progress-summary"><h2>Reviews due</h2><p>${reviewSummary}</p></section>
          </div>
          ${macroStageHtml}
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
      </section>`}

      ${renderToString(h(ExploreMarketplace, {
        active: activeTopLevel === "Explore",
        signedOut,
        account,
        listings,
        votes,
        adoptions,
        myPlans,
        proficiency,
        catalogResources,
        marketplaceDomain,
        marketplaceRigor,
        marketplaceSort,
        marketplaceQuery,
        loadMoreNote,
      }))}

      ${signedOut ? "" : `      <section class="top-level-panel" id="panel-settings" data-top-panel="Settings" data-active="${activeTopLevel === "Settings"}"${activeTopLevel === "Settings" ? "" : " hidden"}>
        <h1 class="page-title">Settings</h1>
        <div class="settings-stack">
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Account</h2>
            <p>Signed-in learner <code>learner-default</code>.</p>
            <p class="prose">Account-provider sign-in and payment checkout are not connected in this build. This screen does not invent a successful profile or payment response.</p>
          </section>
          <section class="surface-panel settings-group" data-opaque-surface="true">
            <h2>Appearance</h2>
            <div class="theme-selector-group segmented" role="group" aria-label="Theme">
              ${(["light", "dark", "system"] as const).map((mode) => `<button type="button" class="seg-btn" data-action="set-theme" data-theme-value="${mode}" aria-pressed="${themePreference === mode}">${mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}</button>`).join("\n")}
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
            <div class="schedule-edit">
              <label class="field" for="snooze-minutes">Snooze
                <select id="snooze-minutes" name="snooze"><option>15 minutes</option><option>30 minutes</option><option>60 minutes</option></select>
              </label>
              <div class="action-row">
                <button type="button" class="btn-secondary" data-action="snooze-reminder">Snooze</button>
                <button type="button" class="btn-secondary" data-action="pause-reminders">${remindersPaused ? "Resume reminders" : "Pause"}</button>
              </div>
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
            <div class="schedule-edit">
              <label class="field" for="byok-key">Provider key <span class="meta-text">Transient and optional until you replace a key</span>
                <input id="byok-key" name="provider-key" type="${keyVisible ? "text" : "password"}" autocomplete="off" spellcheck="false" data-transient-key="true" value="">
              </label>
              <button type="button" class="btn-secondary" data-action="toggle-key-visibility">${keyVisible ? "Hide" : "Show"}</button>
            </div>
            <ul class="credential-list">
              ${byokState.credentials.map((cred) => `<li class="credential-item" data-credential-ref="${escapeHtml(cred.credential_ref)}" data-provider-id="${escapeHtml(cred.provider_id)}">
                <p><strong>${escapeHtml(cred.label ?? cred.provider_id)}</strong> <code>${escapeHtml(cred.masked_hint)}</code> <span class="badge">${escapeHtml(cred.status)}</span></p>
                <p class="meta-text">Provider <code>${escapeHtml(cred.provider_id)}</code>. Version <code>${escapeHtml(cred.etag ?? "")}</code>. Updated ${escapeHtml(cred.updated_at ?? "unknown")}. The saved secret is not shown again.</p>
                <div class="action-row">
                  <button type="button" class="btn-secondary" data-action="replace-key" data-credential-ref="${escapeHtml(cred.credential_ref)}">Replace key</button>
                  <button type="button" class="btn-danger" data-action="delete-connection" data-credential-ref="${escapeHtml(cred.credential_ref)}">Delete connection</button>
                </div>
                <p class="prose meta-text">Replace key submits a new transient value and does not move queued jobs to another account. Delete connection removes this app's encrypted copy. It does not revoke the key at the issuer.</p>
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
      </section>`}
    </main>
  </div>
  ${signedOut ? "" : inspectorHtml}
  ${renderToString(h(CompactBottomNav, { activeTopLevel }))}

  ${signedOut ? "" : `  <dialog id="dialog-new-curriculum" closedby="any" aria-labelledby="dialog-new-curriculum-title"${dialogOpen("dialog-new-curriculum")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-new-curriculum-title">New Curriculum &amp; Preferences</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p class="prose meta-text">Goal and scope → Background and approach → Time and access → Review and generate</p>
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
          <p>Inherited: Tokenization, Formal. This follows the global default.</p>
          <p>${depthOverrideReset ? "Matrix calculus override removed. Inherited depth follows the global default." : "Override: Matrix calculus, Formal."}</p>
          <label class="field" for="topic-depth-override">Per-topic override <span class="meta-text">Optional</span>
            <select id="topic-depth-override" name="topic-depth-override"><option>Matrix calculus: Formal</option></select>
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

  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title"${dialogOpen("dialog-adaptation-diff")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      ${adaptationBody}
    </form>
  </dialog>

  ${renderToString(h(AdoptCurriculumDialog, {
    open: openDialogId === "dialog-partial-adoption",
    adoptListing: listings.find((listing) => listing.publicationId === inputState.adoptPublicationId) ?? null,
    adoptions,
    adoptScope,
    adoptModuleIds: inputState.adoptModuleIds ?? [],
    proficiency,
    catalogResources,
  }))}

  ${renderToString(h(PublicationPreviewDialog, {
    open: openDialogId === "dialog-publication-preview",
    account,
    selectedPlan,
    publishedFromHere: listings.some((listing) => listing.ownerAccountId === account.accountId && listing.sourceCurriculumId === selectedPlan.curriculumId),
    originListing,
  }))}

  <dialog id="dialog-unpublish" closedby="any" aria-labelledby="dialog-unpublish-title"${dialogOpen("dialog-unpublish")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-unpublish-title">Unpublish</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies.</p>
      <p class="prose">This screen does not call a live unpublish route and does not report success.</p>
    </form>
  </dialog>

  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title"${dialogOpen("dialog-account-deletion")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p>Export Scope Included: <code>${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}</code></p>
      <p>Export Scope Excluded: <code>${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}</code></p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.financialAuditRetention)} Deletion does not promise immediate removal from every backup.</p>
    </form>
  </dialog>`}

  ${renderToString(h(AuthDialog, {
    open: openDialogId === "dialog-auth",
    authStatus,
    account,
    returnTo,
    authNotice,
  }))}

  <script data-dialog-light-dismiss-fallback="true">
${getDialogLightDismissFallbackScript()}
  </script>
</div>`;
}
export function createCurriculumWebAppController(initialState: CurriculumWebAppStateInput = {}) {
  let topLevel: TopLevelDestination = initialState.topLevel ?? "Learn";
  let learnSubDestination: LearnSubDestination = initialState.learnSubDestination ?? "Today";
  let planView: PlanSynchronizedView = initialState.planView ?? "Map";
  let authStatus: AuthStatus = initialState.authStatus ?? "authenticated";
  let account: Account = initialState.account ?? PERSONAS.learner;
  let returnTo: ReturnDestination | null = initialState.returnTo ?? null;
  let authNotice: string | null = initialState.authNotice ?? null;
  let marketplaceDomain: MarketplaceDomain = initialState.marketplaceDomain ?? "All";
  let marketplaceRigor: MarketplaceRigor = initialState.marketplaceRigor ?? "All";
  let marketplaceSort: MarketplaceSort = initialState.marketplaceSort ?? "top_upvoted";
  let marketplaceQuery = initialState.marketplaceQuery ?? "";
  let votes: Vote[] = [...(initialState.votes ?? [])];
  let adoptions: Adoption[] = [...(initialState.adoptions ?? [])];
  let publishedListings: MarketplaceListing[] = [...(initialState.publishedListings ?? [])];
  let adoptPublicationId: string | null = initialState.adoptPublicationId ?? null;
  let adoptScope: "full" | "units" = initialState.adoptScope ?? "full";
  let adoptModuleIds: string[] = [...(initialState.adoptModuleIds ?? [])];
  const listings = (): readonly MarketplaceListing[] => [...MARKETPLACE_LISTINGS, ...publishedListings];
  const currentPlans = () => plansFor(account.accountId, adoptions, listings());
  const isMyPlan = (curriculumId: unknown): curriculumId is string => currentPlans().some((plan) => plan.curriculumId === curriculumId);
  // Input overrides replace the selected plan's curriculum and schedule, the same rule the render applies.
  let selectedCurriculumId = planIn(currentPlans(), initialState.selectedCurriculumId).curriculumId;
  const planData = (): ActiveCurriculum => {
    const plan = planIn(currentPlans(), selectedCurriculumId);
    return { ...plan, curriculum: initialState.curriculum ?? plan.curriculum, schedule: initialState.schedule ?? plan.schedule };
  };
  const openingStep = stepOf(planData().curriculum, initialState.selectedActivityId);
  let selectedModuleId: string | null = initialState.selectedModuleId ?? openingStep.moduleId;
  let selectedActivityId: string | null = initialState.selectedActivityId ?? openingStep.activityId;
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
  let skippedActivityIds: string[] = [...(initialState.skippedActivityIds ?? [])];
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
  let openDialogId: string | null = initialState.openDialogId ?? null;

  const proficiency = initialState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const catalogResources = initialState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;
  let flowOrder: FlowOrder = initialState.flowOrder ?? plannedFlowOrder(planData().curriculum);
  let deepDive: DeepDiveMode = initialState.deepDive ?? "included";
  let spacedReview: SpacedReviewMode = initialState.spacedReview ?? "included";

  // A learner's explicit Not started or In progress choice overrides the initial state. Events replay after it,
  // so a later Done still wins. Today is rebuilt when events are dropped, so counts and minutes stay exact.
  const statusOverrides = new Map<string, ActivityExecutionStatus>();
  let recordedProgressEvents: ProgressEventInput[] = [...(initialState.recordedProgressEvents ?? [])];
  const activityStatesInput = (): Readonly<Record<string, ActivityExecutionStatus>> =>
    ({ ...(initialState.activityStates ?? {}), ...Object.fromEntries(statusOverrides) });
  const todayFor = (plan: ActiveCurriculum) => buildTodayFor({
    curriculum: plan.curriculum, schedule: plan.schedule, proficiency, catalogResources,
    activityStates: activityStatesInput(), events: recordedProgressEvents,
  });
  const buildToday = () => todayFor(planData());
  let todayController = buildToday();

  function recordCompletion(activityId: string, explicitEventId?: string): RecordedProgressEventReceipt {
    const eventId = explicitEventId ?? `evt-complete-${activityId}`;
    const ev: ProgressEventInput = { eventId, activityId, type: "self_reported_completed" };
    if (!recordedProgressEvents.some((e) => (e.eventId ?? e.event_id) === eventId)) {
      recordedProgressEvents.push(ev);
    }
    return todayController.recordProgressEvent(ev);
  }

  // Done records a self-reported completion. Not started and In progress also drop that activity's
  // completion events, so a corrected mistake no longer counts toward completions or study minutes.
  function setActivityStatus(activityId: string, status: SettableStatus) {
    if (!signedIn()) return requireSignIn(placeOf(topLevel, learnSubDestination));
    if (status === "completed") {
      if (!isClosed(todayController.getState().activityExecutionStates[activityId] ?? "not_started")) recordCompletion(activityId);
      return getState();
    }
    statusOverrides.set(activityId, status);
    recordedProgressEvents = recordedProgressEvents.filter((ev) => (ev.activityId ?? ev.activity_id) !== activityId);
    todayController = buildToday();
    return getState();
  }

  const buildCurrentPlanModel = (): PlanMapAndOutlineModel =>
    buildPlanMapAndOutlineModel({
      curriculum: planData().curriculum, proficiency, activityStates: todayController.getState().activityExecutionStates,
      catalogResources, viewportWidthPx, selectedModuleId, selectedActivityId, focusedNodeId, zoom,
    });

  function selectPlanActivity(activityId: string, explicitModuleId?: string, _sourceView?: PlanSynchronizedView) {
    selectedActivityId = activityId;
    studyDetailOpen = true;
    const targetModId =
      explicitModuleId ?? buildCurrentPlanModel().outlineModules.find((m) => m.activityIds.includes(activityId))?.moduleId;
    if (targetModId) {
      selectedModuleId = targetModId;
      focusedNodeId = targetModId;
    }
    return getState();
  }

  // Another plan opens on its own first step, with the drawer closed.
  function selectCurriculum(curriculumId: string): void {
    if (curriculumId === selectedCurriculumId) return;
    selectedCurriculumId = curriculumId;
    const first = stepOf(planData().curriculum);
    selectedModuleId = first.moduleId;
    selectedActivityId = first.activityId;
    focusedNodeId = first.moduleId;
    studyDetailOpen = false;
    todayController = buildToday();
  }

  const signedIn = (): boolean => authStatus === "authenticated";
  const placeOf = (
    place: TopLevelDestination, sub: LearnSubDestination, dialogId: string | null = null, publicationId: string | null = null, label?: string,
  ): ReturnDestination => ({
    label: label ?? (place === "Learn" ? `Learn › ${sub}` : place), topLevel: place, learnSubDestination: sub,
    openDialogId: dialogId, adoptPublicationId: publicationId,
  });

  // Ask for sign-in and remember where to return. The action that asked does not run (UI-009).
  function requireSignIn(destination: ReturnDestination) {
    returnTo = destination;
    authNotice = null;
    openDialogId = "dialog-auth";
    return getState();
  }

  // Clears this browser's private session state: progress, statuses, practice, notes, selection, and open dialogs (@S87).
  // Account-owned records (votes, adoptions, and publications) stay with their account.
  function purgeSessionState(): void {
    recordedProgressEvents = [];
    statusOverrides.clear();
    skippedActivityIds = [];
    hintRequested = false;
    workedSolutionRevealed = false;
    practiceSubmitted = false;
    practiceChoice = null;
    keyVisible = false;
    loadMoreNote = null;
    intakeNote = null;
    keyActionNote = null;
    snoozeNote = null;
    rescheduleSessionId = null;
    rescheduleValue = null;
    depthOverrideReset = false;
    diagnosticControl = "active";
    adaptationChoice = "pending";
    adoptPublicationId = null;
    adoptScope = "full";
    adoptModuleIds = [];
    studyDetailOpen = false;
    openDialogId = null;
    selectedCurriculumId = RAG_PLAN.curriculumId;
    const first = stepOf(planData().curriculum);
    selectedModuleId = first.moduleId;
    selectedActivityId = first.activityId;
    focusedNodeId = first.moduleId;
    todayController = buildToday();
  }

  // Signing in restores the place the learner asked for, never the action. Another account starts clean (@S87).
  function signIn(next: Account): void {
    if (next.accountId !== account.accountId) purgeSessionState();
    account = next;
    authStatus = "authenticated";
    authNotice = null;
    openDialogId = null;
    const destination = returnTo;
    returnTo = null;
    if (!destination) return;
    topLevel = destination.topLevel;
    learnSubDestination = destination.learnSubDestination;
    openDialogId = destination.openDialogId;
    if (destination.adoptPublicationId) {
      adoptPublicationId = destination.adoptPublicationId;
      adoptScope = "full";
      adoptModuleIds = [];
    }
  }

  function signInWithEmail(email: string): void {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      authNotice = "Enter a valid email address.";
      openDialogId = "dialog-auth";
      return;
    }
    signIn(Object.values(PERSONAS).find((persona) => persona.email === address) ?? { accountId: `account-${address}`, email: address, role: "Learner" });
  }

  // A guest browses public curricula, so signing out lands on Explore.
  function signOut(): void {
    purgeSessionState();
    authStatus = "guest";
    returnTo = null;
    authNotice = null;
    topLevel = "Explore";
  }

  function expireSession(): void {
    authStatus = "session_expired";
    returnTo = placeOf(topLevel, learnSubDestination);
    openDialogId = null;
  }

  // A listing this account can adopt: it exists, the account does not own it, and no plan already came from it.
  const adoptableListing = (publicationId: unknown): MarketplaceListing | undefined => {
    const listing = listings().find((entry) => entry.publicationId === publicationId);
    const taken = currentPlans().some((plan) => plan.publicationId === publicationId);
    return listing && listing.ownerAccountId !== account.accountId && !taken ? listing : undefined;
  };
  const adoptUnitIds = (): readonly string[] => {
    const listing = listings().find((entry) => entry.publicationId === adoptPublicationId);
    return listing ? publicProjectionOf(listing.curriculum).modules.map((mod) => mod.module_id) : [];
  };

  // Adoption makes a private draft and opens it on the Plan page. Activation stays a separate, explicit step (@S59).
  function adopt(listing: MarketplaceListing): void {
    const requested = adoptScope === "units" ? adoptModuleIds : [];
    if (adoptScope === "units" && requested.length === 0) return;
    const moduleIds = adoptionScopeOf(listing, requested).resolvedModuleIds;
    adoptions = [...adoptions, { accountId: account.accountId, publicationId: listing.publicationId, moduleIds, active: false }];
    adoptPublicationId = null;
    adoptScope = "full";
    adoptModuleIds = [];
    openDialogId = null;
    selectCurriculum(`adopted-${listing.publicationId}`);
    topLevel = "Learn";
    learnSubDestination = "Plan";
  }

  function activateSelectedDraft(): void {
    adoptions = adoptions.map((adoption) => (adoption.accountId === account.accountId && `adopted-${adoption.publicationId}` === selectedCurriculumId
      ? { ...adoption, active: true } : adoption));
  }

  const publishedFromSelected = (): boolean =>
    listings().some((listing) => listing.ownerAccountId === account.accountId && listing.sourceCurriculumId === selectedCurriculumId);

  // Publishing adds an immutable public revision of the selected plan to Explore and My Publications (@S56).
  // The listing keeps the plan's structure and drops account, evidence, date, and reminder data (@S57).
  function publishSelectedPlan(): void {
    const plan = planData();
    const key = `${plan.curriculumId}-${account.accountId}`;
    const origin = listings().find((listing) => listing.publicationId === plan.publicationId && listing.ownerAccountId !== account.accountId);
    publishedListings = [...publishedListings, {
      publicationId: `publication-${key}`, revisionId: `public-revision-${key}-1`,
      subject: plan.domain, gateStyle: plan.assessmentMode, handle: handleOf(account),
      upvotes: 0, adoptions: 0, publishedAt: new Date().toISOString(),
      ownerAccountId: account.accountId, sourceCurriculumId: plan.curriculumId, basedOn: origin?.handle ?? null,
      curriculum: {
        ...plan.curriculum, account_id: "public-template",
        objectives: rawListOf(plan.curriculum, "objectives").map((objective) => ({ ...objective, prior_evidence_refs: [] })),
      },
      schedule: {
        ...plan.schedule,
        sessions: rawListOf(plan.schedule, "sessions").map((session) => ({
          session_id: session["session_id"], duration_minutes: session["duration_minutes"], activity_ids: session["activity_ids"],
        })),
      },
    }];
    openDialogId = null;
    topLevel = "Explore";
  }

  const getState = () => {
    const tState = todayController.getState();
    // Study minutes and completions count across every active plan, as the app header shows them.
    const allToday = currentPlans().map((plan) => (plan.curriculumId === selectedCurriculumId ? tState : todayFor(plan).getState()));
    return {
      topLevel, learnSubDestination, planView, selectedCurriculumId, selectedModuleId, selectedActivityId, focusedNodeId,
      zoom, viewportWidthPx, textScalePercent, themePreference, solidSurfaces, reduceMotion,
      activityStates: tState.activityExecutionStates,
      recordedProgressEvents: [...recordedProgressEvents] as readonly ProgressEventInput[],
      recordedReceipts: tState.recordedEvents,
      totalStudyMinutes: allToday.reduce((sum, today) => sum + today.totalStudyMinutes, 0),
      selfReportedCompletedCount: allToday.reduce((sum, today) => sum + today.selfReportedCompletedCount, 0),
      authStatus, account, returnTo, authNotice, marketplaceDomain, marketplaceRigor, marketplaceSort, marketplaceQuery,
      votes: [...votes] as readonly Vote[], adoptions: [...adoptions] as readonly Adoption[],
      publishedListings: [...publishedListings] as readonly MarketplaceListing[],
      adoptPublicationId, adoptScope, adoptModuleIds: [...adoptModuleIds] as readonly string[],
      openDialogId, hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice,
      skippedActivityIds: [...skippedActivityIds] as readonly string[],
      remindersEnabled, remindersPaused, keyVisible, diagnosticControl, adaptationChoice,
      loadMoreNote, intakeNote, keyActionNote, snoozeNote, rescheduleSessionId, rescheduleValue,
      depthOverrideReset, studyDetailOpen, flowOrder, deepDive, spacedReview,
    };
  };

  return {
    getState,
    renderHtml: (): string => {
      const { activityStates: _a, ...restState } = getState();
      return renderCurriculumWebAppHtml({ ...initialState, ...restState, activityStates: activityStatesInput() });
    },
    navigateTopLevel(destination: TopLevelDestination) {
      if (destination !== "Explore" && !signedIn()) return requireSignIn(placeOf(destination, learnSubDestination));
      topLevel = destination;
      studyDetailOpen = false;
      return getState();
    },
    navigateLearnSubDestination(subDestination: LearnSubDestination) {
      if (!signedIn()) return requireSignIn(placeOf("Learn", subDestination));
      topLevel = "Learn";
      learnSubDestination = subDestination;
      studyDetailOpen = false;
      return getState();
    },
    switchPlanView(view: PlanSynchronizedView) {
      topLevel = "Learn";
      learnSubDestination = "Plan";
      planView = view;
      studyDetailOpen = false;
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
    selectPlanActivity,
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
    recordTodayActivityCompletion(activityId: string, explicitEventId?: string): RecordedProgressEventReceipt | null {
      if (!signedIn()) {
        requireSignIn(placeOf(topLevel, learnSubDestination));
        return null;
      }
      return recordCompletion(activityId, explicitEventId);
    },
    setActivityStatus,
    setThemePreference(theme: ThemePreference) {
      themePreference = theme;
      return getState();
    },
    // A vote belongs to the signed-in account and to one revision. A guest is asked to sign in, and no vote is cast.
    toggleUpvote(publicationRevisionId = MARKETPLACE_LISTINGS[0]?.revisionId ?? "") {
      if (!signedIn()) return requireSignIn(placeOf("Explore", learnSubDestination));
      if (!listings().some((listing) => listing.revisionId === publicationRevisionId)) return getState();
      const mine = (vote: Vote) => vote.accountId === account.accountId && vote.revisionId === publicationRevisionId;
      votes = votes.some(mine) ? votes.filter((vote) => !mine(vote)) : [...votes, { accountId: account.accountId, revisionId: publicationRevisionId }];
      return getState();
    },
    openDialog(dialogId: string) {
      if (dialogId !== "dialog-auth" && !signedIn()) {
        const label = dialogId === "dialog-publication-preview" ? "Share to Marketplace" : undefined;
        return requireSignIn(placeOf(topLevel, learnSubDestination, dialogId, null, label));
      }
      openDialogId = dialogId;
      return getState();
    },
    closeDialog() {
      // A guest who closes the sign-in dialog has dropped that return. An expired session keeps it for the banner.
      if (openDialogId === "dialog-auth" && authStatus === "guest") returnTo = null;
      openDialogId = null;
      return getState();
    },
    applyUiAction(action: string, data: Readonly<Record<string, string | undefined>> = {}, submittedChoice: string | null = null) {
      const value = (key: string) => data[key];
      // Without a valid session only reading, filtering, appearance, and signing in run. Anything else asks for sign-in.
      if (!signedIn() && !OPEN_ACTIONS.has(action)) {
        const listing = action === "open-adopt-dialog" ? listings().find((entry) => entry.publicationId === value("publicationId")) : undefined;
        requireSignIn(listing
          ? placeOf("Explore", learnSubDestination, "dialog-partial-adoption", listing.publicationId, `Explore › Preview & Adopt: ${goalTitleOf(listing.curriculum)}`)
          : placeOf(topLevel, learnSubDestination));
        return { handled: true, state: getState() };
      }
      let handled = true;
      if (action === "close-study-detail") studyDetailOpen = false;
      else if (action === "submit-sign-in") signInWithEmail(value("email") ?? "");
      else if (action === "sign-in-passkey") signIn(account);
      else if (action === "switch-persona" && isOneOf(PERSONA_CHOICES, data["persona"])) {
        if (data["persona"] === "guest") signOut();
        else signIn(PERSONAS[data["persona"]]);
      } else if (action === "simulate-session-expired" && signedIn()) expireSession();
      else if (action === "sign-out" && authStatus !== "guest") signOut();
      else if (action === "set-marketplace-domain" && isOneOf(MARKETPLACE_DOMAINS, data["domain"])) marketplaceDomain = data["domain"];
      else if (action === "set-marketplace-rigor" && isOneOf(MARKETPLACE_RIGORS, data["rigor"])) marketplaceRigor = data["rigor"];
      else if (action === "set-marketplace-sort" && isOneOf(MARKETPLACE_SORTS, data["sort"])) marketplaceSort = data["sort"];
      else if (action === "set-marketplace-query") marketplaceQuery = (value("query") ?? "").trim().slice(0, 100);
      else if (action === "open-adopt-dialog" && adoptableListing(data["publicationId"])) {
        adoptPublicationId = data["publicationId"] ?? null;
        adoptScope = "full";
        adoptModuleIds = [];
        openDialogId = "dialog-partial-adoption";
      } else if (action === "set-adopt-scope" && (data["scope"] === "full" || data["scope"] === "units")) {
        adoptScope = data["scope"];
        adoptModuleIds = [];
      } else if (action === "toggle-adopt-module" && adoptScope === "units" && adoptUnitIds().includes(data["moduleId"] ?? "")) {
        const moduleId = data["moduleId"] ?? "";
        adoptModuleIds = adoptModuleIds.includes(moduleId) ? adoptModuleIds.filter((id) => id !== moduleId) : [...adoptModuleIds, moduleId];
      } else if (action === "confirm-adopt-curriculum") {
        const listing = adoptableListing(data["publicationId"]);
        if (listing) adopt(listing);
      } else if (action === "confirm-publish-curriculum" && !publishedFromSelected()) publishSelectedPlan();
      else if (action === "activate-revision" && planData().draft) activateSelectedDraft();
      else if (action === "select-curriculum" && isMyPlan(data["curriculumId"])) selectCurriculum(data["curriculumId"]);
      else if (action === "open-curriculum-plan" && isMyPlan(data["curriculumId"])) {
        selectCurriculum(data["curriculumId"]);
        topLevel = "Learn";
        learnSubDestination = "Plan";
      } else if (action === "resume-curriculum" && isMyPlan(data["curriculumId"]) && data["activityId"]) {
        selectCurriculum(data["curriculumId"]);
        selectPlanActivity(data["activityId"], data["moduleId"]);
      } else if (action === "set-flow-order" && isOneOf(FLOW_ORDERS, value("flowOrder"))) flowOrder = value("flowOrder") as FlowOrder;
      else if (action === "set-deep-dive" && isOneOf(DEEP_DIVE_MODES, value("deepDive"))) deepDive = value("deepDive") as DeepDiveMode;
      else if (action === "set-spaced-review" && isOneOf(SPACED_REVIEW_MODES, value("spacedReview"))) spacedReview = value("spacedReview") as SpacedReviewMode;
      else if (action === "toggle-solid-surfaces") solidSurfaces = !solidSurfaces;
      else if (action === "toggle-reduce-motion") reduceMotion = !reduceMotion;
      else if (action === "request-hint") hintRequested = true;
      else if (action === "study-worked-solution") workedSolutionRevealed = true;
      else if (action === "submit-practice") {
        practiceSubmitted = true;
        practiceChoice = submittedChoice;
      } else if (action === "set-activity-status" && data["activityId"] && isOneOf(SETTABLE_STATUSES, data["status"])) {
        setActivityStatus(data["activityId"], data["status"]);
      } else if (action === "skip-activity" && data["activityId"]) {
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

interface MountedDialog {
  readonly id?: string;
  readonly open?: boolean;
  showModal?: () => void;
  close?: () => void;
  getAttribute?: (name: string) => string | null;
  getBoundingClientRect?: () => { top: number; left: number; width: number; height: number };
  addEventListener?: (type: string, listener: (ev: { target?: unknown; clientX?: number; clientY?: number }) => void) => void;
}

export function mountCurriculumWebApp(
  rootElement: MountableRootElement,
  initialState: CurriculumWebAppStateInput = {},
): CurriculumWebAppController {
  const controller = createCurriculumWebAppController(initialState);

  // Native Esc, backdrop, and close() all fire "close"; the controller state follows it.
  function bindDialogs(): void {
    if (typeof rootElement.querySelectorAll !== "function") return;
    const supportsClosedBy =
      typeof globalThis.HTMLDialogElement !== "undefined" && "closedBy" in globalThis.HTMLDialogElement.prototype;
    for (const dialog of Array.from(rootElement.querySelectorAll("dialog")) as MountedDialog[]) {
      dialog.addEventListener?.("close", () => {
        if (dialog.id === INSPECTOR_ID) controller.applyUiAction("close-study-detail");
        else controller.closeDialog();
        syncDom();
      });
      if (supportsClosedBy || dialog.getAttribute?.("closedby") !== "any") continue;
      dialog.addEventListener?.("click", (event) => {
        if (event.target !== dialog || typeof dialog.getBoundingClientRect !== "function") return;
        const rect = dialog.getBoundingClientRect();
        const clientX = event.clientX ?? -1;
        const clientY = event.clientY ?? -1;
        const inContent =
          rect.top <= clientY && clientY <= rect.top + rect.height && rect.left <= clientX && clientX <= rect.left + rect.width;
        if (!inContent) dialog.close?.();
      });
    }
  }

  function syncDom(): void {
    rootElement.innerHTML = controller.renderHtml();
    bindDialogs();
    const marked = rootElement.querySelector?.('dialog[data-open="true"]') as MountedDialog | null | undefined;
    if (marked && typeof marked.showModal === "function" && !marked.open) marked.showModal();
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

  // A select reports its choice on change. A click on it only opens the list.
  rootElement.addEventListener?.("change", (rawEvent: unknown) => {
    const ev = rawEvent as { target?: { closest?: (s: string) => { value?: string } | null } | null };
    const select = ev.target?.closest?.('select[data-action="select-curriculum"]');
    if (select?.value && controller.applyUiAction("select-curriculum", { curriculumId: select.value }).handled) syncDom();
  });

  // The sign-in form and the Marketplace search submit through their own data-action, with the field they carry.
  rootElement.addEventListener?.("submit", (rawEvent: unknown) => {
    const ev = rawEvent as {
      target?: { closest?: (s: string) => { dataset?: Record<string, string | undefined> } | null } | null;
      preventDefault?: () => void;
    };
    const action = ev.target?.closest?.("form[data-action]")?.dataset?.["action"];
    if (!action) return;
    ev.preventDefault?.();
    const valueOf = (selector: string): string => (rootElement.querySelector?.(selector) as { value?: string } | null | undefined)?.value ?? "";
    const data = action === "submit-sign-in" ? { email: valueOf("#auth-email-input") } : { query: valueOf("#marketplace-search") };
    if (controller.applyUiAction(action, data).handled) syncDom();
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
    setActivityStatus: withSync(controller.setActivityStatus),
    setThemePreference: withSync(controller.setThemePreference),
    toggleUpvote: withSync(controller.toggleUpvote),
    openDialog: withSync(controller.openDialog),
    closeDialog: withSync(controller.closeDialog),
    applyUiAction: withSync(controller.applyUiAction),
  };
}
