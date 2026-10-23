import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  buildPlanMapAndOutlineModel, OBJECTIVE_PROFICIENCY_BADGE_STATUSES,
  renderTextWithLatexHtml, renderUntrustedCatalogText, resolveSurfaceStyle, resolveThemeMode, resolveThemePalette,
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
  StepRow, StudyFlowBoard, displayUnitTitle, effortWords, executionTone,
  executionWords, fit, humanize, isClosed, isOneOf, plannedFlowOrder, rightsWords, unitProgress,
  type DeepDiveMode, type FlowOrder, type FlowView, type SpacedReviewMode, type StudyActivity, type StudyModule,
} from "./components/StudyFlowBoard.tsx";
import {
  INSPECTOR_ID, InspectorDrawer, SETTABLE_STATUSES,
  type ConceptCheck, type InspectorMode, type SelfCheckRubric, type SettableStatus,
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
  AdoptCurriculumDialog, CurriculumTagStrip, ExploreMarketplace, MARKETPLACE_FACETS, MARKETPLACE_SORTS, NO_MARKETPLACE_FILTERS,
  PublicationPreviewDialog, adoptedPlanOf, adoptionScopeOf, asRecord, curriculumTagsOf, facetValuesOf, goalTitleOf, mathDepthFor,
  rawListOf, unitIdsOf, withMarketplaceFilter,
  type ActiveCurriculum, type Adoption, type CurriculumTagDescriptor, type MarketplaceFilters, type MarketplaceListing,
  type MarketplaceSort, type Vote,
} from "./components/ExploreMarketplace.tsx";
import {
  RESOURCE_CATEGORIES, RESOURCE_SCOPES, ResourcesView,
  type ResourceCategory, type ResourceScope,
} from "./components/ResourcesView.tsx";
import {
  DEFAULT_SUBJECT_TOPICS, INTAKE_DEPTH_CHOICES, INTAKE_FIT_MODES, INTAKE_FLOW_CHOICES,
  INTAKE_MATERIALS_CHOICES, INTAKE_SUBJECTS, NewCurriculumDialog, buildIndexedMaterialCandidates,
  evaluateIntakeResourceFit, executeIntakeGenerationPipeline, resolveDependentTopicToggle,
  type IntakeDepthChoice, type IntakeFitMode, type IntakeFlowChoice, type IntakeMaterialsChoice,
  type IntakePipelineExecutionReceipt, type IntakeSubject,
} from "./components/NewCurriculumDialog.tsx";
import { createCurriculumSignalStore, type CurriculumSignalStore } from "./state/store.ts";

export {
  createCurriculumSignalStore,
  curriculumTagsOf,
  type CurriculumSignalStore,
  type CurriculumTagDescriptor,
  type FlowOrder,
  type DeepDiveMode,
  type SpacedReviewMode,
  type AuthStatus,
  type Account,
  type PersonaChoice,
  type ReturnDestination,
  type MarketplaceFilters,
  type MarketplaceSort,
  type MarketplaceListing,
  type Adoption,
  type Vote,
  type ResourceCategory,
  type ResourceScope,
  type IntakeSubject,
  type IntakeDepthChoice,
  type IntakeFlowChoice,
  type IntakeMaterialsChoice,
  type IntakeFitMode,
  type IntakePipelineExecutionReceipt,
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
  readonly inspectorMode?: InspectorMode;
  readonly flowOrder?: FlowOrder; readonly deepDive?: DeepDiveMode; readonly spacedReview?: SpacedReviewMode;
  readonly selectedCurriculumId?: string;
  readonly authStatus?: AuthStatus; readonly account?: Account; readonly returnTo?: ReturnDestination | null;
  readonly authNotice?: string | null;
  readonly marketplaceFilters?: Partial<MarketplaceFilters>; readonly marketplaceSort?: MarketplaceSort;
  readonly marketplaceTopicsExpanded?: boolean;
  readonly votes?: readonly Vote[]; readonly adoptions?: readonly Adoption[];
  readonly publishedListings?: readonly MarketplaceListing[];
  readonly adoptPublicationId?: string | null; readonly adoptModuleIds?: readonly string[];
  readonly resourceScope?: ResourceScope; readonly resourceCategory?: ResourceCategory;
  readonly intakeGoalTitle?: string; readonly intakeSubject?: IntakeSubject;
  readonly intakeTopics?: readonly string[]; readonly intakeDepth?: IntakeDepthChoice;
  readonly intakeFlow?: IntakeFlowChoice; readonly intakeMaterials?: IntakeMaterialsChoice;
  readonly intakeWeeklyMinutes?: number; readonly intakeFitMode?: IntakeFitMode;
  readonly intakeSelectedResourceIds?: readonly string[]; readonly intakeSkippedResourceIds?: readonly string[];
  readonly generatedPlans?: readonly ActiveCurriculum[];
  readonly lastPipelineReceipt?: IntakePipelineExecutionReceipt | null;
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
  subject: "Engineering", gate_style: "Reviewed Quiz", topic_tags: ["Python", "RAG", "Attention", "Linear Algebra"],
  goal: {
    title: "Build and Evaluate RAG Systems in Python",
    summary: "Start a Python RAG system from its model foundations: subword tokenization and scaled dot-product attention, with verified resources.",
    included_topics: ["tokenization tradeoffs", "scaled dot-product attention", "matrix calculus"],
    excluded_topics: ["distributed cluster orchestration"],
    scope_note: "Focuses on foundational subword tokenization and attention mechanics before adding retrieval indexing and end-to-end RAG evaluation.",
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
      description: "Explain why dot products grow with dimension $d_k$ and how $\\frac{1}{\\sqrt{d_k}}$ prevents softmax saturation.",
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
      summary: "Matrix shape contracts, variance scaling by $\\frac{1}{\\sqrt{d_k}}$, and spaced review.",
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
      content: { study_prompt: "Compare byte-pair encoding merge rules against unigram language model likelihood pruning $\\mathcal{L}(\\theta) = \\sum_{x \\in \\mathcal{V}} P(x)$." },
    },
    {
      activity_id: "activity-example", type: "worked_example", title: "Worked Example: Attention Scaling Factor $\\frac{1}{\\sqrt{d_k}}$",
      requirement_level: "required", objective_ids: ["objective-tokenization", "objective-attention"], prerequisite_activity_ids: ["activity-theory"],
      resource_assignments: [
        makeResAssign("synthetic-resource-tokenization-v1", "primary", ["seg-bpe-overview"], "Demonstrates variance growth of unscaled dot products."),
        makeResAssign("synthetic-resource-attention-youtube-v1", "supplemental", ["seg-yt-attention"], "Visual YouTube lecture deriving $\\frac{1}{\\sqrt{d_k}}$ variance stabilization."),
      ],
      duration_estimate: makeDurationEstimate([12, 8, 5, 0, 0], [10, 6, 4, 0, 0], [15, 12, 8, 0, 0]),
      content: { example_prompt: "Inspect how scaling $QK^T$ by $\\frac{1}{\\sqrt{d_k}}$ keeps variance at $\\mathrm{Var}(q \\cdot k) = 1$ and prevents vanishing softmax gradients." },
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
      resource_assignments: [
        makeResAssign("synthetic-resource-cert-prep-v1", "supplemental", [], "Optional hardware-aware enrichment reading."),
        makeResAssign("synthetic-resource-rag-lab-repo-v1", "supplemental", [], "Benchmark code lab repository for SRAM tiling and sequence packing."),
      ],
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
  "synthetic-resource-attention-youtube-v1": makeCatalogEntry(
    "synthetic-resource-attention-youtube-v1", "YouTube Lecture: Scaled Dot-Product Attention & Softmax Variance Walkthrough", "youtube-attention-walkthrough",
    ["ai-engineering-youtube", "AI Engineering Channel · YouTube (Curator Verified)"], "free",
    [["seg-yt-attention", "04:15 — Why unscaled dot products grow with $d_k$"]],
  ),
  "synthetic-resource-rag-lab-repo-v1": makeCatalogEntry(
    "synthetic-resource-rag-lab-repo-v1", "Code Lab Repository: FlashAttention & Tokenizer Benchmarks", "rag-benchmark-lab-repo",
    ["open-ml-press", "Open ML Press (Curator Verified)"], "free",
  ),
  "synthetic-resource-strang-youtube-v1": makeCatalogEntry(
    "synthetic-resource-strang-youtube-v1", "MIT OCW YouTube Lecture: Projection Matrices and Least Squares", "youtube-mit-projections",
    ["mit-ocw-youtube", "MIT OpenCourseWare · YouTube (Curator Verified)"], "free",
    [["seg-yt-projection", "12:40 — Deriving $P = A(A^T A)^{-1}A^T$"]],
  ),
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
  subject: "Mathematics", gate_style: "Public Quiz Bank", topic_tags: ["Linear Algebra", "Eigenvalues", "SVD"],
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
      success_criterion: "Diagonalize a symmetric $3 \\times 3$ matrix $A = Q\\Lambda Q^T$ and project a vector onto its column space, justifying each step.",
      level: "applied", requirement_level: "required", assessment_activity_ids: ["la-gate-spectral"], prior_evidence_refs: [],
    },
    {
      objective_id: "objective-la-svd", objective_version_id: "objective-la-svd-v1", topic_id: "topic-svd",
      title: "Derive the singular value decomposition and use it for low-rank approximation",
      description: "Connect singular values to the eigenvalues of $A^T A$ and to the best rank-$k$ approximation.",
      success_criterion: "Compute the SVD of a $2 \\times 2$ matrix by hand and state the Eckart–Young error of its best rank-$1$ approximation.",
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
      summary: "The SVD $A = U\\Sigma V^T$, its link to $A^T A$, and the Eckart–Young theorem.",
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
      content: { study_prompt: "Work out why a real symmetric matrix $A = A^T$ has orthogonal eigenvectors." },
    },
    {
      activity_id: "la-example-projection", type: "worked_example", title: "Worked Example: Projecting onto a Column Space",
      requirement_level: "required", objective_ids: ["objective-la-spectral"], prerequisite_activity_ids: ["la-read-eigen"],
      resource_assignments: [
        makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-eigen"], "Derives the projection matrix from the normal equations."),
        makeResAssign("synthetic-resource-strang-youtube-v1", "supplemental", ["seg-yt-projection"], "Companion MIT OCW YouTube lecture on orthogonal projections."),
      ],
      duration_estimate: makeDurationEstimate([5, 10, 5, 0, 0], [4, 8, 4, 0, 0], [8, 14, 8, 0, 0]),
      content: { example_prompt: "Follow the derivation of $P = A(A^T A)^{-1}A^T$ from the normal equations $A^T(b - Ax) = 0$.", guidance_level: "full" },
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
      content: { study_prompt: "Connect the singular values $\\sigma_i$ of $A$ to the eigenvalues $\\lambda_i$ of $A^T A$." },
    },
    {
      activity_id: "la-example-svd", type: "worked_example", title: "Worked Example: SVD of a $2 \\times 2$ Matrix by Hand",
      requirement_level: "required", objective_ids: ["objective-la-svd"], prerequisite_activity_ids: ["la-read-svd"],
      resource_assignments: [makeResAssign("synthetic-resource-la-notes-v1", "primary", ["seg-la-svd"], "A fully worked 2×2 example.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Compute $U$, $\\Sigma$, and $V^T$ for a $2 \\times 2$ matrix and check that $A = U\\Sigma V^T$ reproduces it.", guidance_level: "full" },
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
  subject: "Literature", gate_style: "Self-Check Rubric", topic_tags: ["Tolstoy", "Realism", "Narrative"],
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

function makeActiveCurriculum(
  curriculumId: string,
  curriculum: Record<string, unknown>,
  schedule: Record<string, unknown>,
  publicationId: string | null,
): ActiveCurriculum {
  const tags = curriculumTagsOf(curriculum);
  return {
    curriculumId,
    domain: tags.subject,
    assessmentMode: tags.gateStyle,
    curriculum,
    schedule,
    publicationId,
    draft: false,
  };
}

const RAG_PLAN: ActiveCurriculum = makeActiveCurriculum(
  "curriculum-rag-python-001",
  DEFAULT_SYNTHETIC_CURRICULUM,
  DEFAULT_SYNTHETIC_SCHEDULE,
  "publication-synthetic-001",
);

// The base plans in queue order. The first one is selected by default.
const ACTIVE_CURRICULA: readonly ActiveCurriculum[] = [
  RAG_PLAN,
  makeActiveCurriculum("curriculum-linear-algebra-002", LINEAR_ALGEBRA_CURRICULUM, LINEAR_ALGEBRA_SCHEDULE, "publication-linear-algebra-001"),
  makeActiveCurriculum("curriculum-tolstoy-lit-003", TOLSTOY_CURRICULUM, TOLSTOY_SCHEDULE, "publication-tolstoy-001"),
];

const planIn = (plans: readonly ActiveCurriculum[], curriculumId: unknown): ActiveCurriculum =>
  plans.find((plan) => plan.curriculumId === curriculumId) ?? RAG_PLAN;

const RUST_ASYNC_CURRICULUM: Record<string, unknown> = {
  schema_version: "0.2.0", curriculum_id: "curriculum-rust-async-004",
  revision_id: "revision-rust-async-v1", revision_number: 1, predecessor_revision_id: null,
  account_id: "curator-ferris", created_at: "2026-10-18T12:00:00Z", revision_reason: "initial_generation",
  subject: "Systems", gate_style: "Code Lab Gate", topic_tags: ["Rust", "Async", "Concurrency"],
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
  subject: "Physics", gate_style: "Problem Set Gate", topic_tags: ["Thermodynamics", "Ensembles", "Phase Transitions"],
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
      content: { study_prompt: "Derive the Boltzmann factor $P_i = \\frac{1}{Z}e^{-\\beta E_i}$ from the microcanonical ensemble of a large reservoir." },
    },
    {
      activity_id: "sm-example-two-level", type: "worked_example", title: "Worked Example: The Two-Level System",
      requirement_level: "required", objective_ids: ["objective-sm-ensembles"], prerequisite_activity_ids: ["sm-read-ensembles"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ensembles"], "A complete worked example of the Schottky anomaly.")],
      duration_estimate: makeDurationEstimate([5, 10, 10, 0, 0], [4, 8, 8, 0, 0], [8, 14, 14, 0, 0]),
      content: { example_prompt: "Follow the heat capacity $C_V = \\frac{\\partial \\langle E \\rangle}{\\partial T}$ of a two-level system to its Schottky peak.", guidance_level: "full" },
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
      content: { study_prompt: "Explain why minimizing free energy $F = U - TS$, and not energy $U$ alone, decides the stable phase." },
    },
    {
      activity_id: "sm-example-mean-field", type: "worked_example", title: "Worked Example: Mean-Field Magnetization",
      requirement_level: "required", objective_ids: ["objective-sm-phase"], prerequisite_activity_ids: ["sm-read-free-energy"],
      resource_assignments: [makeResAssign("synthetic-resource-statmech-notes-v1", "primary", ["seg-sm-ising"], "Solves the self-consistency equation graphically.")],
      duration_estimate: makeDurationEstimate([5, 10, 15, 0, 0], [4, 8, 10, 0, 0], [8, 14, 20, 0, 0]),
      content: { example_prompt: "Solve $m = \\tanh(\\beta J z m)$ graphically and find where nonzero solutions appear.", guidance_level: "full" },
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
      content: { recall_prompt: "Without notes, relate the heat capacity $C_V = k_B \\beta^2 (\\langle E^2 \\rangle - \\langle E \\rangle^2)$ to energy fluctuations in the canonical ensemble.", assessment_ref: null },
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

function makeMarketplaceListing(
  input: Omit<MarketplaceListing, "subject" | "gateStyle" | "topicTags">,
): MarketplaceListing {
  const tags = curriculumTagsOf(input.curriculum);
  return {
    ...input,
    subject: tags.subject,
    gateStyle: tags.gateStyle,
    topicTags: tags.topicTags,
  };
}

const MARKETPLACE_LISTINGS: readonly MarketplaceListing[] = [
  makeMarketplaceListing({
    publicationId: "publication-synthetic-001", revisionId: "public-revision-synthetic-001",
    handle: "@alex", upvotes: 14, adoptions: 142, publishedAt: "2026-10-20T16:00:00Z",
    ownerAccountId: "learner-default", sourceCurriculumId: "curriculum-rag-python-001", basedOn: null,
    curriculum: DEFAULT_SYNTHETIC_CURRICULUM, schedule: DEFAULT_SYNTHETIC_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-linear-algebra-001", revisionId: "public-revision-linear-algebra-001",
    handle: "@spectral_sam", upvotes: 31, adoptions: 87, publishedAt: "2026-10-12T15:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: LINEAR_ALGEBRA_CURRICULUM, schedule: LINEAR_ALGEBRA_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-tolstoy-001", revisionId: "public-revision-tolstoy-001",
    handle: "@tolstoy_seminar", upvotes: 19, adoptions: 23, publishedAt: "2026-10-16T18:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: TOLSTOY_CURRICULUM, schedule: TOLSTOY_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-rust-async-001", revisionId: "public-revision-rust-async-001",
    handle: "@ferris_ops", upvotes: 48, adoptions: 64, publishedAt: "2026-10-18T12:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: RUST_ASYNC_CURRICULUM, schedule: RUST_ASYNC_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-statmech-001", revisionId: "public-revision-statmech-001",
    handle: "@ada_curates", upvotes: 27, adoptions: 39, publishedAt: "2026-10-08T10:00:00Z",
    ownerAccountId: null, sourceCurriculumId: null, basedOn: null, curriculum: STAT_MECH_CURRICULUM, schedule: STAT_MECH_SCHEDULE,
  }),
];

const PRACTICE_ACTIONS: ReadonlySet<string> = new Set(["request-hint", "study-worked-solution", "submit-practice"]);

// Actions that need no valid session: signing in or out, browsing the Marketplace, appearance, and view layout.
const OPEN_ACTIONS: ReadonlySet<string> = new Set([
  "submit-sign-in", "sign-in-passkey", "switch-persona", "simulate-session-expired", "sign-out",
  "set-marketplace-filter", "toggle-marketplace-topics", "clear-marketplace-filters", "set-marketplace-sort", "set-marketplace-query",
  "load-more",
  "close-study-detail", "toggle-solid-surfaces", "toggle-reduce-motion", "set-flow-order", "set-deep-dive", "set-spaced-review",
  "view-evidence", "check-prerequisites", "set-resource-scope", "set-resource-category",
]);

// The drawer's practice question for each published curriculum. An adopted copy keeps its publication id, so it shares the check.
const CONCEPT_CHECKS: Readonly<Record<string, ConceptCheck>> = {
  "publication-synthetic-001": {
    formula: "\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
    question: "Which statement matches the scaling term?",
    choices: [
      { value: "variance", label: "It keeps the variance of each dot-product score near 1 as d_k grows" },
      { value: "normalize", label: "It makes each row of attention weights sum to 1" },
      { value: "cost", label: "It makes attention cost linear instead of quadratic in sequence length" },
    ],
    hint: "Suppose the entries of q and k are independent, with mean 0 and variance 1. The dot product $q \\cdot k$ adds $d_k$ such products. What is its variance?",
    solution: "The dot product q·k has variance d_k. Dividing by $\\sqrt{d_k}$ brings the variance back to $1$, so the softmax does not saturate and its gradients stay useful. The softmax, not the scale, makes each row sum to 1. The scale does not change the quadratic cost.",
  },
  "publication-linear-algebra-001": {
    formula: "A = Q \\Lambda Q^T",
    question: "Why does a real symmetric matrix A admit an orthogonal eigenbasis Q?",
    choices: [
      { value: "orthogonal", label: "Its eigenvalues are real, and eigenvectors for distinct eigenvalues are orthogonal" },
      { value: "invertible", label: "Every real symmetric matrix is invertible" },
      { value: "distinct", label: "Its eigenvalues are always distinct" },
    ],
    hint: "Take eigenvectors $v_1$ and $v_2$ with eigenvalues $\\lambda_1 \\neq \\lambda_2$. Compute $v_1^T A v_2$ in two ways, and use $A^T = A$.",
    solution: "Because $A^T = A$, $v_1^T A v_2$ equals both $\\lambda_2 v_1^T v_2$ and $\\lambda_1 v_1^T v_2$. With $\\lambda_1 \\neq \\lambda_2$, this forces $v_1^T v_2 = 0$. The spectral theorem also gives a full set of real eigenvectors, so each repeated eigenvalue has an orthonormal basis for its eigenspace. These orthonormal eigenvectors are the columns of $Q$, and the eigenvalues fill the diagonal of $\\Lambda$. The zero matrix and the identity show that $A$ need not be invertible or have distinct eigenvalues.",
  },
  "publication-statmech-001": {
    formula: "P_i = \\frac{1}{Z} e^{-\\beta E_i}",
    question: "What does the partition function Z do in the Boltzmann distribution?",
    choices: [
      { value: "normalize", label: "It makes the probabilities of all microstates sum to 1" },
      { value: "energy", label: "It is the mean energy of the system" },
      { value: "temperature", label: "It sets the temperature of the heat bath" },
    ],
    hint: "Add $P_i$ over every microstate $i$. What must the total be, and what does that force $Z$ to equal?",
    solution: "The probabilities must sum to $1$, so $Z = \\sum_j e^{-\\beta E_j}$, a sum over states. The bath temperature enters through $\\beta = \\frac{1}{k_B T}$, not through $Z$. The mean energy comes from $Z$ as $\\langle E \\rangle = -\\frac{\\partial \\ln Z}{\\partial \\beta}$, but $Z$ itself is not an energy.",
  },
  "publication-rust-async-001": {
    formula: "\\mathrm{poll}(cx) \\in \\{\\mathrm{Pending}, \\mathrm{Ready}(T)\\}",
    question: "What must a future do before its poll returns Poll::Pending?",
    choices: [
      { value: "waker", label: "Make sure cx.waker() is woken when the future can make progress" },
      { value: "spin", label: "Loop inside poll until the result is ready" },
      { value: "nothing", label: "Nothing, because the executor polls every pending future again on its next tick" },
    ],
    hint: "After Pending, the executor parks the task. What tells the executor that the task is worth polling again?",
    solution: "Before it returns Pending, the future stores or registers cx.waker() with the I/O source, timer, or task that it waits on. That source calls wake() when progress is possible, and only then does the executor poll the task again. A loop inside poll blocks the executor thread, and an executor does not poll a parked task again by itself.",
  },
};

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
  if (typeof HTMLButtonElement !== 'undefined' && !('interestForElement' in HTMLButtonElement.prototype)) {
    const doc = scope.ownerDocument || scope;
    if (!doc.documentElement || doc.documentElement.dataset.interestDelegated !== 'true') {
      if (doc.documentElement) doc.documentElement.dataset.interestDelegated = 'true';
      let hideTimer = null;
      let activeTrigger = null;
      let activeTarget = null;
      const clearHide = () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      };
      const hideActive = () => {
        clearHide();
        if (activeTrigger) activeTrigger.classList.remove('interest-source');
        if (activeTarget) {
          activeTarget.classList.remove('interest-target', ':popover-open');
          if (typeof activeTarget.hidePopover === 'function') {
            try { activeTarget.hidePopover(); } catch {}
          }
        }
        activeTrigger = null;
        activeTarget = null;
      };
      const showFor = (trigger) => {
        const targetId = trigger.getAttribute('interestfor');
        const target = targetId && typeof doc.getElementById === 'function' ? doc.getElementById(targetId) : null;
        if (!target) return;
        clearHide();
        if (activeTarget && activeTarget !== target) hideActive();
        activeTrigger = trigger;
        activeTarget = target;
        trigger.classList.add('interest-source');
        target.classList.add('interest-target', ':popover-open');
        if (typeof doc.documentElement !== 'undefined' && !('anchorName' in doc.documentElement.style)) {
          const rect = trigger.getBoundingClientRect();
          target.style.position = 'fixed';
          target.style.top = Math.round(rect.bottom + 8) + 'px';
          target.style.left = Math.max(12, Math.round(rect.right - Math.min(512, window.innerWidth - 24))) + 'px';
        }
        if (typeof target.showPopover === 'function') {
          try { target.showPopover(); } catch {}
        }
      };
      const scheduleHide = () => {
        clearHide();
        hideTimer = setTimeout(hideActive, 150);
      };
      doc.addEventListener('mouseover', (event) => {
        const el = event.target && event.target.closest ? event.target.closest('[interestfor], [popover]') : null;
        if (!el) return;
        if (el.hasAttribute('interestfor')) showFor(el);
        else if (el === activeTarget) clearHide();
      });
      doc.addEventListener('mouseout', (event) => {
        if (!activeTrigger) return;
        const related = event.relatedTarget;
        if (related && related.closest && (related.closest('[interestfor]') === activeTrigger || related.closest('[popover]') === activeTarget)) return;
        scheduleHide();
      });
      doc.addEventListener('focusin', (event) => {
        const trigger = event.target && event.target.closest ? event.target.closest('[interestfor]') : null;
        if (trigger) showFor(trigger);
      });
      doc.addEventListener('focusout', (event) => {
        if (!activeTrigger) return;
        const related = event.relatedTarget;
        if (related && related.closest && (related.closest('[interestfor]') === activeTrigger || related.closest('[popover]') === activeTarget)) return;
        scheduleHide();
      });
      doc.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && activeTarget) hideActive();
      });
    }
  }
})();`;
}

function sfIcon(name: SfIconName, size: 15 | 16 = 16): string {
  return renderToString(h(SfIcon, { name, size }));
}

const DIALOG_CLOSE_BUTTON = `<button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">${sfIcon("close")}</button>`;

function statusGlyph(type: "module" | "gate", tone: "todo" | "doing" | "done", size = 20): string {
  return renderToString(h(StatusGlyph, { type, tone, size }));
}

function renderFlowBoard(
  idPrefix: string,
  modules: readonly StudyModule[],
  selectedModuleId: string | null,
  selectedActivityId: string | null,
  view: FlowView,
  nextUpActivityId?: string | null,
): string {
  return renderToString(h(StudyFlowBoard, { idPrefix, modules, selectedModuleId, selectedActivityId, view, nextUpActivityId }));
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

// An account's plans: the base plans, its own adopted copies, and any AI-generated drafts.
const plansFor = (
  accountId: string,
  adoptions: readonly Adoption[],
  listings: readonly MarketplaceListing[],
  generatedPlans: readonly ActiveCurriculum[] = [],
): readonly ActiveCurriculum[] => [
  ...ACTIVE_CURRICULA,
  ...adoptions.filter((adoption) => adoption.accountId === accountId).flatMap((adoption) => {
    const listing = listings.find((entry) => entry.publicationId === adoption.publicationId);
    return listing ? [adoptedPlanOf(listing, adoption)] : [];
  }),
  ...generatedPlans.filter((plan) => (plan.curriculum["account_id"] ?? accountId) === accountId),
];

function renderInspector(props: Parameters<typeof InspectorDrawer>[0]): string {
  return renderToString(h(InspectorDrawer, props));
}

function renderMapControl(control: "zoom_in" | "zoom_out" | "fit_view" | "reset_focus", label: string, visibleLabel: string, icon: SfIconName): string {
  return `<button type="button" class="btn-secondary map-control-btn" data-action="map-control" data-map-control="${control}" aria-label="${escapeHtml(label)}">${sfIcon(icon, 16)}<span>${escapeHtml(visibleLabel)}</span></button>`;
}

function shortSessionLabel(startAt: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return startAt.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date);
}

function formatSessionDateTime(startAt: string, timeZone: string, timezoneLabel: string): string {
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(startAt.trim());
  if (localMatch) {
    const [, y, m, d, hh, mm] = localMatch;
    const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)));
    if (!Number.isNaN(utcDate.getTime())) {
      const datePart = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(utcDate);
      const timePart = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(utcDate);
      return `${datePart} · ${timePart} ${timezoneLabel}`;
    }
  }
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return startAt;
  const datePart = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(date);
  return `${datePart} · ${timePart}`;
}

function toDatepickerValueInTimezone(startAt: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt.trim())) return startAt.trim();
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function sessionTypeLabel(activities: readonly { readonly type: string; readonly requirementLevel: string }[]): string {
  const required = activities.filter((act) => act.requirementLevel !== "optional");
  const basis = required.length > 0 ? required : activities;
  const reviewCount = basis.filter((act) => act.type === "review").length;
  if (reviewCount > 0 && reviewCount === basis.length) return "Spaced review";
  if (reviewCount > 0) return "Core study + review";
  return "Core study";
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
  const generatedPlans = inputState.generatedPlans ?? [];
  const plans = plansFor(account.accountId, adoptions, listings, generatedPlans);
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
  const marketplaceFilters = { ...NO_MARKETPLACE_FILTERS, ...inputState.marketplaceFilters };
  const marketplaceSort = inputState.marketplaceSort ?? "top_upvoted";
  const myPlans = signedOut ? [] : plans;
  const originListing = listings.find((listing) => listing.publicationId === selectedPlan.publicationId && listing.ownerAccountId !== account.accountId);
  const adoptListing = listings.find((listing) => listing.publicationId === inputState.adoptPublicationId);
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
  const inspectorMode: InspectorMode = inputState.inspectorMode ?? "activity";
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
    const planTags = curriculumTagsOf(plan.curriculum, { subject: plan.domain, gateStyle: plan.assessmentMode });
    const session = today.nextSession?.activityBreakdown ?? [];
    const open = session.filter((act) => !isClosed(act.executionStatus));
    const next = open[0];
    const done = session.length - open.length;
    const minutesLeft = open.reduce((sum, act) => sum + act.durationTriplet.point, 0);
    return `<article class="curriculum-card" data-curriculum-id="${id}" aria-labelledby="queue-${id}-title"${plan.curriculumId === selectedPlan.curriculumId ? ' aria-current="true"' : ""}>
            <p class="domain-pill">${escapeHtml(`${planTags.subject} · ${planTags.gateStyle}`)}</p>
            <h2 id="queue-${id}-title" class="curriculum-card-title">${escapeHtml(goalTitleOf(plan.curriculum))}</h2>
            <p class="queue-progress"><span class="st-sr">Upcoming session: </span>${done}/${session.length} completed${minutesLeft > 0 ? ` · ${minutesLeft}m left` : ""}</p>
            ${next ? `<div class="queue-next"><p class="queue-next-title">${renderTextWithLatexHtml(next.title)}</p><p class="queue-next-meta"><span>${next.durationTriplet.point}m</span><span class="track-badge">${TRACK_LABELS[TRACK_OF_TYPE[next.type]].badge}</span></p></div>` : `<p class="queue-next">Nothing is scheduled next.</p>`}
            <div class="queue-actions">
              ${next ? `<button type="button" class="btn-primary" data-action="resume-curriculum" data-curriculum-id="${id}" data-activity-id="${escapeHtml(next.activityId)}" data-module-id="${escapeHtml(next.moduleId)}">Resume<span aria-hidden="true">→</span></button>` : ""}
              <button type="button" class="btn-secondary" data-action="open-curriculum-plan" data-curriculum-id="${id}">Open Plan<span aria-hidden="true">→</span></button>
            </div>
          </article>`;
  }).join("");
  const planOptionsHtml = [
    ...planToday.map(({ plan, today }) => {
      const planTags = curriculumTagsOf(plan.curriculum, { subject: plan.domain, gateStyle: plan.assessmentMode });
      const session = today.nextSession?.activityBreakdown ?? [];
      const open = session.filter((act) => !isClosed(act.executionStatus));
      const done = session.length - open.length;
      const unitsCount = rawListOf(plan.curriculum, "modules").length;
      return `<option value="${escapeHtml(plan.curriculumId)}" data-domain="${escapeHtml(planTags.subject)}" data-units="${unitsCount} units" data-progress="${done}/${session.length} completed"${plan.draft ? ' data-draft="true"' : ""}${plan.curriculumId === selectedPlan.curriculumId ? " selected" : ""}>${escapeHtml(goalTitleOf(plan.curriculum))}${plan.draft ? " · Draft" : ""}</option>`;
    }),
    `<option value="__edit_plan__" data-action-option="edit-plan" data-domain="Plan &amp; Pacing" data-progress="Schedule, waivers &amp; approach">Edit Plan &amp; Pacing →</option>`,
  ].join("");
  const selectedTagStripHtml = renderToString(
    h(CurriculumTagStrip, {
      curriculum: selectedPlan.curriculum,
      fallbackSubject: selectedPlan.domain,
      fallbackGateStyle: selectedPlan.assessmentMode,
    }),
  );
  const studyMinutes = planToday.reduce((sum, { today }) => sum + today.totalStudyMinutes, 0);
  const selfReportedCount = planToday.reduce((sum, { today }) => sum + today.selfReportedCompletedCount, 0);

  const requiredActivities = basePlanModel.outlineActivities.filter((act) => act.required);
  const requiredCompleted = requiredActivities.filter((act) => isExecutionDone(act.executionStatus)).length;
  const demonstratedObjectives = basePlanModel.objectiveTracks.filter((obj) => obj.proficiencyStatus === "demonstrated").length;
  const reviewsDue = basePlanModel.outlineActivities.filter((act) => act.type === "review" && !isExecutionDone(act.executionStatus) && act.executionStatus !== "waived").length;
  const requiredSummary = `${requiredCompleted} of ${requiredActivities.length} required activities completed`;
  const evidenceSummary = `${demonstratedObjectives} of ${basePlanModel.objectiveTracks.length} objectives demonstrated`;
  const reviewSummary = `${reviewsDue} review${reviewsDue === 1 ? "" : "s"} due`;

  const planProgress = unitProgress(basePlanModel.outlineActivities);
  const todayBoardHtml = renderFlowBoard("flow-today", modules, selectedModuleId, selectedActivityId, flowView, nextUp?.activityId ?? null);
  const totalEffort = basePlanModel.totalDurationTriplet;
  const unitIndexById = new Map(modules.map((mod, idx) => [mod.moduleId, idx + 1]));
  const objectiveById = new Map(basePlanModel.objectiveTracks.map((obj) => [obj.objectiveId, obj]));

  const planArchitectureOutlineHtml = `<div class="plan-architecture-outline" role="list" aria-label="Outcomes and prerequisite module outline">
    ${modules.map((mod, idx) => {
      const isSelected = mod.moduleId === selectedModuleId;
      const prog = unitProgress(mod.activities);
      const prereqLabels = mod.prerequisiteModuleIds.map((id) => `U${unitIndexById.get(id) ?? "?"}`);
      const prereqText = prereqLabels.length > 0 ? `Requires ${prereqLabels.join(", ")}` : "Entry unit (no prior unit prerequisite)";
      const reqCount = mod.activities.filter((act) => act.required).length;
      const optCount = mod.activities.length - reqCount;
      const unitObjectives = mod.objectiveIds.map((id) => objectiveById.get(id)).filter((obj): obj is NonNullable<typeof obj> => Boolean(obj));
      const objectivesListHtml = unitObjectives.map((obj) => {
        const statusLabel = obj.proficiencyStatus === "demonstrated"
          ? "Demonstrated"
          : obj.proficiencyStatus === "in_progress"
            ? "In progress"
            : obj.proficiencyStatus === "needs_review"
              ? "Needs review"
              : "Not yet checked";
        const evidenceLabel = obj.proficiencyBadge.evidenceSupport === "corroborated"
          ? "Verified by checkpoint"
          : "Checkpoint pending";
        return `<li class="plan-objective-row" data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
        <div class="plan-objective-main">
          <strong>${escapeHtml(obj.title)}</strong>
          <span class="meta-text">${escapeHtml(statusLabel)} · ${escapeHtml(evidenceLabel)} · ${prog.done}/${prog.total} required activities completed</span>
        </div>
        <div class="plan-objective-actions">
          <button type="button" class="btn-secondary" data-action="view-evidence" data-objective-id="${escapeHtml(obj.objectiveId)}">View evidence</button>
        </div>
      </li>`;
      }).join("\n");
      return `<article class="study-card outline-module-card${isSelected ? " is-selected" : ""}" role="listitem" data-module-id="${escapeHtml(mod.moduleId)}" data-selected="${isSelected}">
        <div class="plan-outline-unit-head">
          <div>
            <p class="meta-text"><span class="badge">U${idx + 1}</span> · ${escapeHtml(prereqText)} · ${reqCount} required${optCount > 0 ? `, ${optCount} optional enrichment` : ""} · ${escapeHtml(effortWords(mod.durationTriplet))}</p>
            <h3>${escapeHtml(displayUnitTitle(mod.title))}</h3>
          </div>
          <button type="button" class="btn-secondary" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${isSelected}">${isSelected ? "Selected unit" : "Select unit"}</button>
        </div>
        <ul class="plan-objective-list">${objectivesListHtml}</ul>
      </article>`;
    }).join("\n")}
  </div>`;

  const selectedModule = modules.find((mod) => mod.moduleId === selectedModuleId) ?? modules[0];
  const selectedActivity = selectedModule?.activities.find((act) => act.activityId === selectedActivityId) ?? selectedModule?.activities[0];
  const topicOf = new Map(basePlanModel.objectiveTracks.map((obj) => [obj.objectiveId, obj.topicId]));
  const inspectorHtml = selectedModule && selectedActivity
    ? renderInspector({
      modules, mod: selectedModule, activity: selectedActivity, open: studyDetailOpen && isLearn,
      mode: inspectorMode,
      rigor: mathDepthFor(curriculum, selectedActivity.objectiveIds.flatMap((objectiveId) => topicOf.get(objectiveId) ?? [])),
      deliverables: deliverablesOf(curriculum, selectedActivity.activityId), catalogResources,
      rubric: rubricOf(curriculum, selectedActivity.activityId),
      conceptCheck: CONCEPT_CHECKS[selectedPlan.publicationId ?? ""] ?? null,
      practice: { hintRequested, workedSolutionRevealed, submitted: practiceSubmitted, choice: practiceChoice },
      skipRecorded: skippedActivityIds.has(selectedActivity.activityId),
    })
    : "";

  const legendArrow = (tone: "control" | "accent", style: SegmentStyle) =>
    `<svg class="legend-swatch" viewBox="0 0 64 20" width="64" height="20" aria-hidden="true" data-tone="${tone}" data-style="${style}"><line x1="2" y1="10" x2="50" y2="10" /><path class="arrow-head" d="M49 5 L59 10 L49 15 Z" /></svg>`;
  const relationshipLegend = `<figure id="plan-relationship-legend" popover="hint" class="relationship-legend" data-opaque-surface="true">
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
  const conclusionLabel = (status: string): string => {
    if (status === "demonstrated") return "Demonstrated under stated conditions";
    if (status === "self_reported") return "Self-reported";
    if (status === "needs_review" || status === "needs_practice") return "Needs practice";
    if (status === "in_progress") return "In progress";
    return "Not assessed";
  };
  const calibrationSummary = (obj: (typeof basePlanModel.objectiveTracks)[number]): string => {
    if (obj.proficiencyStatus === "demonstrated") {
      return "Reviewed check on a recorded date. No in-app help recorded. Outside help was not verified.";
    }
    if (obj.executionStatus === "self_reported_completed" || obj.proficiencyStatus === "self_reported") {
      return "You marked this familiar or completed its study activity. It has not been checked independently.";
    }
    return "No qualifying check is recorded. Missing assessment means unknown, not low ability.";
  };
  const retentionSummary = (obj: (typeof basePlanModel.objectiveTracks)[number]): string => {
    if (obj.proficiencyStatus === "needs_review") {
      return "A refresh is recommended by the review policy (not proof of skill loss).";
    }
    if (obj.proficiencyStatus === "demonstrated") {
      return "No delayed check recorded.";
    }
    return "History unavailable until an initial independent check is recorded.";
  };
  const proficiencyRowsHtml = basePlanModel.objectiveTracks.map((obj) => `<tr data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
    <td>
      <span class="badge">${escapeHtml(humanize(obj.topicId.replace(/^topic-/, "")))}</span>
      <strong class="capability-title">${escapeHtml(obj.title || "Learning objective: title unavailable")}</strong>
    </td>
    <td><span class="st-status-static">${proficiencyGlyph(obj.proficiencyStatus)}<span>${escapeHtml(conclusionLabel(obj.proficiencyStatus))}</span></span><span class="st-sr">${escapeHtml(obj.proficiencyBadge.nonColorCue)}</span></td>
    <td>
      <p class="prose capability-support">${escapeHtml(calibrationSummary(obj))}</p>
      <p class="meta-text">${escapeHtml(retentionSummary(obj))}</p>
    </td>
    <td>
      <div class="plan-objective-actions">
        <button type="button" class="btn-secondary" data-action="view-evidence" data-objective-id="${escapeHtml(obj.objectiveId)}">View evidence</button>
        <button type="button" class="btn-secondary" data-action="diagnostic-continue" data-objective-id="${escapeHtml(obj.objectiveId)}">Check understanding</button>
      </div>
    </td>
  </tr>`).join("\n");

  const inspectedObjective = basePlanModel.objectiveTracks[0];
  const sampledCapabilityTitles = diagnosticState.target_objective_version_ids.map((verId) => {
    const match = basePlanModel.objectiveTracks.find((obj) => obj.objectiveVersionId === verId || obj.objectiveId === verId);
    return match ? match.title : humanize(verId.replace(/^objective-|-v\d+$/g, ""));
  });
  const assessedCapabilityTitles = diagnosticState.assessed_objective_version_ids.map((verId) => {
    const match = basePlanModel.objectiveTracks.find((obj) => obj.objectiveVersionId === verId || obj.objectiveId === verId);
    return match ? match.title : humanize(verId.replace(/^objective-|-v\d+$/g, ""));
  });
  const unassessedCapabilityTitles = diagnosticState.unassessed_objective_version_ids.map((verId) => {
    const match = basePlanModel.objectiveTracks.find((obj) => obj.objectiveVersionId === verId || obj.objectiveId === verId);
    return match ? match.title : humanize(verId.replace(/^objective-|-v\d+$/g, ""));
  });

  const resourceScope: ResourceScope = inputState.resourceScope ?? "selected";
  const resourceCategory: ResourceCategory = inputState.resourceCategory ?? "All";

  const fourBucketsHtml = Object.values(costBreakdown.buckets).map((bucket) => `<div class="cost-bucket-card" data-bucket-id="${escapeHtml(bucket.bucketId)}">
    <h3>${escapeHtml(bucket.label)}</h3>
    <p class="bucket-mechanism">Mechanism: <code>${escapeHtml(bucket.billingMechanism)}</code></p>
    <p class="bucket-summary"><strong>${escapeHtml(bucket.formattedSummary)}</strong></p>
    <ul class="bucket-lines">${bucket.lineItems.map((li) => `<li data-line-id="${escapeHtml(li.id)}" data-unknown-price="${li.isUnknownPrice}">${escapeHtml(li.label)}: <strong>${escapeHtml(li.formattedAmount)}</strong></li>`).join("")}</ul>
  </div>`).join("\n");

  const adaptationNodeTitle = (nodeId: string): string => {
    const fromOutline = outlineById.get(nodeId)?.title;
    if (fromOutline) return fromOutline;
    if (nodeId === "activity-matrix-calculus-bridge") {
      return "Targeted Bridge: Matrix Calculus & Softmax Jacobians";
    }
    return humanize(nodeId);
  };
  const adaptationChoiceCopy = adaptationChoice === "accept_reviewed"
    ? "Accept revision was reviewed on this screen. No live adaptation route accepted it, so the current plan stays in place."
    : adaptationChoice === "keep_current"
      ? "Current plan kept. The proposal was not accepted."
      : "Review these suggested changes before applying them to your syllabus.";
  const adaptationBody = `<p class="prose"><strong>Time impact:</strong> ${adaptationDiff.impact.before_minutes} min → ${adaptationDiff.impact.after_minutes} min (${adaptationDiff.impact.delta_minutes >= 0 ? "+" : ""}${adaptationDiff.impact.delta_minutes} min) · <strong>Math depth preserved:</strong> ${escapeHtml(humanize(adaptationDiff.preserved_math_depth ?? "formal"))}</p>
    <p class="prose meta-text">${escapeHtml(adaptationDiff.impact.schedule_impact_summary ?? "")} ${escapeHtml(adaptationDiff.impact.inference_charge_summary ?? "")}</p>
    ${(adaptationDiff.impact.warnings ?? []).map((warning) => `<p class="warning-copy">${escapeHtml(warning)}</p>`).join("")}
    <h3>Skipped lessons (backed by your checkpoint evidence)</h3>
    <ul>${adaptationDiff.waivers.map((waiver) => `<li><strong>${escapeHtml(adaptationNodeTitle(waiver.node_id))}</strong> — ${escapeHtml(waiver.rationale)} <button type="button" class="btn-secondary" data-action="view-evidence" data-evidence-ref="${escapeHtml(waiver.qualifying_evidence_refs[0] ?? "")}">View evidence</button></li>`).join("")}</ul>
    <h3>Added bridge lessons</h3>
    <ul>${adaptationDiff.buckets.added.map((added) => `<li><strong>${escapeHtml(adaptationNodeTitle(added.node_id ?? ""))}</strong> — ${escapeHtml(added.rationale ?? "")}</li>`).join("")}</ul>
    <details class="today-curriculum-overview evidence-technical-details">
      <summary class="today-overview-summary"><span>Technical revision metadata</span></summary>
      <div class="today-overview-body">
        <p class="meta-text">Preserved math depth: <code>${escapeHtml(adaptationDiff.preserved_math_depth ?? "formal")}</code> · Proposal SHA-256: <code>${escapeHtml(adaptationDiff.proposal_sha256)}</code> · Waived IDs: <code>${escapeHtml(adaptationDiff.waivers.map((w) => w.node_id).join(", "))}</code> · Evidence refs: <code>${escapeHtml(adaptationDiff.waivers.flatMap((w) => w.qualifying_evidence_refs).join(", "))}</code></p>
      </div>
    </details>
    <div class="action-row"><button type="button" class="btn-secondary" data-action="keep-current-plan">Keep current plan</button><button type="button" class="btn-primary" data-action="accept-revision">Accept revision</button></div>
    <p class="prose meta-text">${adaptationChoiceCopy}</p>`;

  const timezoneLabel = reminderState.timezone === "America/New_York" ? "Eastern Time" : reminderState.timezone;
  const weeklyMinutes = todayState.weeklyMinutes || 120;
  const renderScheduleRowsHtml = (idPrefix: "plan" | "settings"): string =>
    todayState.todayCards.map((card, idx) => {
      const sessionNum = idx + 1;
      const sessionId = card.sessionId;
      const kindLabel = sessionTypeLabel(card.activityBreakdown);
      const isRescheduled = rescheduleSessionId === sessionId && Boolean(rescheduleValue);
      const effectiveTimeStr = isRescheduled && rescheduleValue ? rescheduleValue : card.startAt;
      const humanTime = formatSessionDateTime(effectiveTimeStr, reminderState.timezone, timezoneLabel);
      const pickerDefault = toDatepickerValueInTimezone(effectiveTimeStr, reminderState.timezone);
      const inputId = `${idPrefix}-reschedule-${sessionId}`;
      const lessonsHtml = card.activityBreakdown.map((act) =>
        `<li class="session-activity-item"><span class="session-activity-title">${escapeHtml(act.title)}</span><span class="meta-text">${act.durationMinutes} min${act.requirementLevel === "optional" ? " · optional" : ""}</span></li>`,
      ).join("");
      const preview = rescheduleSessionId === sessionId
        ? `<p class="prose session-reschedule-note" role="status">${
            rescheduleValue
              ? `Session ${sessionNum} moves to <strong>${escapeHtml(humanTime)}</strong>. Not saved yet.`
              : `Choose a date and time in ${escapeHtml(timezoneLabel)}.`
          }</p>`
        : "";
      return `<li class="schedule-row" data-session-id="${escapeHtml(sessionId)}">
        <div class="schedule-row-head">
          <div class="schedule-row-title-group">
            <p class="schedule-row-title"><strong>Session ${sessionNum}</strong> <span class="badge">${escapeHtml(kindLabel)}</span></p>
            <p class="schedule-row-time"><time datetime="${escapeHtml(card.startAt)}">${escapeHtml(humanTime)}</time> · ${card.durationMinutes} min</p>
          </div>
          <details class="session-reschedule"${rescheduleSessionId === sessionId ? " open" : ""}>
            <summary class="btn-secondary session-reschedule-summary">${sfIcon("today", 15)}<span>Change time</span></summary>
            <div class="schedule-edit session-reschedule-panel">
              <label class="field" for="${escapeHtml(inputId)}"><span>Date &amp; time (${escapeHtml(timezoneLabel)})</span>
                <input id="${escapeHtml(inputId)}" type="text" class="datepicker-input" data-datepicker="true" data-reschedule-for="${escapeHtml(sessionId)}" name="reschedule-${escapeHtml(sessionId)}" value="${escapeHtml(pickerDefault)}" autocomplete="off">
              </label>
              <button type="button" class="btn-primary" data-action="reschedule-session" data-session-id="${escapeHtml(sessionId)}">Apply time</button>
            </div>
          </details>
        </div>
        ${lessonsHtml ? `<ol class="session-activity-list">${lessonsHtml}</ol>` : ""}
        ${preview}
      </li>`;
    }).join("\n");

  // The ready state needs no banner. Any other state still shows above the Next-up bar.
  const recoveryBanner = todayState.asyncRecoveryBanner.state === "ready" ? "" : `<p class="status-banner" role="${todayState.asyncRecoveryBanner.role}"><strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)} ${escapeHtml(todayState.asyncRecoveryBanner.actionableNextStep)}</p>`;

  const openDialogId = inputState.openDialogId ?? null;
  const dialogOpen = (id: string) => ` data-open="${openDialogId === id}"`;

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
                  <span class="today-selected-eyebrow"><span class="today-selected-progress">${planProgress.done}/${planProgress.total} completed${planProgress.left > 0 ? ` · ${planProgress.left}m left` : ""}</span></span>
                  <h2 class="today-selected-title">${escapeHtml(goalTitleOf(selectedPlan.curriculum))}</h2>
                  ${selectedTagStripHtml}
                </div>
                <div class="plan-toolbar plan-command-picker">
                  <label class="field field-inline plan-command-field" for="selected-plan-control"><span class="plan-command-label">Plan</span>
                    <select id="selected-plan-control" class="plan-command-select" name="selected-plan" data-action="select-curriculum" data-tom-select="plan">${planOptionsHtml}</select>
                  </label>
                </div>
              </div>
              ${recoveryBanner}
            </header>
            ${todayBoardHtml}
          </div>
          <section class="today-bottom-grid" aria-label="Reviews and completed work" data-opaque-surface="true">
            <section class="review-queue" data-review-separation-valid="${todayState.reviewSeparationValid}" aria-labelledby="review-queue-title">
              <h2 id="review-queue-title">Review queue <span class="count-badge">${reviewRows.length}</span></h2>
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

        <section class="learn-sub-panel" id="panel-learn-plan" data-learn-panel="Plan" data-active="${isLearn && activeLearnSub === "Plan"}"${isLearn && activeLearnSub === "Plan" ? "" : " hidden"} data-opaque-surface="true">
          <header class="plan-hero">
            ${planToday.length < 2 ? "" : `<nav class="plan-switcher" aria-label="Your curricula">
              ${planToday.map(({ plan }) => {
                const planTags = curriculumTagsOf(plan.curriculum, { subject: plan.domain, gateStyle: plan.assessmentMode });
                return `<button type="button" class="plan-switch" data-action="select-curriculum" data-curriculum-id="${escapeHtml(plan.curriculumId)}"${plan.curriculumId === selectedPlan.curriculumId ? ' aria-current="true"' : ""}>
                <span class="plan-switch-domain">${escapeHtml(planTags.subject)}</span>
                <span class="plan-switch-title">${escapeHtml(goalTitleOf(plan.curriculum))}</span>
                <span class="plan-switch-meta">${rawListOf(plan.curriculum, "modules").length} units${plan.draft ? " · Draft" : ""}</span>
              </button>`;
              }).join("")}
            </nav>`}
            <div class="plan-title-row">
              <h1 class="page-title plan-title">${escapeHtml(goalTitleOf(curriculum))}</h1>
              <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Today">Resume Study<span aria-hidden="true">→</span></button>
            </div>
            ${selectedTagStripHtml}
            ${selectedPlan.draft ? `<p class="draft-notice" role="status">This plan is your private draft of ${originListing ? `${escapeHtml(originListing.handle)}'s template` : "a community template"}. Review it, then select Activate plan to add it to Today.</p>` : ""}
            <div class="plan-brief">
              <section class="plan-brief-goal" aria-labelledby="plan-goal-label">
                <h2 id="plan-goal-label" class="plan-brief-label">Goal</h2>
                <p class="plan-goal">${escapeHtml(basePlanModel.goal.summary)}</p>
              </section>
              ${basePlanModel.goal.includedTopics.length > 0 ? `<section class="plan-brief-covers" aria-labelledby="plan-covers-label">
                <h2 id="plan-covers-label" class="plan-brief-label">Covers</h2>
                <ul class="plan-scope-list">${basePlanModel.goal.includedTopics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>
              </section>` : ""}
            </div>
          </header>

          <div class="plan-sections-stack">
            <section class="plan-science-section" id="plan-outcomes-prerequisites" aria-labelledby="plan-outcomes-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <h2 id="plan-outcomes-heading">What you'll learn &amp; unit order</h2>
                  <p class="meta-text">${requiredSummary} · ${evidenceSummary} · ${reviewSummary}</p>
                </div>
                <div class="plan-outcomes-actions">
                  <button type="button" class="btn-secondary legend-trigger" interestfor="plan-relationship-legend" popovertarget="plan-relationship-legend">${sfIcon("plan", 16)}<span>Relationship legend</span></button>
                  <div class="plan-view-switcher segmented" role="group" aria-label="Map or outline">
                    ${PLAN_SYNCHRONIZED_VIEWS.map((view) => `<button type="button" class="seg-btn" data-action="switch-plan-view" data-plan-view="${view}" aria-pressed="${view === activePlanView}">${view}</button>`).join("\n")}
                  </div>
                </div>
              </div>
              <div class="surface-panel plan-map-container" data-plan-surface="Map" data-active="${activePlanView === "Map"}" data-opaque-surface="true">
                <div class="map-controls-bar" role="toolbar" aria-label="Map viewport controls">
                  ${renderMapControl("zoom_in", "Zoom In", "Zoom in", "zoom-in")}
                  ${renderMapControl("zoom_out", "Zoom Out", "Zoom out", "zoom-out")}
                  ${renderMapControl("fit_view", "Reset View", "Fit", "reset")}
                  ${renderMapControl("reset_focus", "Focus Neighborhood", "Reset focus", "focus")}
                </div>
                ${renderPlanDagSvgHtml(basePlanModel)}
                <p class="meta-text">Arrow keys move between modules. Selecting a module does not require pinch, drag, or hover.</p>
              </div>
              <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">${planArchitectureOutlineHtml}</div>
              ${relationshipLegend}
            </section>

            <section class="plan-science-section" id="plan-pacing-review" aria-labelledby="plan-pacing-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <h2 id="plan-pacing-heading">Your study sessions</h2>
                  <p class="meta-text">Each session is one sitting. Move a session if the time does not work for you.</p>
                </div>
              </div>
              <dl class="plan-facts">
                <div>
                  <dt>Total time</dt>
                  <dd>${totalEffort.point} min typical (${totalEffort.min}–${totalEffort.max} min range)</dd>
                </div>
                <div>
                  <dt>Weekly pace</dt>
                  <dd>${weeklyMinutes} min a week · about ${Math.max(1, Math.ceil(totalEffort.max / weeklyMinutes))} wk to finish</dd>
                </div>
                <div>
                  <dt>Spaced review</dt>
                  <dd>${reviewsDue} due · scheduled after initial checkpoint</dd>
                </div>
              </dl>
              <ul class="schedule-list">${renderScheduleRowsHtml("plan")}</ul>
            </section>

            <section class="plan-science-section" id="plan-learning-approach" aria-labelledby="plan-approach-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <h2 id="plan-approach-heading">Tailor how this curriculum is taught</h2>
                </div>
              </div>
              <dl class="plan-facts">
                <div>
                  <dt>Prior knowledge &amp; checkpoints</dt>
                  <dd>${evidenceSummary}. Diagnostic checks verify what can be skipped safely.</dd>
                </div>
                <div>
                  <dt>Mathematical depth</dt>
                  <dd>${escapeHtml(humanize(mathDepthFor(curriculum, [])))} (${depthOverrideReset ? "Topic overrides reset to global default" : "Override: Matrix calculus · Formal"})</dd>
                </div>
                <div>
                  <dt>Instructional order</dt>
                  <dd>
                    <div class="segmented" role="group" aria-label="Instructional order">
                      ${FLOW_ORDERS.map((order) => `<button type="button" class="seg-btn" data-action="set-flow-order" data-flow-order="${order}" aria-pressed="${flowView.order === order}">${order === "theory_first" ? "Theory" : order === "application_first" ? "Code first" : "Balanced"}</button>`).join("")}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt>Familiar material</dt>
                  <dd>Skip only when demonstrated (after a passed checkpoint)</dd>
                </div>
              </dl>
              <div class="plan-adaptation-box">
                <h3>Recommended syllabus adjustments</h3>
                ${adaptationBody}
              </div>
            </section>

            <section class="plan-science-section" id="plan-status-sharing" aria-labelledby="plan-status-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <h2 id="plan-status-heading">Activate or share your syllabus</h2>
                  <p class="meta-text">${selectedPlan.draft ? "Private draft" : "Active plan"}, revision ${escapeHtml(String(curriculum["revision_number"] ?? 1))}</p>
                </div>
              </div>
              <p class="prose meta-text">Activating a draft makes it your live study plan in Today. Sharing publishes a clean syllabus template to the Marketplace without your personal progress, schedule dates, or API keys.</p>
              <div class="action-row">
                <button type="button" class="btn-primary" data-action="activate-revision" data-curriculum-id="${escapeHtml(revisionActivationReq.curriculumId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">Activate plan</button>
                <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share to Marketplace</button>
                <button type="button" class="btn-secondary" data-action="navigate-top" data-destination="Explore">My publications</button>
              </div>
            </section>
          </div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${isLearn && activeLearnSub === "Progress"}"${isLearn && activeLearnSub === "Progress" ? "" : " hidden"}>
          <div class="section-header">
            <div>
              <span class="today-selected-eyebrow">Competency &amp; Evidence Portfolio</span>
              <h1 class="page-title">Your learning evidence</h1>
              <p class="prose meta-text">See what you have demonstrated and what still needs checking.</p>
            </div>
            <div class="plan-toolbar">
              <label class="field field-inline" for="progress-curriculum-control"><span>Curriculum</span>
                <select id="progress-curriculum-control" name="progress-curriculum" data-action="select-curriculum">${planOptionsHtml}</select>
              </label>
              <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Today">View review in Today<span aria-hidden="true">→</span></button>
              <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Plan">Adjust plan<span aria-hidden="true">→</span></button>
            </div>
          </div>

          <div class="plan-sections-stack">
            <section class="surface-panel" id="progress-capability-portfolio" aria-labelledby="progress-portfolio-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <span class="today-selected-eyebrow">Learning vs. Performance · Capability Space</span>
                  <h2 id="progress-portfolio-heading">Capability portfolio &amp; retention checks</h2>
                </div>
                <span class="badge">${evidenceSummary}</span>
              </div>
              <p class="prose meta-text">Completing a study activity in Today records effort, not demonstrated capability. Each capability below separates self-reported familiarity and supported practice from independent evidence and delayed retrieval checks.</p>
              <div class="table-responsive">
                <table class="proficiency-table">
                  <thead>
                    <tr>
                      <th scope="col">Capability</th>
                      <th scope="col">Evidence conclusion</th>
                      <th scope="col">What the record supports &amp; retention</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>${proficiencyRowsHtml}</tbody>
                </table>
              </div>
            </section>

            <section class="surface-panel" id="progress-evidence-detail" aria-labelledby="progress-evidence-detail-heading" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <span class="today-selected-eyebrow">Selected capability audit trail</span>
                  <h2 id="progress-evidence-detail-heading">${escapeHtml(inspectedObjective?.title ?? "Capability evidence detail")}</h2>
                </div>
                <span class="badge">${escapeHtml(conclusionLabel(inspectedObjective?.proficiencyStatus ?? "unassessed"))}</span>
              </div>
              <div class="plan-pacing-metrics">
                <div class="plan-metric-box">
                  <span class="meta-text">What the evidence supports</span>
                  <strong>${escapeHtml(inspectedObjective ? calibrationSummary(inspectedObjective) : "No qualifying check is recorded.")}</strong>
                </div>
                <div class="plan-metric-box">
                  <span class="meta-text">What remains unassessed</span>
                  <strong>Demonstrating introductory matrix operations does not establish matrix calculus or unassessed downstream objectives.</strong>
                </div>
                <div class="plan-metric-box">
                  <span class="meta-text">Later checks &amp; corrections</span>
                  <strong>${escapeHtml(inspectedObjective ? retentionSummary(inspectedObjective) : "No delayed check recorded.")}</strong>
                </div>
              </div>
              <details class="today-curriculum-overview evidence-technical-details">
                <summary class="today-overview-summary">
                  <span>Technical audit metadata &amp; canonical state reference</span>
                  <span class="meta-text">Versions, evidence refs, and schema states</span>
                </summary>
                <div class="today-overview-body">
                  <p class="meta-text">Objective version: <code>${escapeHtml(inspectedObjective?.objectiveVersionId ?? "unavailable")}</code> · Evidence support: <code>${escapeHtml(inspectedObjective?.proficiencyBadge.evidenceSupport ?? "none")}</code>${inspectedObjective && inspectedObjective.proficiencyBadge.evidenceRefs.length > 0 ? ` · Refs: <code>${escapeHtml(inspectedObjective.proficiencyBadge.evidenceRefs.join(", "))}</code>` : ""}</p>
                  <p class="meta-text">Canonical proficiency states: ${canonicalStatusesLegendHtml}</p>
                  <div class="honest-two-layer-summary">
                    <h3>Honest Two-Layer Status Summary</h3>
                    <p class="prose">Self-reporting an activity as completed records study effort idempotently (<code>self_reported_completed</code>) but never upgrades objective proficiency to <code>demonstrated</code> without reviewed assessment evidence.</p>
                  </div>
                </div>
              </details>
            </section>

            <section class="surface-panel diagnostic-panel" id="progress-diagnostic-verification" data-diagnostic-session-id="${escapeHtml(diagnosticState.diagnostic_session_id)}" data-diagnostic-state="${escapeHtml(diagnosticState.state)}" data-opaque-surface="true">
              <div class="section-header">
                <div>
                  <span class="today-selected-eyebrow">Verification without speed penalties · ~5 min target</span>
                  <h2>Check understanding</h2>
                </div>
                <span class="badge">Session ${escapeHtml(diagnosticControl)}</span>
              </div>
              <p class="prose">Sampled capabilities: <strong>${escapeHtml(sampledCapabilityTitles.join("; ") || "None")}</strong>.</p>
              <p class="prose meta-text">Assessed so far: ${escapeHtml(assessedCapabilityTitles.join("; ") || "None")}. Still unassessed: ${escapeHtml(unassessedCapabilityTitles.join("; ") || "None")}.</p>
              <p class="prose meta-text">The 5-minute effort target selects the sample and limits learner burden. It is not a speed score: reaching it never locks or marks a response wrong. Pause suspends this task view; Stop leaves unassessed capabilities unknown; Continue resumes the same session.</p>
              <div class="action-row">
                <button type="button" class="btn-secondary" data-action="diagnostic-pause">Pause</button>
                <button type="button" class="btn-secondary" data-action="diagnostic-stop-early">Stop</button>
                <button type="button" class="btn-secondary" data-action="diagnostic-continue">Continue</button>
                <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Plan">Adjust plan from evidence<span aria-hidden="true">→</span></button>
              </div>
            </section>
          </div>
        </section>

        ${renderToString(h(ResourcesView, {
          active: isLearn && activeLearnSub === "Resources",
          selectedPlan,
          allPlans: plans,
          proficiency,
          catalogResources,
          resourceScope,
          resourceCategory,
        }))}
      </section>`}

      ${renderToString(h(ExploreMarketplace, {
        active: activeTopLevel === "Explore",
        signedOut,
        account,
        listings,
        votes,
        adoptions,
        myPlans,
        marketplaceFilters,
        marketplaceSort,
        topicsExpanded: inputState.marketplaceTopicsExpanded ?? false,
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
            <ul class="schedule-list">${renderScheduleRowsHtml("settings")}</ul>
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

  ${signedOut ? "" : `  ${(() => {
    const intakeGoalTitle = inputState.intakeGoalTitle ?? "";
    const intakeSubject: IntakeSubject = inputState.intakeSubject ?? "Engineering";
    const intakeTopics = inputState.intakeTopics ?? [];
    const intakeDepth: IntakeDepthChoice = inputState.intakeDepth ?? "formal";
    const intakeFlow: IntakeFlowChoice = inputState.intakeFlow ?? "application_first";
    const intakeMaterials: IntakeMaterialsChoice = inputState.intakeMaterials ?? "free_only";
    const intakeWeeklyMinutes = inputState.intakeWeeklyMinutes ?? 120;
    const intakeFitMode: IntakeFitMode = inputState.intakeFitMode ?? "fill_gaps";
    const defaultCandidateIds = buildIndexedMaterialCandidates(catalogResources, intakeSubject, intakeTopics, intakeMaterials)
      .map((m) => m.resourceVersionId);
    const intakeSelectedResourceIds = inputState.intakeSelectedResourceIds ?? defaultCandidateIds;
    const intakeSkippedResourceIds = inputState.intakeSkippedResourceIds ?? [];
    const fitEvaluation = evaluateIntakeResourceFit({
      goalTitle: intakeGoalTitle,
      subject: intakeSubject,
      requestedTopics: intakeTopics,
      depth: intakeDepth,
      flowOrder: intakeFlow,
      materialsAccess: intakeMaterials,
      weeklyMinutes: intakeWeeklyMinutes,
      fitMode: intakeFitMode,
      selectedResourceIds: intakeSelectedResourceIds,
      skippedResourceIds: intakeSkippedResourceIds,
      catalogResources,
      myPlans,
      marketplaceListings: listings,
    });
    return renderToString(
      h(NewCurriculumDialog, {
        open: openDialogId === "dialog-new-curriculum",
        goalTitle: intakeGoalTitle,
        subject: intakeSubject,
        requestedTopics: intakeTopics,
        depth: intakeDepth,
        flowOrder: intakeFlow,
        materialsAccess: intakeMaterials,
        weeklyMinutes: intakeWeeklyMinutes,
        fitMode: intakeFitMode,
        depthOverrideReset,
        intakeNote,
        fitEvaluation,
        lastPipelineReceipt: inputState.lastPipelineReceipt ?? null,
      }),
    );
  })()}

  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title"${dialogOpen("dialog-adaptation-diff")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2>${DIALOG_CLOSE_BUTTON}</header>
      ${adaptationBody}
    </form>
  </dialog>

  ${renderToString(h(AdoptCurriculumDialog, {
    open: openDialogId === "dialog-partial-adoption",
    adoptListing: adoptListing ?? null,
    adoptions,
    adoptModuleIds: inputState.adoptModuleIds ?? unitIdsOf(adoptListing),
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
      <header class="dialog-header"><h2 id="dialog-unpublish-title">Unpublish</h2>${DIALOG_CLOSE_BUTTON}</header>
      <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies. Historical votes are not transferred.</p>
      <p class="prose">This screen does not call a live unpublish route and does not report success.</p>
    </form>
  </dialog>

  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title"${dialogOpen("dialog-account-deletion")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2>${DIALOG_CLOSE_BUTTON}</header>
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
  let marketplaceFilters: MarketplaceFilters = { ...NO_MARKETPLACE_FILTERS, ...initialState.marketplaceFilters };
  let marketplaceSort: MarketplaceSort = initialState.marketplaceSort ?? "top_upvoted";
  let marketplaceTopicsExpanded = initialState.marketplaceTopicsExpanded ?? false;
  let votes: Vote[] = [...(initialState.votes ?? [])];
  let adoptions: Adoption[] = [...(initialState.adoptions ?? [])];
  let publishedListings: MarketplaceListing[] = [...(initialState.publishedListings ?? [])];
  let adoptPublicationId: string | null = initialState.adoptPublicationId ?? null;
  let resourceScope: ResourceScope = initialState.resourceScope ?? "selected";
  let resourceCategory: ResourceCategory = initialState.resourceCategory ?? "All";
  const listings = (): readonly MarketplaceListing[] => [...MARKETPLACE_LISTINGS, ...publishedListings];
  const adoptListing = (): MarketplaceListing | undefined => listings().find((entry) => entry.publicationId === adoptPublicationId);
  let adoptModuleIds: string[] = [...(initialState.adoptModuleIds ?? unitIdsOf(adoptListing()))];
  let generatedPlans: ActiveCurriculum[] = [...(initialState.generatedPlans ?? [])];
  const currentPlans = () => plansFor(account.accountId, adoptions, listings(), generatedPlans);
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
  let inspectorMode: InspectorMode = initialState.inspectorMode ?? "activity";
  let openDialogId: string | null = initialState.openDialogId ?? null;

  const proficiency = initialState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  let catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>> =
    initialState.catalogResources ?? DEFAULT_CATALOG_RESOURCES;
  let intakeGoalTitle = initialState.intakeGoalTitle ?? "";
  let intakeSubject: IntakeSubject = initialState.intakeSubject ?? "Engineering";
  let intakeTopics: string[] = [...(initialState.intakeTopics ?? [])];
  let intakeDepth: IntakeDepthChoice = initialState.intakeDepth ?? "formal";
  let intakeFlow: IntakeFlowChoice = initialState.intakeFlow ?? "application_first";
  let intakeMaterials: IntakeMaterialsChoice = initialState.intakeMaterials ?? "free_only";
  let intakeWeeklyMinutes = initialState.intakeWeeklyMinutes ?? 120;
  let intakeFitMode: IntakeFitMode = initialState.intakeFitMode ?? "fill_gaps";
  let intakeSelectedResourceIds: string[] = [
    ...(initialState.intakeSelectedResourceIds ??
      buildIndexedMaterialCandidates(catalogResources, intakeSubject, intakeTopics, intakeMaterials).map(
        (m) => m.resourceVersionId,
      )),
  ];
  let intakeSkippedResourceIds: string[] = [...(initialState.intakeSkippedResourceIds ?? [])];
  let lastPipelineReceipt: IntakePipelineExecutionReceipt | null = initialState.lastPipelineReceipt ?? null;
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

  // Practice answers belong to one activity, so another activity starts its concept check fresh.
  function selectActivity(activityId: string | null): void {
    if (activityId !== selectedActivityId) resetPractice();
    selectedActivityId = activityId;
  }

  function selectPlanActivity(activityId: string, explicitModuleId?: string, _sourceView?: PlanSynchronizedView) {
    selectActivity(activityId);
    inspectorMode = "activity";
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
    resetPractice();
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

  function resetPractice(): void {
    hintRequested = false;
    workedSolutionRevealed = false;
    practiceSubmitted = false;
    practiceChoice = null;
  }

  // Clears this browser's private session state: progress, statuses, practice, notes, selection, and open dialogs (@S87).
  // Account-owned records (votes, adoptions, and publications) stay with their account.
  function purgeSessionState(): void {
    recordedProgressEvents = [];
    statusOverrides.clear();
    skippedActivityIds = [];
    resetPractice();
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
    adoptModuleIds = [];
    resourceScope = "selected";
    resourceCategory = "All";
    generatedPlans = [];
    intakeGoalTitle = "";
    lastPipelineReceipt = null;
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
      adoptModuleIds = unitIdsOf(adoptListing());
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

  // A checked unit is in the resolved scope, either chosen or pulled in as a prerequisite. Unchecking it also drops
  // each chosen unit that needs it, so the unit really leaves the scope. Checking an unchecked unit chooses it.
  // A unit outside the open listing changes nothing.
  function toggleAdoptUnit(moduleId: string): boolean {
    const listing = adoptListing();
    if (!listing || !unitIdsOf(listing).includes(moduleId)) return false;
    const needs = (id: string): boolean => adoptionScopeOf(listing, [id]).resolvedModuleIds.includes(moduleId);
    adoptModuleIds = adoptModuleIds.some(needs) ? adoptModuleIds.filter((id) => !needs(id)) : [...adoptModuleIds, moduleId];
    return true;
  }

  // Adoption makes a private draft and opens it on the Plan page. Activation stays a separate, explicit step (@S59).
  function adopt(listing: MarketplaceListing): void {
    if (adoptModuleIds.length === 0) return;
    const moduleIds = adoptionScopeOf(listing, adoptModuleIds).resolvedModuleIds;
    adoptions = [...adoptions, { accountId: account.accountId, publicationId: listing.publicationId, moduleIds, active: false }];
    adoptPublicationId = null;
    adoptModuleIds = [];
    openDialogId = null;
    selectCurriculum(`adopted-${listing.publicationId}`);
    topLevel = "Learn";
    learnSubDestination = "Plan";
  }

  function activateSelectedDraft(): void {
    adoptions = adoptions.map((adoption) => (adoption.accountId === account.accountId && `adopted-${adoption.publicationId}` === selectedCurriculumId
      ? { ...adoption, active: true } : adoption));
    generatedPlans = generatedPlans.map((plan) => (plan.curriculumId === selectedCurriculumId ? { ...plan, draft: false } : plan));
  }

  const publishedFromSelected = (): boolean =>
    listings().some((listing) => listing.ownerAccountId === account.accountId && listing.sourceCurriculumId === selectedCurriculumId);

  // Publishing adds an immutable public revision of the selected plan to Explore and My Publications (@S56).
  // The listing keeps the plan's structure and drops account, evidence, date, and reminder data (@S57).
  function publishSelectedPlan(): void {
    const plan = planData();
    const key = `${plan.curriculumId}-${account.accountId}`;
    const origin = listings().find((listing) => listing.publicationId === plan.publicationId && listing.ownerAccountId !== account.accountId);
    const tags = curriculumTagsOf(plan.curriculum, {
      subject: plan.domain,
      gateStyle: plan.assessmentMode,
      topicTags: origin?.topicTags,
    });
    publishedListings = [...publishedListings, {
      publicationId: `publication-${key}`, revisionId: `public-revision-${key}-1`,
      subject: tags.subject, gateStyle: tags.gateStyle, topicTags: tags.topicTags, handle: handleOf(account),
      upvotes: 0, adoptions: 0, publishedAt: new Date().toISOString(),
      ownerAccountId: account.accountId, sourceCurriculumId: plan.curriculumId, basedOn: origin?.handle ?? null,
      curriculum: {
        ...plan.curriculum, account_id: "public-template",
        subject: tags.subject, gate_style: tags.gateStyle, topic_tags: tags.topicTags,
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
      authStatus, account, returnTo, authNotice, marketplaceFilters, marketplaceSort, marketplaceTopicsExpanded,
      votes: [...votes] as readonly Vote[], adoptions: [...adoptions] as readonly Adoption[],
      publishedListings: [...publishedListings] as readonly MarketplaceListing[],
      adoptPublicationId, adoptModuleIds: [...adoptModuleIds] as readonly string[],
      resourceScope, resourceCategory,
      openDialogId, hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice,
      skippedActivityIds: [...skippedActivityIds] as readonly string[],
      remindersEnabled, remindersPaused, keyVisible, diagnosticControl, adaptationChoice,
      loadMoreNote, intakeNote, keyActionNote, snoozeNote, rescheduleSessionId, rescheduleValue,
      depthOverrideReset, studyDetailOpen, inspectorMode, flowOrder, deepDive, spacedReview,
      catalogResources, intakeGoalTitle, intakeSubject,
      intakeTopics: [...intakeTopics] as readonly string[],
      intakeDepth, intakeFlow, intakeMaterials, intakeWeeklyMinutes, intakeFitMode,
      intakeSelectedResourceIds: [...intakeSelectedResourceIds] as readonly string[],
      intakeSkippedResourceIds: [...intakeSkippedResourceIds] as readonly string[],
      generatedPlans: [...generatedPlans] as readonly ActiveCurriculum[],
      lastPipelineReceipt,
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
      inspectorMode = "unit";
      studyDetailOpen = true;
      const matchedMod = buildCurrentPlanModel().outlineModules.find((m) => m.moduleId === moduleId);
      if (matchedMod?.activityIds.length && (!selectedActivityId || !matchedMod.activityIds.includes(selectedActivityId))) {
        selectActivity(matchedMod.activityIds[0] ?? null);
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
      if (nextModel.selectedActivityId) selectActivity(nextModel.selectedActivityId);
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
          ? placeOf("Explore", learnSubDestination, "dialog-partial-adoption", listing.publicationId, `Explore › Details: ${goalTitleOf(listing.curriculum)}`)
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
      else if (action === "set-marketplace-filter" && isOneOf(MARKETPLACE_FACETS, data["facet"])) {
        // A typed topic matches its tag in any letter case. An unknown value changes nothing.
        const typed = (value("value") ?? "").trim().toLowerCase();
        const chosen = facetValuesOf(data["facet"], listings()).find((option) => option.toLowerCase() === typed);
        if (chosen) marketplaceFilters = withMarketplaceFilter(marketplaceFilters, data["facet"], chosen, listings());
        else handled = false;
      } else if (action === "toggle-marketplace-topics") marketplaceTopicsExpanded = !marketplaceTopicsExpanded;
      else if (action === "clear-marketplace-filters") marketplaceFilters = NO_MARKETPLACE_FILTERS;
      else if (action === "set-marketplace-sort" && isOneOf(MARKETPLACE_SORTS, data["sort"])) marketplaceSort = data["sort"];
      else if (action === "set-marketplace-query") marketplaceFilters = { ...marketplaceFilters, query: (value("query") ?? "").trim().slice(0, 100) };
      else if (action === "open-adopt-dialog" && adoptableListing(data["publicationId"])) {
        adoptPublicationId = data["publicationId"] ?? null;
        adoptModuleIds = unitIdsOf(adoptListing());
        openDialogId = "dialog-partial-adoption";
      } else if (action === "toggle-adopt-module") handled = toggleAdoptUnit(data["moduleId"] ?? "");
      else if (action === "select-all-adopt-modules" && adoptListing()) adoptModuleIds = unitIdsOf(adoptListing());
      // The selection belongs to the open listing, so a confirm for another listing adopts nothing.
      else if (action === "confirm-adopt-curriculum" && data["publicationId"] === adoptPublicationId) {
        const listing = adoptableListing(adoptPublicationId);
        if (listing) adopt(listing);
      } else if (action === "confirm-publish-curriculum" && !publishedFromSelected()) publishSelectedPlan();
      else if (action === "activate-revision" && planData().draft) activateSelectedDraft();
      else if (action === "select-curriculum" && data["curriculumId"] === "__edit_plan__") {
        topLevel = "Learn";
        learnSubDestination = "Plan";
        studyDetailOpen = false;
      } else if (action === "select-curriculum" && data["curriculumId"] === "all") resourceScope = "all";
      else if (action === "select-curriculum" && isMyPlan(data["curriculumId"])) {
        selectCurriculum(data["curriculumId"]);
        resourceScope = "selected";
      } else if (action === "set-resource-scope" && isOneOf(RESOURCE_SCOPES, data["resourceScope"])) {
        resourceScope = data["resourceScope"];
      } else if (action === "set-resource-category" && isOneOf(RESOURCE_CATEGORIES, data["resourceCategory"])) {
        resourceCategory = data["resourceCategory"];
      } else if (action === "open-curriculum-plan" && isMyPlan(data["curriculumId"])) {
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
      else if (action === "request-hint") {
        hintRequested = true;
        practiceChoice = submittedChoice ?? practiceChoice;
      } else if (action === "study-worked-solution") {
        workedSolutionRevealed = true;
        practiceChoice = submittedChoice ?? practiceChoice;
      } else if (action === "submit-practice") {
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
      else if (action === "set-intake-subject" && isOneOf(INTAKE_SUBJECTS, data["intakeSubject"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeSubject = data["intakeSubject"];
        intakeTopics = [];
        intakeSelectedResourceIds = buildIndexedMaterialCandidates(
          catalogResources,
          intakeSubject,
          intakeTopics,
          intakeMaterials,
        ).map((m) => m.resourceVersionId);
        intakeSkippedResourceIds = [];
      } else if (action === "toggle-intake-topic" && data["intakeTopic"]) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeTopics = resolveDependentTopicToggle(intakeSubject, intakeTopics, data["intakeTopic"]);
      } else if (action === "clear-intake-topics") {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeTopics = [];
      } else if (action === "set-intake-depth" && isOneOf(INTAKE_DEPTH_CHOICES, data["intakeDepth"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeDepth = data["intakeDepth"];
      } else if (action === "set-intake-flow" && isOneOf(INTAKE_FLOW_CHOICES, data["intakeFlow"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeFlow = data["intakeFlow"];
      } else if (action === "set-intake-materials" && isOneOf(INTAKE_MATERIALS_CHOICES, data["intakeMaterials"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeMaterials = data["intakeMaterials"];
        intakeSelectedResourceIds = buildIndexedMaterialCandidates(
          catalogResources,
          intakeSubject,
          intakeTopics,
          intakeMaterials,
        )
          .map((m) => m.resourceVersionId)
          .filter((id) => !intakeSkippedResourceIds.includes(id));
      } else if (action === "set-intake-pace" && data["weeklyMinutes"]) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        const parsed = Number.parseInt(data["weeklyMinutes"], 10);
        if (Number.isFinite(parsed) && parsed > 0) intakeWeeklyMinutes = parsed;
      } else if (action === "set-intake-fit-mode" && isOneOf(INTAKE_FIT_MODES, data["fitMode"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeFitMode = data["fitMode"];
      } else if (action === "toggle-intake-resource" && data["resourceId"]) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        const resId = data["resourceId"];
        if (intakeSelectedResourceIds.includes(resId)) {
          intakeSelectedResourceIds = intakeSelectedResourceIds.filter((id) => id !== resId);
        } else {
          intakeSelectedResourceIds = [...intakeSelectedResourceIds, resId];
          intakeSkippedResourceIds = intakeSkippedResourceIds.filter((id) => id !== resId);
        }
      } else if (action === "skip-intake-resource" && data["resourceId"]) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        const resId = data["resourceId"];
        if (intakeSkippedResourceIds.includes(resId)) {
          intakeSkippedResourceIds = intakeSkippedResourceIds.filter((id) => id !== resId);
        } else {
          intakeSkippedResourceIds = [...intakeSkippedResourceIds, resId];
          intakeSelectedResourceIds = intakeSelectedResourceIds.filter((id) => id !== resId);
        }
      } else if (action === "intake-open-existing-plan" && isMyPlan(data["curriculumId"])) {
        selectCurriculum(data["curriculumId"]);
        openDialogId = null;
        topLevel = "Learn";
        learnSubDestination = "Plan";
      } else if (action === "intake-adopt-marketplace-plan" && data["publicationId"]) {
        const listing = adoptableListing(data["publicationId"]);
        if (listing) {
          adoptPublicationId = listing.publicationId;
          adoptModuleIds = unitIdsOf(listing);
          adopt(listing);
        } else {
          const existing = currentPlans().find((p) => p.publicationId === data["publicationId"]);
          if (existing) {
            selectCurriculum(existing.curriculumId);
            openDialogId = null;
            topLevel = "Learn";
            learnSubDestination = "Plan";
          }
        }
      } else if (action === "review-generate") {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeNote = "Review recorded. Generation was not started and the plan was not activated. Chargeable inference needs a separate authorization.";
      } else if (action === "generate-curriculum-ai") {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        if (data["weeklyMinutes"]) {
          const parsed = Number.parseInt(data["weeklyMinutes"], 10);
          if (Number.isFinite(parsed) && parsed > 0) intakeWeeklyMinutes = parsed;
        }
        const fitEvaluation = evaluateIntakeResourceFit({
          goalTitle: intakeGoalTitle,
          subject: intakeSubject,
          requestedTopics: intakeTopics,
          depth: intakeDepth,
          flowOrder: intakeFlow,
          materialsAccess: intakeMaterials,
          weeklyMinutes: intakeWeeklyMinutes,
          fitMode: intakeFitMode,
          selectedResourceIds: intakeSelectedResourceIds,
          skippedResourceIds: intakeSkippedResourceIds,
          catalogResources,
          myPlans: currentPlans(),
          marketplaceListings: listings(),
        });
        const pipelineResult = executeIntakeGenerationPipeline({
          fitEvaluation,
          goalTitle: intakeGoalTitle,
          subject: intakeSubject,
          requestedTopics: intakeTopics,
          depth: intakeDepth,
          flowOrder: intakeFlow,
          materialsAccess: intakeMaterials,
          weeklyMinutes: intakeWeeklyMinutes,
          fitMode: intakeFitMode,
          accountId: account.accountId,
          catalogResources,
        });
        catalogResources = pipelineResult.updatedCatalogResources;
        generatedPlans = [
          ...generatedPlans.filter((p) => p.curriculumId !== pipelineResult.generatedPlan.curriculumId),
          pipelineResult.generatedPlan,
        ];
        lastPipelineReceipt = pipelineResult.receipt;
        intakeNote = pipelineResult.receipt.summaryNote;
        openDialogId = null;
        selectCurriculum(pipelineResult.generatedPlan.curriculumId);
        topLevel = "Learn";
        learnSubDestination = "Plan";
      } else if (action === "view-evidence" || action === "check-prerequisites") handled = true;
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
  scrollTop?: number;
  querySelector?: (selector: string) => { focus?: () => void } | null;
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

  type ScrollableRail = { scrollLeft: number } | null | undefined;
  const getRail = (): ScrollableRail => rootElement.querySelector?.(".today-curricula-grid") as ScrollableRail;

  // The focused control, as a selector made from its data attributes. A control without a data-action has none.
  function focusedControlSelector(): string | null {
    const dataset = (globalThis.document?.activeElement as HTMLElement | null | undefined)?.dataset;
    if (!dataset?.["action"]) return null;
    return Object.entries(dataset)
      .map(([key, value]) => `[data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(value ?? "")}"]`)
      .join("");
  }

  // A render replaces every element. When the same dialog stays open, it keeps its scroll position and focused control.
  // Without this, checking a unit far down in Details jumps back to the top and moves focus to the close button.
  function syncDom(): void {
    const railLeft = getRail()?.scrollLeft ?? 0;
    const shown = rootElement.querySelector?.("dialog[open]") as MountedDialog | null | undefined;
    const shownTop = shown?.scrollTop ?? 0;
    const focused = focusedControlSelector();
    rootElement.innerHTML = controller.renderHtml();
    const nextRail = getRail();
    if (nextRail) nextRail.scrollLeft = railLeft;
    bindDialogs();
    const marked = rootElement.querySelector?.('dialog[data-open="true"]') as MountedDialog | null | undefined;
    if (marked && typeof marked.showModal === "function" && !marked.open) marked.showModal();
    if (marked && shown && marked.id === shown.id) {
      marked.scrollTop = shownTop;
      if (focused) marked.querySelector?.(focused)?.focus?.();
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
      // The drawer re-renders on each practice action, so each one reads the chosen answer first.
      if (PRACTICE_ACTIONS.has(action ?? "") && typeof rootElement.querySelector === "function") {
        const checked = rootElement.querySelector('input[name="practice-choice"]:checked') as { value?: string } | null;
        data["practiceChoice"] = checked?.value;
      }
      if (action === "reschedule-session" && ds["sessionId"] && typeof rootElement.querySelector === "function") {
        const input = rootElement.querySelector(`[data-reschedule-for="${ds["sessionId"]}"]`) as { value?: string } | null;
        data["rescheduleValue"] = input?.value ?? "";
      }
      if (typeof rootElement.querySelector === "function") {
        const goalInput = rootElement.querySelector("#intake-goal") as { value?: string } | null;
        if (typeof goalInput?.value === "string") data["intakeGoalTitle"] = goalInput.value;
      }
      if ((action === "generate-curriculum-ai" || action === "review-generate") && typeof rootElement.querySelector === "function") {
        const minsInput = rootElement.querySelector("#weekly-minutes") as { value?: string } | null;
        if (minsInput?.value) data["weeklyMinutes"] = minsInput.value;
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
    const ev = rawEvent as { target?: { closest?: (s: string) => { value?: string; dataset?: Record<string, string | undefined> } | null } | null };
    const select = ev.target?.closest?.("select[data-action]");
    if (!select?.value) return;
    const action = select.dataset?.["action"] ?? "select-curriculum";
    const goalInput =
      typeof rootElement.querySelector === "function"
        ? (rootElement.querySelector("#intake-goal") as { value?: string } | null)
        : null;
    const intakeGoalTitle = typeof goalInput?.value === "string" ? goalInput.value : undefined;
    const payload: Record<string, string | undefined> =
      action === "select-curriculum"
        ? { curriculumId: select.value }
        : action === "set-intake-subject"
          ? { intakeSubject: select.value, intakeGoalTitle }
          : action === "toggle-intake-topic"
            ? { intakeTopic: select.value, intakeGoalTitle }
            : { value: select.value };
    if (controller.applyUiAction(action, payload).handled) syncDom();
  });

  // The sign-in form, the Marketplace search, and the topic finder submit through their own data-action, with the field they carry.
  rootElement.addEventListener?.("submit", (rawEvent: unknown) => {
    const ev = rawEvent as {
      target?: { closest?: (s: string) => { dataset?: Record<string, string | undefined> } | null } | null;
      preventDefault?: () => void;
    };
    const action = ev.target?.closest?.("form[data-action]")?.dataset?.["action"];
    if (!action) return;
    ev.preventDefault?.();
    const valueOf = (selector: string): string => (rootElement.querySelector?.(selector) as { value?: string } | null | undefined)?.value ?? "";
    const data =
      action === "submit-sign-in" ? { email: valueOf("#auth-email-input") }
      : action === "set-marketplace-filter" ? { facet: "topic", value: valueOf("#marketplace-topic") }
      : { query: valueOf("#marketplace-search") };
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
