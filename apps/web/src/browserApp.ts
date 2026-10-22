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
  buildFourBucketCostBreakdown, createHostedBillingController, formatMinorCurrency, resolveTransitiveAdoptionScope,
  type HostedCreditWalletSnapshot, type PublicCurriculumContentBlock,
} from "./billingAndSharing.ts";
import { createAccountPrivacyController } from "./releaseAndA11yViews.ts";
import { clamp, escapeHtml, normalizeStringList } from "./shared.ts";

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

// A learner plan: its curriculum and schedule, the domain and gate style its cards show, the Marketplace listing it
// came from or was published as, and whether it is still a draft. Catalog and proficiency data are shared by all plans.
interface ActiveCurriculum {
  readonly curriculumId: string;
  readonly domain: string;
  readonly assessmentMode: string;
  readonly curriculum: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
  readonly publicationId: string | null;
  readonly draft: boolean;
}

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

const MARKETPLACE_DOMAINS = ["All", "Engineering", "Mathematics", "Humanities", "Systems"] as const;
const MARKETPLACE_RIGORS = ["All", "Formal", "Applied", "Intuitive"] as const;
const MARKETPLACE_SORTS = ["top_upvoted", "most_adopted", "newest"] as const;
type MarketplaceDomain = (typeof MARKETPLACE_DOMAINS)[number];
type MarketplaceRigor = (typeof MARKETPLACE_RIGORS)[number];
type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];
const SORT_LABELS: Readonly<Record<MarketplaceSort, string>> = { top_upvoted: "Top Upvoted", most_adopted: "Most Adopted", newest: "Newest" };
// A plan's subject maps to one Marketplace filter. Literature files under Humanities and Physics under Mathematics.
const FILTER_DOMAIN_OF: Readonly<Record<string, Exclude<MarketplaceDomain, "All">>> = {
  Engineering: "Engineering", Mathematics: "Mathematics", Literature: "Humanities", Systems: "Systems", Physics: "Mathematics",
};

// A public revision in the Marketplace. It carries the plan an adopter copies, and its owner's account when one is known.
interface MarketplaceListing {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly subject: string;
  readonly gateStyle: string;
  readonly handle: string;
  readonly upvotes: number;
  readonly adoptions: number;
  readonly publishedAt: string;
  readonly ownerAccountId: string | null;
  readonly sourceCurriculumId: string | null;
  readonly basedOn: string | null;
  readonly curriculum: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
}

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

// Signed-in identity. The demo personas stand in for real accounts, because no account provider is connected.
const AUTH_STATUSES = ["authenticated", "guest", "session_expired"] as const;
type AuthStatus = (typeof AUTH_STATUSES)[number];
interface Account { readonly accountId: string; readonly email: string; readonly role: "Learner" | "Curator" | "Moderator" }
const PERSONAS = {
  learner: { accountId: "learner-default", email: "alex@curriculum.io", role: "Learner" },
  curator: { accountId: "curator-ada", email: "ada@curriculum.io", role: "Curator" },
  moderator: { accountId: "moderator-mo", email: "mo@curriculum.io", role: "Moderator" },
} as const satisfies Readonly<Record<string, Account>>;
const PERSONA_CHOICES = ["learner", "curator", "moderator", "guest"] as const;
const handleOf = (account: Account): string => `@${account.email.split("@")[0] ?? "learner"}`;

// What publishing leaves out. The public projection carries none of it (@S57).
const PRIVATE_FIELDS_REMOVED = [
  "Your progress and completion records",
  "Proficiency, evidence, and diagnostic answers",
  "Notes, attempts, and practice drafts",
  "BYOK keys and provider connections",
  "Billing, budgets, and wallet state",
  "Your session dates and reminder settings",
] as const;

// Where sign-in returns the learner. It restores a place and an open dialog, never the action itself (UI-009).
interface ReturnDestination {
  readonly label: string;
  readonly topLevel: TopLevelDestination;
  readonly learnSubDestination: LearnSubDestination;
  readonly openDialogId: string | null;
  readonly adoptPublicationId: string | null;
}

// Account-owned records. Votes and adoptions belong to one account, so signing out never changes a public count.
interface Adoption { readonly accountId: string; readonly publicationId: string; readonly moduleIds: readonly string[]; readonly active: boolean }
interface Vote { readonly accountId: string; readonly revisionId: string }

interface SelfCheckRubric { readonly prompt: string; readonly criteria: readonly string[] }

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

type SfIconName =
  | "learn" | "explore" | "settings"
  | "today" | "plan" | "progress" | "resources"
  | "zoom-in" | "zoom-out" | "reset" | "focus"
  | "check" | "close"
  | "clock" | "rigor" | "pin" | "code";

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
  close: `<path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"/>`,
  clock: `<circle cx="8" cy="8" r="5.25"/><path d="M8 5.25V8l1.9 1.25"/>`,
  rigor: `<path d="M3 2.75v10.5h10.5z"/><path d="M3 10.5h2.75v2.75"/>`,
  pin: `<path d="M6 2.75h4l-.6 3.6 1.85 2.15h-6.5L6.6 6.35z"/><path d="M8 8.5v4.75"/>`,
  code: `<path d="M5.75 4.75 2.5 8l3.25 3.25M10.25 4.75 13.5 8l-3.25 3.25"/>`,
};

function sfIcon(name: SfIconName, size: 15 | 16 = 16): string {
  return `<svg class="sf-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SF_ICON_PATHS[name]}</svg>`;
}

const INSPECTOR_ID = "learn-detail-inspector";

const FLOW_ORDERS = ["theory_first", "application_first", "balanced"] as const;
const DEEP_DIVE_MODES = ["included", "skipped"] as const;
const SPACED_REVIEW_MODES = ["included", "compact"] as const;
export type FlowOrder = (typeof FLOW_ORDERS)[number];
export type DeepDiveMode = (typeof DEEP_DIVE_MODES)[number];
export type SpacedReviewMode = (typeof SPACED_REVIEW_MODES)[number];

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

type GlyphTone = "todo" | "doing" | "done";
type GlyphKind = "module" | "gate";
type StudyModule = PlanMapAndOutlineModel["outlineModules"][number];
type StudyActivity = StudyModule["activities"][number];
type RightsBadge = StudyActivity["resourceProvenanceCards"][number]["rightsBadge"];
type FlowTrackId = "lecture" | "deep_dive" | "code" | "review" | "gate";
type SegmentStyle = "solid" | "dashed";

const TRACK_OF_TYPE: Readonly<Record<StudyActivity["type"], FlowTrackId>> = {
  theory: "lecture", worked_example: "deep_dive", reflection: "deep_dive",
  coding: "code", project: "code", review: "review", quiz: "gate",
};

const TRACK_LABELS: Readonly<Record<FlowTrackId, { readonly column: string; readonly badge: string }>> = {
  lecture: { column: "Lecture", badge: "Lecture" },
  deep_dive: { column: "Deep Dive", badge: "Deep Dive" },
  code: { column: "Code", badge: "Code Lab" },
  review: { column: "Review", badge: "Spaced Review" },
  gate: { column: "Gate", badge: "Gate" },
};

const FLOW_ORDER_OPTIONS: Readonly<Record<FlowOrder, { readonly label: string; readonly tracks: readonly FlowTrackId[] }>> = {
  theory_first: { label: "Theory", tracks: ["lecture", "deep_dive", "code"] },
  application_first: { label: "Code first", tracks: ["code", "lecture", "deep_dive"] },
  balanced: { label: "Balanced", tracks: ["lecture", "code", "deep_dive"] },
};

interface FlowView {
  readonly order: FlowOrder;
  readonly deepDive: DeepDiveMode;
  readonly spacedReview: SpacedReviewMode;
}

function plannedFlowOrder(curriculum: Record<string, unknown>): FlowOrder {
  const applied = curriculum["sequence_preference_applied"];
  return isOneOf(FLOW_ORDERS, applied) ? applied : "theory_first";
}

const trackOf = (activity: StudyActivity): FlowTrackId => (activity.masteryGated ? "gate" : TRACK_OF_TYPE[activity.type]);

// Flow tracks in the chosen order, then the optional Review column, then the Gate.
function flowColumns(view: FlowView): readonly FlowTrackId[] {
  const tracks = FLOW_ORDER_OPTIONS[view.order].tracks.filter((track) => track !== "deep_dive" || view.deepDive === "included");
  return [...tracks, ...(view.spacedReview === "included" ? ["review" as const] : []), "gate"];
}

function humanize(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const fit = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const rightsWords = (badge: RightsBadge): string => `${humanize(badge.basis)}${badge.externalLinkOnly ? " (external link only)" : ""}`;

const isClosed = (status: string): boolean => status === "completed" || status === "self_reported_completed" || status === "waived";

function executionTone(status: string): GlyphTone {
  if (isClosed(status)) return "done";
  return status === "in_progress" ? "doing" : "todo";
}

function executionWords(status: string): string {
  if (status === "self_reported_completed") return "Self-reported completed";
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  if (status === "waived") return "Waived by reviewed evidence";
  return "Not started";
}

const effortWords = ({ min, point, max }: { readonly min: number; readonly point: number; readonly max: number }): string =>
  min === max ? `${point} min` : `${point} min (${min}–${max} min)`;

interface UnitProgress { readonly done: number; readonly total: number; readonly left: number; readonly started: boolean }

// Optional work stays out of the denominator (Section 9.7).
function unitProgress(activities: readonly StudyActivity[]): UnitProgress {
  const required = activities.filter((activity) => activity.required);
  const open = required.filter((activity) => !isClosed(activity.executionStatus));
  return {
    done: required.length - open.length,
    total: required.length,
    left: open.reduce((sum, activity) => sum + activity.durationTriplet.point, 0),
    started: activities.some((activity) => activity.executionStatus !== "not_started"),
  };
}

function unitTone(progress: UnitProgress): GlyphTone {
  if (progress.total > 0 && progress.done === progress.total) return "done";
  return progress.started ? "doing" : "todo";
}

function progressLabel(progress: UnitProgress): string {
  if (progress.total === 0) return "Optional only";
  return progress.left > 0 ? `${progress.done}/${progress.total} · ${progress.left}m` : `${progress.done}/${progress.total}`;
}

interface GateStatus { readonly passed: boolean; readonly demonstrated: number; readonly total: number }

function gateStatus(statuses: readonly string[]): GateStatus {
  const demonstrated = statuses.filter((status) => status === "demonstrated").length;
  return { passed: statuses.length > 0 && demonstrated === statuses.length, demonstrated, total: statuses.length };
}

const gateCriteria = (gate: GateStatus): string => gate.total === 0
  ? "No objectives mapped"
  : `${gate.passed ? "Passed" : "Not passed"} · ${gate.demonstrated} of ${gate.total} objective${gate.total === 1 ? "" : "s"} demonstrated`;

const gateActivities = (mod: StudyModule): readonly StudyActivity[] => mod.activities.filter((activity) => trackOf(activity) === "gate");

// A unit's gate is its quiz or mastery-gated work; a unit without one is gated by its own objectives.
function unitGate(mod: StudyModule): GateStatus {
  const gates = gateActivities(mod);
  return gates.length > 0
    ? gateStatus(gates.flatMap((activity) => activity.objectiveProficiencyBadges.map((badge) => badge.status)))
    : gateStatus(mod.objectives.map((objective) => objective.proficiencyStatus));
}

const displayUnitTitle = (title: string): string => title.replace(/^Module\s+\d+\s*:\s*/, "");

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

function unitMarker(tone: GlyphTone, size = 24): string {
  const body = tone === "done"
    ? `<circle class="st-m-disc" cx="12" cy="12" r="10" /><path class="st-m-check" d="M7.3 12.3 10.4 15.4 16.6 8.8" />`
    : `<circle class="st-m-ring" cx="12" cy="12" r="9.2" />${tone === "doing" ? `<path class="st-m-half" d="M12 2.8a9.2 9.2 0 0 0 0 18.4Z" />` : ""}`;
  return `<svg class="st-marker" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" data-status="${tone}">${body}</svg>`;
}

const ARROW_SVG = (className: string, style: SegmentStyle = "solid"): string =>
  `<svg class="${className}" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" data-style="${style}"><line x1="1" y1="6" x2="26" y2="6" /><path d="M20.5 2 26 6 20.5 10" /></svg>`;

// One horizontal piece of a row connector. A cell draws only the part inside its own padding box.
function connectorSvg(kind: "in" | "out" | "through", style: SegmentStyle): string {
  const head = kind === "in" ? `<svg x="100%" overflow="visible"><path d="M-7.5 2 -1.5 6 -7.5 10" /></svg>` : "";
  return `<svg class="matrix-svg" data-seg="${kind}" data-style="${style}" aria-hidden="true"><line x1="0" y1="6" x2="100%" y2="6" />${head}</svg>`;
}

function flowKeyHtml(): string {
  const item = (glyph: string, label: string) => `<li>${glyph}<span>${label}</span></li>`;
  return `<ul class="flow-key" aria-label="Flowchart key">${item(statusGlyph("module", "todo", 16), "Not started")}${item(statusGlyph("module", "doing", 16), "In progress")}${item(statusGlyph("module", "done", 16), "Done")}${item(statusGlyph("gate", "todo", 16), "Gate not passed")}${item(statusGlyph("gate", "done", 16), "Gate passed")}${item(ARROW_SVG("key-line"), "Next step")}${item(ARROW_SVG("key-line", "dashed"), "Optional enrichment")}</ul>`;
}

function checkButton(activity: StudyActivity, className: string): string {
  const id = escapeHtml(activity.activityId);
  const done = activity.executionStatus === "completed" || activity.executionStatus === "self_reported_completed";
  return `<button type="button" class="${className}" data-action="complete-activity" data-activity-id="${id}" data-module-id="${escapeHtml(activity.moduleId)}" data-event-id="evt-complete-${id}" aria-pressed="${done}">${statusGlyph("module", executionTone(activity.executionStatus), 20)}<span class="st-sr">${done ? "Self-reported completed" : "Mark self-reported completed"}: ${escapeHtml(activity.title)}</span></button>`;
}

// A card holds only its title, duration, optional mark, and check. The column header names the track.
function renderNodeCard(activity: StudyActivity, selectedActivityId: string | null): string {
  const id = escapeHtml(activity.activityId);
  const mod = escapeHtml(activity.moduleId);
  const selected = activity.activityId === selectedActivityId;
  const { min, point, max } = activity.durationTriplet;
  return `<article class="node-card" data-activity-id="${id}" data-execution-status="${escapeHtml(activity.executionStatus)}" data-module-id="${mod}" data-track="${trackOf(activity)}" data-required="${activity.required}" data-selected="${selected}" data-open="${selected}" data-proficiency-status="${escapeHtml(activity.objectiveProficiencyStatus)}" data-mastery-gated="${activity.masteryGated}">
      <button type="button" class="node-open" data-action="select-outline-activity" data-activity-id="${id}" data-module-id="${mod}" aria-pressed="${selected}">
        <span class="node-title">${escapeHtml(activity.title)}</span>
        <span class="node-foot"><span class="node-duration">${point}m</span>${activity.required ? "" : `<span class="node-optional">Optional</span>`}</span>
        <span class="st-sr">${executionWords(activity.executionStatus)}. ${activity.required ? "Required" : "Optional"}. About ${point} minutes, range ${min} to ${max}. Objective proficiency: ${escapeHtml(humanize(activity.objectiveProficiencyStatus))}.</span>
      </button>
      ${checkButton(activity, "node-check")}
    </article>`;
}

function renderGateDiamond(mod: StudyModule, gate: StudyActivity | null, selectedActivityId: string | null): string {
  const status = gate
    ? gateStatus(gate.objectiveProficiencyBadges.map((badge) => badge.status))
    : gateStatus(mod.objectives.map((objective) => objective.proficiencyStatus));
  const selected = gate !== null && gate.activityId === selectedActivityId;
  const target = gate
    ? `data-action="select-outline-activity" data-activity-id="${escapeHtml(gate.activityId)}" data-module-id="${escapeHtml(mod.moduleId)}" aria-pressed="${selected}"`
    : `data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}"`;
  return `<button type="button" class="gate-diamond" ${target} data-status="${status.passed ? "passed" : "open"}">
      <svg class="gate-shape" viewBox="0 0 84 84" width="84" height="84" aria-hidden="true"><rect x="14" y="14" width="56" height="56" rx="8" transform="rotate(45 42 42)" />${status.passed ? `<path d="M31 43 39 51 54 34" />` : ""}</svg>
      <span class="st-sr">Gate. </span><span class="gate-title">${escapeHtml(gate ? gate.title : "Objective check")}</span>
      <span class="gate-criteria">${gateCriteria(status)}${gate ? ` · ${gate.durationTriplet.point}m` : ""}</span>
    </button>`;
}

interface UnitPlacement {
  readonly mod: StudyModule;
  readonly cells: ReadonlyMap<FlowTrackId, readonly StudyActivity[]>;
  readonly hidden: readonly StudyActivity[];
  readonly postGate: ReadonlySet<string>;
}

// Work that depends on the unit's gate, directly or through other work, comes after the gate.
function postGateIds(mod: StudyModule): ReadonlySet<string> {
  const gateIds = new Set(gateActivities(mod).map((activity) => activity.activityId));
  const postGate = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const activity of mod.activities) {
      if (gateIds.has(activity.activityId) || postGate.has(activity.activityId)) continue;
      if (activity.prerequisiteActivityIds.some((id) => gateIds.has(id) || postGate.has(id))) {
        postGate.add(activity.activityId);
        grew = true;
      }
    }
  }
  return postGate;
}

// Reviews and work that depends on the gate keep their column but stay off the row's arrow chain.
function placeUnit(mod: StudyModule, view: FlowView): UnitPlacement {
  const postGate = postGateIds(mod);
  const cells = new Map<FlowTrackId, StudyActivity[]>();
  const hidden: StudyActivity[] = [];
  // Pre-gate work goes first in each column, so an arrow always lands on a card that belongs to the chain.
  const ordered = [...mod.activities].sort((a, b) => Number(postGate.has(a.activityId)) - Number(postGate.has(b.activityId)));
  for (const activity of ordered) {
    const own = trackOf(activity);
    const skipDeepDive = own === "deep_dive" && view.deepDive === "skipped";
    // The time-saver drops optional deep dives only; required work is never hidden.
    if (skipDeepDive && !activity.required) {
      hidden.push(activity);
      continue;
    }
    const column: FlowTrackId = skipDeepDive ? "lecture" : own === "review" && view.spacedReview === "compact" ? "gate" : own;
    cells.set(column, [...(cells.get(column) ?? []), activity]);
  }
  return { mod, cells, hidden, postGate };
}

function renderUnitRow(
  units: readonly UnitPlacement[], index: number, columns: readonly FlowTrackId[],
  selectedModuleId: string | null, selectedActivityId: string | null,
): string {
  const unit = units[index];
  if (!unit) return "";
  const { mod, cells, postGate } = unit;
  const modId = escapeHtml(mod.moduleId);
  const selected = mod.moduleId === selectedModuleId;
  const progress = unitProgress(mod.activities);
  const tone = unitTone(progress);
  const previous = units[index - 1];
  const spineIn = previous ? (unitTone(unitProgress(previous.mod.activities)) === "done" ? "done" : "todo") : "none";
  const spineOut = index < units.length - 1 ? (tone === "done" ? "done" : "todo") : "none";
  const onChain = (activity: StudyActivity): boolean => trackOf(activity) !== "review" && !postGate.has(activity.activityId);

  const chain = columns.flatMap((track, column) => (track === "gate" || (cells.get(track) ?? []).some(onChain) ? [column] : []));
  const optionalAt = (column: number): boolean => {
    const items = (cells.get(columns[column] ?? "gate") ?? []).filter((activity) => onChain(activity) || trackOf(activity) === "gate");
    return items.length > 0 && items.every((activity) => !activity.required);
  };
  const segments = new Map<number, string[]>();
  const crossed = new Set<number>();
  const addSegment = (column: number, svg: string) => segments.set(column, [...(segments.get(column) ?? []), svg]);
  chain.forEach((to, k) => {
    const from = chain[k - 1];
    if (from === undefined) return;
    const style: SegmentStyle = optionalAt(from) || optionalAt(to) ? "dashed" : "solid";
    addSegment(from, connectorSvg("out", style));
    for (let column = from + 1; column < to; column++) {
      addSegment(column, connectorSvg("through", style));
      crossed.add(column);
    }
    addSegment(to, connectorSvg("in", style));
  });

  const cellsHtml = columns.map((track, column) => {
    const items = cells.get(track) ?? [];
    const gates = items.filter((activity) => trackOf(activity) === "gate");
    const cards = items.filter((activity) => trackOf(activity) !== "gate")
      .map((activity) => renderNodeCard(activity, selectedActivityId)).join("");
    const diamonds = track !== "gate" ? ""
      : gates.length > 0 ? gates.map((gate) => renderGateDiamond(mod, gate, selectedActivityId)).join("") : renderGateDiamond(mod, null, selectedActivityId);
    // A card in a column the arrow passes over sits below the line instead of under it.
    const state = items.length === 0 ? ` data-empty="true"` : crossed.has(column) ? ` data-crossed="true"` : "";
    return `<td class="flow-cell" data-track="${track}"${track === "gate" ? "" : state}>${(segments.get(column) ?? []).join("")}${diamonds}${cards}</td>`;
  }).join("");

  const rail = `<th class="flow-rail" scope="row" data-spine-in="${spineIn}" data-spine-out="${spineOut}">
        ${index > 0 ? `<svg class="spine-head" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1 5 5 9 1" /></svg>` : ""}
        <button type="button" class="unit-hit" data-action="select-outline-module" data-module-id="${modId}" aria-pressed="${selected}">
          ${unitMarker(tone)}
          <span class="unit-badge">U${index + 1}</span>
          <span class="unit-title">${escapeHtml(displayUnitTitle(mod.title))}</span>
          <span class="unit-meta">${progressLabel(progress)}</span>
          <span class="st-sr">${selected ? "Selected" : "Select"} unit ${index + 1}. ${progress.done} of ${progress.total} required activities done. ${mod.required ? "Required" : "Optional"}. ${escapeHtml(mod.summary)}</span>
        </button>
      </th>`;
  return `<tr class="study-card outline-module-card${selected ? " is-selected" : ""}" data-module-id="${modId}" data-selected="${selected}" data-opaque-surface="true" data-unit-status="${tone}">${rail}${cellsHtml}</tr>`;
}

// A switch carries the value it sets next, and a stable id so the client can restore focus after a re-render.
function renderFlowToolbar(idPrefix: string, view: FlowView): string {
  const toggle = (key: string, label: string, on: boolean, offValue: string) =>
    `<button type="button" id="${idPrefix}-${key}" class="flow-switch" role="switch" aria-checked="${on}" data-action="set-${key}" data-${key}="${on ? offValue : "included"}">${label}<span class="switch-track" aria-hidden="true"></span></button>`;
  return `<div class="flow-toolbar" role="group" aria-label="Flowchart layout">
        <div class="segmented" role="group" aria-label="Flow order">${FLOW_ORDERS.map((order) => `<button type="button" class="seg-btn" data-action="set-flow-order" data-flow-order="${order}" aria-pressed="${order === view.order}">${FLOW_ORDER_OPTIONS[order].label}</button>`).join("")}</div>
        ${toggle("deep-dive", "Deep Dive", view.deepDive === "included", "skipped")}
        ${toggle("spaced-review", "Review", view.spacedReview === "included", "compact")}
      </div>`;
}

function renderFlowBoard(
  idPrefix: string, modules: readonly StudyModule[], selectedModuleId: string | null, selectedActivityId: string | null, view: FlowView,
): string {
  const units = modules.map((mod) => placeUnit(mod, view));
  // A track no unit uses gets no column, so a reading plan shows no empty Code column.
  const columns = flowColumns(view).filter((track) => track === "gate" || units.some((unit) => (unit.cells.get(track) ?? []).length > 0));
  // The order tabs only move columns, so they add no text. Turning Deep Dive off reports what it hides.
  const hidden = units.flatMap((unit) => unit.hidden);
  const hiddenMinutes = hidden.reduce((sum, activity) => sum + activity.durationTriplet.point, 0);
  const note = view.deepDive !== "skipped" ? ""
    : hidden.length > 0
      ? `Deep Dive off hides ${hidden.length} optional deep dive${hidden.length === 1 ? "" : "s"} (${hiddenMinutes} min). Required deep dives stay in the Lecture column.`
      : "No optional deep dives to hide. Required deep dives stay in the Lecture column.";
  const headCells = columns.map((track) => {
    if (track === "gate") {
      const passed = modules.filter((mod) => unitGate(mod).passed).length;
      return `<th scope="col" class="flow-colhead" data-track="gate"><span class="colhead-title">Gate</span><span class="colhead-meta">${passed}/${modules.length} passed</span></th>`;
    }
    const inColumn = units.flatMap((unit) => unit.cells.get(track) ?? []);
    return `<th scope="col" class="flow-colhead" data-track="${track}"><span class="colhead-title">${TRACK_LABELS[track].column}</span><span class="colhead-meta">${progressLabel(unitProgress(inColumn))}</span></th>`;
  }).join("");
  const rows = units.map((_, index) => renderUnitRow(units, index, columns, selectedModuleId, selectedActivityId)).join("");
  return `<section class="flow-board" aria-labelledby="${idPrefix}-title" data-flow-order="${view.order}" data-deep-dive="${view.deepDive}" data-spaced-review="${view.spacedReview}">
    <div class="flow-head">
      <h2 id="${idPrefix}-title">Study flow</h2>
      ${renderFlowToolbar(idPrefix, view)}
    </div>
    ${note ? `<p class="flow-note">${escapeHtml(note)}</p>` : ""}
    <div class="matrix-stage">
      <table class="matrix-table" aria-labelledby="${idPrefix}-title" style="--tracks: ${columns.length - 1}">
        <colgroup><col class="col-rail">${columns.map(() => `<col class="col-track">`).join("")}</colgroup>
        <thead><tr><th scope="col" class="flow-colhead"><span class="colhead-title">Unit</span><span class="colhead-meta">${units.length} in order</span></th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${flowKeyHtml()}
  </section>`;
}

function renderMacroStage(modules: readonly StudyModule[], selectedModuleId: string | null): string {
  const steps = modules.map((mod, index) => {
    const progress = unitProgress(mod.activities);
    const tone = unitTone(progress);
    const gate = unitGate(mod);
    const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
    return `<li class="macro-step">
        <button type="button" class="macro-node" data-action="select-outline-module" data-module-id="${escapeHtml(mod.moduleId)}" data-status="${tone}" aria-pressed="${mod.moduleId === selectedModuleId}">
          <span class="macro-top">${unitMarker(tone, 20)}<span class="unit-badge">U${index + 1}</span><span class="macro-meta">${progressLabel(progress)}</span></span>
          <span class="macro-title">${escapeHtml(displayUnitTitle(mod.title))}</span>
          <span class="macro-bar" aria-hidden="true"><span style="width: ${percent}%"></span></span>
          <span class="st-sr">${progress.done} of ${progress.total} required activities done. Gate ${gate.passed ? "passed" : "not passed"}.</span>
        </button>
        ${ARROW_SVG("macro-link")}
        <span class="macro-gate" data-status="${gate.passed ? "passed" : "open"}" aria-hidden="true">${statusGlyph("gate", gate.passed ? "done" : "todo", 24)}</span>
        ${index < modules.length - 1 ? ARROW_SVG("macro-link") : ""}
      </li>`;
  }).join("");
  return `<ol class="macro-stage" aria-label="Units in study order">${steps}</ol>`;
}

function renderStepRow(activity: StudyActivity, selectedActivityId: string | null, note: string, extraAttrs = ""): string {
  const id = escapeHtml(activity.activityId);
  const selected = activity.activityId === selectedActivityId;
  const track = trackOf(activity);
  const status = track === "gate"
    ? `<span class="step-check">${statusGlyph("gate", gateStatus(activity.objectiveProficiencyBadges.map((badge) => badge.status)).passed ? "done" : "todo", 20)}</span>`
    : checkButton(activity, "step-check");
  return `<li class="today-activity-item step-row" data-activity-id="${id}" data-execution-status="${escapeHtml(activity.executionStatus)}" data-proficiency-status="${escapeHtml(activity.objectiveProficiencyStatus)}" data-selected="${selected}"${extraAttrs}>
      ${status}
      <button type="button" class="step-open" data-action="select-outline-activity" data-activity-id="${id}" data-module-id="${escapeHtml(activity.moduleId)}" aria-pressed="${selected}">
        <span class="step-title">${escapeHtml(activity.title)}</span>
        <span class="step-meta">${TRACK_LABELS[track].badge} · ${activity.durationTriplet.point}m${activity.required ? "" : " · Optional"}</span>
      </button>
      <span class="st-sr">${escapeHtml(note)}</span>
    </li>`;
}

const MATH_DEPTHS = ["intuitive", "applied", "formal"] as const;
type MathDepth = (typeof MATH_DEPTHS)[number];

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  (value !== null && typeof value === "object" ? value as Record<string, unknown> : {});

// The plan's applied math depth for some topics. A topic override wins over the plan default.
function mathDepthFor(curriculum: Record<string, unknown>, topicIds: readonly string[]): string {
  const prefs = asRecord(curriculum["instruction_preferences_applied"]);
  const rawOverrides: unknown = prefs["topic_math_depth_overrides"];
  const overrides = (Array.isArray(rawOverrides) ? rawOverrides : []).map(asRecord);
  const depthOf = (topicId: string | null): unknown => overrides.find((entry) => entry["topic_id"] === topicId)?.["math_depth"] ?? prefs["math_depth"];
  const depths = new Set((topicIds.length > 0 ? topicIds : [null]).map(depthOf).filter((depth): depth is MathDepth => isOneOf(MATH_DEPTHS, depth)));
  return [...depths].map(humanize).join(", ") || "Not stated";
}

const activityGlyph = (activity: StudyActivity, size: number): string => trackOf(activity) === "gate"
  ? statusGlyph("gate", gateStatus(activity.objectiveProficiencyBadges.map((badge) => badge.status)).passed ? "done" : "todo", size)
  : statusGlyph("module", executionTone(activity.executionStatus), size);

// The statuses a learner can set from the drawer. Done records a self-reported completion.
const SETTABLE_STATUSES = ["not_started", "in_progress", "completed"] as const;
type SettableStatus = (typeof SETTABLE_STATUSES)[number];
const STATUS_LABELS: Readonly<Record<SettableStatus, string>> = { not_started: "Not started", in_progress: "In progress", completed: "Done" };

type SourceCardView = StudyActivity["resourceProvenanceCards"][number];

// Where a resource lives, as a learner reads it. A synthetic .invalid host shows only its path.
function displayLocation(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  return hostname.endsWith(".invalid") ? path.replace(/^\/+/, "") || "catalog" : `${hostname.replace(/^www\./, "")}${path}`;
}

const rawListOf = (record: Readonly<Record<string, unknown>>, key: string): readonly Readonly<Record<string, unknown>>[] => {
  const list: unknown = record[key];
  return (Array.isArray(list) ? list : []).map(asRecord);
};

// The plan model keeps one prompt per activity, so a lab's deliverables and a gate's assessment come from the raw curriculum.
const rawContentOf = (curriculum: Record<string, unknown>, activityId: string): Readonly<Record<string, unknown>> =>
  asRecord(rawListOf(curriculum, "activities").find((entry) => entry["activity_id"] === activityId)?.["content"]);

const rubricOf = (curriculum: Record<string, unknown>, activityId: string): SelfCheckRubric | null => {
  const ref = rawContentOf(curriculum, activityId)["assessment_ref"];
  return typeof ref === "string" ? SELF_CHECK_RUBRICS[ref] ?? null : null;
};

const activityIdsOf = (curriculum: Record<string, unknown>): ReadonlySet<string> =>
  new Set(rawListOf(curriculum, "activities").map((entry) => entry["activity_id"]).filter((id): id is string => typeof id === "string"));

const goalTitleOf = (curriculum: Record<string, unknown>): string =>
  renderUntrustedCatalogText(asRecord(curriculum["goal"])["title"], { maxLength: 200 }).text || "Untitled plan";

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

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

// The public projection of a plan: goal title and summary, objectives, prerequisite edges, and units.
// It carries no progress, evidence, account, schedule, or billing data (@S57).
function publicProjectionOf(curriculum: Record<string, unknown>): PublicCurriculumContentBlock {
  const edges = rawListOf(curriculum, "prerequisite_edges")
    .map((edge) => ({ from_objective_id: textOf(edge["from_objective_id"]), to_objective_id: textOf(edge["to_objective_id"]) }));
  return {
    title: goalTitleOf(curriculum),
    summary: renderUntrustedCatalogText(asRecord(curriculum["goal"])["summary"], { maxLength: 600 }).text,
    objectives: rawListOf(curriculum, "objectives").map((objective) => ({
      objective_id: textOf(objective["objective_id"]), title: textOf(objective["title"]),
      prerequisite_objective_ids: edges.filter((edge) => edge.to_objective_id === objective["objective_id"]).map((edge) => edge.from_objective_id),
    })),
    prerequisite_edges: edges,
    modules: rawListOf(curriculum, "modules").map((mod) => ({
      module_id: textOf(mod["module_id"]), title: textOf(mod["title"]), summary: textOf(mod["summary"]),
      objective_ids: normalizeStringList(mod["objective_ids"]), activity_ids: normalizeStringList(mod["activity_ids"]),
      prerequisite_module_ids: normalizeStringList(mod["prerequisite_module_ids"]),
    })),
  };
}

// The units an adoption takes: the requested ones plus every unit they need, directly or transitively.
// An empty request means the full curriculum.
const adoptionScopeOf = (listing: MarketplaceListing, requested: readonly string[]) => resolveTransitiveAdoptionScope({
  schema_version: "0.2.0", publication_id: listing.publicationId, publication_revision_id: listing.revisionId, revision_number: 1,
  published_at: listing.publishedAt, content_sha256: "", content: publicProjectionOf(listing.curriculum),
  publisher: { public_author_id: listing.handle, display_name: listing.handle },
  publication_terms: {
    policy_id: "publication-terms-v1", content_license_id: "CC-BY-4.0", rights_scope: "structure_and_author_prompts_only",
    attribution: listing.handle, third_party_materials_excluded: true,
  },
}, requested);

// The adopter's private copy of a listing's plan, cut to the adopted units. It stays a draft until the adopter activates it.
function adoptedPlanOf(listing: MarketplaceListing, adoption: Adoption): ActiveCurriculum {
  const curriculumId = `adopted-${listing.publicationId}`;
  const modules = rawListOf(listing.curriculum, "modules").filter((mod) => adoption.moduleIds.includes(textOf(mod["module_id"])));
  const activityIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["activity_ids"])));
  const objectiveIds = new Set(modules.flatMap((mod) => normalizeStringList(mod["objective_ids"])));
  const revisionId = `${curriculumId}-draft-1`;
  const sessions = rawListOf(listing.schedule, "sessions")
    .map((session) => ({ ...session, activity_ids: normalizeStringList(session["activity_ids"]).filter((id) => activityIds.has(id)) }))
    .filter((session) => session.activity_ids.length > 0);
  return {
    curriculumId, domain: listing.subject, assessmentMode: listing.gateStyle, publicationId: listing.publicationId, draft: !adoption.active,
    curriculum: {
      ...listing.curriculum, curriculum_id: curriculumId, revision_id: revisionId, revision_number: 1, account_id: adoption.accountId,
      predecessor_revision_id: null, revision_reason: "adoption", modules,
      activities: rawListOf(listing.curriculum, "activities").filter((act) => activityIds.has(textOf(act["activity_id"]))),
      // The author's evidence never travels with a copy (@S59).
      objectives: rawListOf(listing.curriculum, "objectives").filter((objective) => objectiveIds.has(textOf(objective["objective_id"])))
        .map((objective) => ({ ...objective, prior_evidence_refs: [] })),
      prerequisite_edges: rawListOf(listing.curriculum, "prerequisite_edges")
        .filter((edge) => objectiveIds.has(textOf(edge["from_objective_id"])) && objectiveIds.has(textOf(edge["to_objective_id"]))),
    },
    schedule: { ...listing.schedule, curriculum_revision_id: revisionId, sessions },
  };
}

// An account's plans: the base plans, then its own adopted copies.
// ponytail: every demo persona loads the same base plans. Per-account plans need a real account store.
const plansFor = (accountId: string, adoptions: readonly Adoption[], listings: readonly MarketplaceListing[]): readonly ActiveCurriculum[] => [
  ...ACTIVE_CURRICULA,
  ...adoptions.filter((adoption) => adoption.accountId === accountId).flatMap((adoption) => {
    const listing = listings.find((entry) => entry.publicationId === adoption.publicationId);
    return listing ? [adoptedPlanOf(listing, adoption)] : [];
  }),
];

interface InspectorInput {
  readonly modules: readonly StudyModule[];
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly open: boolean;
  readonly rigor: string;
  readonly deliverables: readonly string[];
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly rubric: SelfCheckRubric | null;
  readonly skipRecorded: boolean;
}

// Drawer: the status control, then any earlier step not yet done, the material, and what the step builds.
// A coding lab adds its brief, specs, and checklist. A step checked by a self-check rubric shows the rubric first.
// The footer offers Done, or the next step once done.
function renderInspector({ modules, mod, activity, open, rigor, deliverables, catalogResources, rubric, skipRecorded }: InspectorInput): string {
  const id = escapeHtml(activity.activityId);
  const track = trackOf(activity);
  const isGate = track === "gate";
  const isLab = activity.type === "coding" || activity.type === "project";
  const unitNumber = modules.indexOf(mod) + 1;
  const tone = executionTone(activity.executionStatus);
  const status: SettableStatus = tone === "done" ? "completed" : tone === "doing" ? "in_progress" : "not_started";
  // Previous and next follow the plan's order, which keeps every prerequisite before its dependents.
  const steps = modules.flatMap((unit) => unit.activities);
  const at = steps.findIndex((step) => step.activityId === activity.activityId);
  const prev = steps[at - 1];
  const next = steps[at + 1];
  const target = (step: StudyActivity): string =>
    `data-action="select-outline-activity" data-activity-id="${escapeHtml(step.activityId)}" data-module-id="${escapeHtml(step.moduleId)}"`;

  const statusControl = `<div class="segmented status-control" role="group" aria-label="Activity status">${SETTABLE_STATUSES.map((choice) =>
    `<button type="button" class="seg-btn${choice === "completed" && status === "completed" ? " status-celebration" : ""}" data-action="set-activity-status" data-activity-id="${id}" data-status="${choice}" aria-pressed="${choice === status}">${STATUS_LABELS[choice]}</button>`).join("")}</div>`;
  const proficiency = isGate
    ? `<span class="proficiency-pill" data-proficiency-status="${escapeHtml(activity.objectiveProficiencyStatus)}">${statusGlyph("gate", activity.objectiveProficiencyStatus === "demonstrated" ? "done" : "todo", 16)}<span><span class="st-sr">Objective proficiency: </span>${escapeHtml(humanize(activity.objectiveProficiencyStatus))}</span></span>`
    : "";

  const stepNav = prev || next ? `<nav class="mobile-step-nav" aria-label="Previous and next step">
        ${prev ? `<button type="button" class="btn-secondary step-nav-btn" ${target(prev)}><span aria-hidden="true">←</span><span class="step-nav-text">Prev: ${escapeHtml(prev.title)}</span></button>` : ""}
        ${next ? `<button type="button" class="btn-secondary step-nav-btn step-nav-next" ${target(next)}><span class="step-nav-text">Next: ${escapeHtml(next.title)}</span><span aria-hidden="true">→</span></button>` : ""}
      </nav>` : "";

  // Earlier steps the learner has not done yet. A mastery gate requires them. Other steps recommend them.
  const unmet = activity.prerequisiteActivityIds.flatMap((prereqId) => steps.find((step) => step.activityId === prereqId) ?? [])
    .filter((step) => !isClosed(step.executionStatus));
  const firstSteps = unmet.length === 0 ? "" : `<div class="first-steps">
        <p class="first-steps-label">${activity.prerequisiteBridgeRecommendation?.blocking ? "Required first:" : "Recommended first:"}</p>
        ${unmet.map((step) => `<button type="button" class="first-step" ${target(step)}>${activityGlyph(step, 16)}<span>${escapeHtml(step.title)}</span><span aria-hidden="true">→</span></button>`).join("")}
      </div>`;

  const sourceCard = (card: SourceCardView, index: number): string => {
    const segments = catalogResources[card.resourceVersionId]?.segments ?? [];
    const sections = card.verifiedSegments.flatMap((segmentId) => segments.find((segment) => segment.segment_id === segmentId)?.title ?? [])
      .map((section) => renderUntrustedCatalogText(section, { maxLength: 300 }).text);
    const tags = [
      humanize(card.accessModel),
      card.rightsBadge.externalLinkOnly ? "External link" : humanize(card.rightsBadge.basis),
      ...(card.optionalCertificationBadge ? [`Optional certificate ${formatMinorCurrency(4900, "USD")}`] : []),
    ];
    const url = card.canonicalUrl;
    return `<section class="source-card" data-resource-version-id="${escapeHtml(card.resourceVersionId)}" aria-labelledby="${INSPECTOR_ID}-source-${index}">
        <h3 id="${INSPECTOR_ID}-source-${index}" class="source-title">${escapeHtml(card.title)}</h3>
        <p class="source-publisher">${escapeHtml(card.verifiedPublisher)}</p>
        ${url ? `<p class="source-location">${sfIcon("resources", 15)}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayLocation(url))}</a></p>` : ""}
        ${sections.map((section) => `<p class="source-section">${escapeHtml(section)}</p>`).join("")}
        <ul class="source-tags">${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>
        ${url ? `<a class="btn-primary source-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${isLab ? "Open Lab Specification" : "Open Study Material"}<span aria-hidden="true">↗</span><span class="st-sr"> in a new tab</span></a>` : ""}
      </section>`;
  };

  const objectives = new Map(modules.flatMap((unit) => unit.objectives).map((objective) => [objective.objectiveId, objective]));
  const mine = activity.objectiveIds.flatMap((objectiveId) => objectives.get(objectiveId) ?? []);
  const focus = `<section class="inspector-section conceptual-focus" aria-labelledby="${INSPECTOR_ID}-focus">
        <h3 id="${INSPECTOR_ID}-focus">${isGate ? "What this checks" : "What this builds"}</h3>
        <ul class="focus-list">${mine.map((objective) => `<li>${escapeHtml(objective.title)}</li>`).join("") || "<li>No objective is mapped to this activity.</li>"}</ul>
        ${isGate || postGateIds(mod).has(activity.activityId) ? "" : `<p class="focus-next">${statusGlyph("gate", unitGate(mod).passed ? "done" : "todo", 16)}<span>Prepares for: Unit ${unitNumber} Gate</span></p>`}
      </section>`;

  const metaRow = (icon: SfIconName, key: string, value: string): string =>
    `<tr><th scope="row"><span class="meta-key">${sfIcon(icon)}${key}</span></th><td>${value}</td></tr>`;
  const details = `<table class="meta-table">
        <caption class="st-sr">Activity details</caption>
        <tbody>
          ${metaRow("clock", "Duration", effortWords(activity.durationTriplet))}
          ${metaRow("rigor", "Rigor", escapeHtml(rigor))}
          ${metaRow("pin", "Type", activity.required ? "Required" : "Optional")}
        </tbody>
      </table>`;
  // Coding and project work runs outside the app (execution_mode "external"), in the learner's own IDE.
  const specs: readonly (readonly [SfIconName, string])[] = [
    ["clock", effortWords(activity.durationTriplet)], ["rigor", rigor], ["pin", activity.required ? "Required" : "Optional"], ["code", "Local or external IDE"],
  ];
  const lab = `<section class="inspector-section lab-brief" aria-labelledby="${INSPECTOR_ID}-brief">
        <h3 id="${INSPECTOR_ID}-brief">Deliverable brief</h3>
        <p>${escapeHtml(activity.promptSummary)}</p>
        ${deliverables.length > 0 ? `<ul class="lab-deliverables">${deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </section>
      <section class="inspector-section" aria-labelledby="${INSPECTOR_ID}-specs">
        <h3 id="${INSPECTOR_ID}-specs">Environment and lab specs</h3>
        <ul class="spec-chips">${specs.map(([icon, text]) => `<li>${sfIcon(icon, 15)}<span>${escapeHtml(text)}</span></li>`).join("")}</ul>
      </section>
      <section class="inspector-section" aria-labelledby="${INSPECTOR_ID}-checks">
        <h3 id="${INSPECTOR_ID}-checks">Verification checklist</h3>
        <ul class="lab-checklist">${mine.filter((objective) => objective.successCriterion).map((objective) => `<li>${statusGlyph("module", "todo", 16)}<span>${escapeHtml(objective.successCriterion)}</span></li>`).join("") || "<li>No acceptance criteria are stated.</li>"}</ul>
      </section>`;

  const rubricBlock = rubric ? `<section class="inspector-section rubric-block" aria-labelledby="${INSPECTOR_ID}-rubric">
        <h3 id="${INSPECTOR_ID}-rubric">Synthesis &amp; Self-Check Rubric</h3>
        <p class="rubric-mode">Self-Evaluated Rubric · No public quiz bank for this topic</p>
        <p class="rubric-label">Guiding synthesis prompt</p>
        <p class="rubric-prompt">${escapeHtml(rubric.prompt)}</p>
        <p class="rubric-label">Check your synthesis against each criterion before you mark this Done</p>
        <ul class="lab-checklist">${rubric.criteria.map((criterion) => `<li>${statusGlyph("module", "todo", 16)}<span>${escapeHtml(criterion)}</span></li>`).join("")}</ul>
        <p class="meta-text">Your self-check does not change the objective's proficiency status.</p>
      </section>` : "";

  const primary = status !== "completed"
    ? `<button type="button" class="btn-primary" data-action="complete-activity" data-activity-id="${id}" data-module-id="${escapeHtml(activity.moduleId)}" data-event-id="evt-complete-${id}">Mark as Done<span aria-hidden="true">✓</span></button>`
    : next ? `<button type="button" class="btn-primary next-step" ${target(next)}><span class="next-step-text">Go to next step: ${escapeHtml(next.title)}</span><span aria-hidden="true">→</span></button>` : "";

  return `<dialog id="${INSPECTOR_ID}" class="inspector" closedby="any" aria-labelledby="${INSPECTOR_ID}-title" data-open="${open}" data-activity-id="${id}" data-opaque-surface="true">
    <header class="inspector-head">
      <p class="inspector-context">Unit ${unitNumber} · ${TRACK_LABELS[track].badge}</p>
      <h2 id="${INSPECTOR_ID}-title" tabindex="-1" autofocus>${escapeHtml(activity.title)}</h2>
      <button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">${sfIcon("close")}</button>
      <div class="inspector-pills">${statusControl}${proficiency}</div>
    </header>
    <div class="inspector-scroll" data-scroll-region>
      ${stepNav}
      ${firstSteps}
      ${rubricBlock}
      ${isLab ? lab : ""}
      ${activity.resourceProvenanceCards.map(sourceCard).join("")}
      ${focus}
      ${isLab ? "" : details}
      ${skipRecorded ? `<p class="prose" role="status">${escapeHtml(`Skip recorded for ${activity.title} only. Prerequisite evidence was not created.`)}</p>` : ""}
    </div>
    <div class="inspector-actions">
      ${primary}
      <button type="button" class="btn-secondary" data-action="skip-activity" data-activity-id="${id}">Skip this activity</button>
    </div>
  </dialog>`;
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
  const upvotesOf = (listing: MarketplaceListing): number => listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const rigorOf = (listing: MarketplaceListing): string => mathDepthFor(listing.curriculum, []);
  const rank = (listing: MarketplaceListing): number => (marketplaceSort === "top_upvoted" ? upvotesOf(listing)
    : marketplaceSort === "most_adopted" ? adoptionsOf(listing) : Date.parse(listing.publishedAt));
  const queryText = marketplaceQuery.toLowerCase();
  const shownListings = listings
    .filter((listing) => marketplaceDomain === "All" || FILTER_DOMAIN_OF[listing.subject] === marketplaceDomain)
    .filter((listing) => marketplaceRigor === "All" || rigorOf(listing) === marketplaceRigor)
    .filter((listing) => !queryText || [goalTitleOf(listing.curriculum), publicProjectionOf(listing.curriculum).summary, listing.handle, listing.subject]
      .join(" ").toLowerCase().includes(queryText))
    .sort((a, b) => rank(b) - rank(a) || goalTitleOf(a.curriculum).localeCompare(goalTitleOf(b.curriculum)));
  const pills = (listing: MarketplaceListing): string =>
    `<p class="marketplace-pills"><span class="domain-pill">${escapeHtml(`${listing.subject} · ${listing.gateStyle}`)}</span><span class="rigor-badge">${escapeHtml(rigorOf(listing))}</span><span class="price-badge">Free · $0.00 adopt</span></p>`;
  const outlineOf = (listing: MarketplaceListing) =>
    buildPlanMapAndOutlineModel({ curriculum: listing.curriculum, proficiency, activityStates: {}, catalogResources }).outlineModules;

  const listingCard = (listing: MarketplaceListing): string => {
    const id = escapeHtml(listing.publicationId);
    const projection = publicProjectionOf(listing.curriculum);
    const yours = !signedOut && listing.ownerAccountId === account.accountId;
    const myPlan = myPlans.find((plan) => plan.publicationId === listing.publicationId || plan.curriculumId === listing.sourceCurriculumId);
    const voted = !signedOut && votes.some((vote) => vote.revisionId === listing.revisionId && vote.accountId === account.accountId);
    const units = projection.modules.length;
    return `<article class="marketplace-card public-template-card" data-publication-id="${id}" data-revision-id="${escapeHtml(listing.revisionId)}" aria-labelledby="listing-${id}-title" data-opaque-surface="true">
            ${pills(listing)}
            <h2 id="listing-${id}-title" class="marketplace-title">${escapeHtml(projection.title)}</h2>
            <p class="marketplace-summary">${escapeHtml(projection.summary)}</p>
            <p class="marketplace-meta">${escapeHtml(listing.handle)}${listing.basedOn ? ` · based on ${escapeHtml(listing.basedOn)}` : ""} · ${units} unit${units === 1 ? "" : "s"} · ${adoptionsOf(listing)} adopted</p>
            <details class="flow-preview"><summary>Inspect Study Flow</summary><ol>${outlineOf(listing).map((mod, index) =>
              `<li><span class="flow-preview-unit">U${index + 1} · ${escapeHtml(displayUnitTitle(mod.title))}</span><span class="meta-text">${mod.activities.length} activities · ${effortWords(mod.durationTriplet)}</span></li>`).join("")}</ol></details>
            <div class="marketplace-actions">
              <button type="button" class="btn-secondary upvote-btn" data-action="toggle-upvote" data-publication-id="${id}" data-revision-id="${escapeHtml(listing.revisionId)}" aria-pressed="${voted}">▲ Upvote Revision (${upvotesOf(listing)})</button>
              ${yours || myPlan
                ? `<span class="owned-badge">${yours ? "Yours" : "In your plans"}</span>${myPlan ? `<button type="button" class="btn-secondary" data-action="open-curriculum-plan" data-curriculum-id="${escapeHtml(myPlan.curriculumId)}">Open Plan<span aria-hidden="true">→</span></button>` : ""}`
                : `<button type="button" class="btn-primary" data-action="open-adopt-dialog" data-publication-id="${id}">Preview &amp; Adopt<span aria-hidden="true">→</span></button>`}
            </div>
          </article>`;
  };
  const filterGroup = (label: string, action: string, key: string, options: readonly (readonly [string, string])[], current: string): string =>
    `<div class="segmented" role="group" aria-label="${label}">${options.map(([value, text]) => `<button type="button" class="seg-btn" data-action="${action}" data-${key}="${escapeHtml(value)}" aria-pressed="${value === current}">${escapeHtml(text)}</button>`).join("")}</div>`;
  const ownedListings = signedOut ? [] : listings.filter((listing) => listing.ownerAccountId === account.accountId);
  const myPublicationsHtml = signedOut ? "" : `<section class="surface-panel my-publications" data-opaque-surface="true">
          <h2>My Publications</h2>
          <p class="meta-text">Owner records load fresh on every visit and are never cached.</p>
          ${ownedListings.length > 0 ? `<ul class="publication-list">${ownedListings.map((listing) => `<li data-publication-id="${escapeHtml(listing.publicationId)}"><strong>${escapeHtml(goalTitleOf(listing.curriculum))}</strong><span class="meta-text">Public · Revision 1 · ${upvotesOf(listing)} upvotes · ${adoptionsOf(listing)} adopted</span></li>`).join("")}</ul>
          <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies. Historical votes are not transferred.</p>
          <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-unpublish">Unpublish</button>`
            : `<p class="empty-state">${sfIcon("resources")}<span>You have not published a curriculum yet.</span></p>`}
        </section>`;

  // Adoption preview: the chosen units, the units they need, and the effort each one takes.
  const adoptListing = listings.find((listing) => listing.publicationId === inputState.adoptPublicationId) ?? null;
  const adoptScope = inputState.adoptScope ?? "full";
  const adoptBody = (() => {
    if (!adoptListing) return `<p class="meta-text">Choose a curriculum in Explore to preview it.</p>`;
    const projection = publicProjectionOf(adoptListing.curriculum);
    const requested = adoptScope === "full" ? [] : inputState.adoptModuleIds ?? [];
    const scope = adoptScope === "units" && requested.length === 0 ? null : adoptionScopeOf(adoptListing, requested);
    const included = new Set(scope?.resolvedModuleIds ?? []);
    const autoIncluded = new Set(scope?.autoIncludedPrerequisiteModuleIds ?? []);
    const outline = outlineOf(adoptListing);
    const unitNumber = new Map(projection.modules.map((mod, index) => [mod.module_id, index + 1]));
    const rows = projection.modules.map((mod, index) => {
      const unit = outline.find((entry) => entry.moduleId === mod.module_id);
      const needs = (mod.prerequisite_module_ids ?? []).map((moduleId) => `U${unitNumber.get(moduleId) ?? "?"}`).join(", ");
      const body = `${statusGlyph("module", included.has(mod.module_id) ? "done" : "todo", 16)}<span class="adopt-unit-text"><span class="adopt-unit-title">U${index + 1} · ${escapeHtml(displayUnitTitle(mod.title))}</span><span class="adopt-unit-meta">${unit ? `${unit.activities.length} activities · ${effortWords(unit.durationTriplet)}` : ""}${needs ? ` · Requires ${needs}` : ""}</span>${autoIncluded.has(mod.module_id) ? `<span class="auto-badge">Auto-included prerequisite</span>` : ""}</span>`;
      return adoptScope === "units"
        ? `<li><button type="button" class="adopt-unit" role="checkbox" aria-checked="${included.has(mod.module_id)}" data-action="toggle-adopt-module" data-module-id="${escapeHtml(mod.module_id)}">${body}</button></li>`
        : `<li><div class="adopt-unit">${body}</div></li>`;
    }).join("");
    const chosen = outline.filter((mod) => included.has(mod.moduleId));
    const total = { min: 0, point: 0, max: 0 };
    for (const mod of chosen) {
      total.min += mod.durationTriplet.min;
      total.point += mod.durationTriplet.point;
      total.max += mod.durationTriplet.max;
    }
    return `${pills(adoptListing)}
      <h3 class="adopt-title">${escapeHtml(projection.title)}</h3>
      <p class="meta-text">${escapeHtml(adoptListing.handle)} · ${projection.modules.length} units · ${adoptionsOf(adoptListing)} adopted · CC BY 4.0</p>
      <div class="segmented adopt-scope" role="group" aria-label="What to adopt">
        <button type="button" class="seg-btn" data-action="set-adopt-scope" data-scope="full" aria-pressed="${adoptScope === "full"}">Full curriculum</button>
        <button type="button" class="seg-btn" data-action="set-adopt-scope" data-scope="units" aria-pressed="${adoptScope === "units"}">Select units</button>
      </div>
      <ul class="adopt-units">${rows}</ul>
      <p class="adopt-total">${scope ? `${included.size} of ${projection.modules.length} units · ${effortWords(total)}` : "Select at least one unit."}</p>
      <p class="prose meta-text">Adoption creates your private draft. It copies none of the author's progress, evidence, votes, keys, or spending authority, and it costs $0.00. You review the draft on the Plan page and activate it there.</p>
      <div class="action-row"><button type="button" class="btn-primary" data-action="confirm-adopt-curriculum" data-publication-id="${escapeHtml(adoptListing.publicationId)}"${scope ? "" : " disabled"}>Adopt into My Plans<span aria-hidden="true">→</span></button></div>`;
  })();

  // Publication preview: exactly the public projection of the selected plan, and what publishing removes (@S56, @S57).
  const publishedFromHere = listings.some((listing) => listing.ownerAccountId === account.accountId && listing.sourceCurriculumId === selectedPlan.curriculumId);
  const originListing = listings.find((listing) => listing.publicationId === selectedPlan.publicationId && listing.ownerAccountId !== account.accountId);
  const publicProjection = publicProjectionOf(curriculum);
  const returnTo = inputState.returnTo ?? null;
  const authNotice = inputState.authNotice ?? null;
  const accountClusterHtml = authStatus === "authenticated"
    ? `<span class="account-pill"><span class="account-email">${escapeHtml(account.email)}</span><span class="role-pill">${account.role}</span></span>
      <button type="button" class="btn-secondary header-btn" data-action="open-dialog" data-dialog-id="dialog-auth">Account / Switch</button>
      <button type="button" class="btn-secondary header-btn" data-action="sign-out">Sign out</button>`
    : `<span class="account-pill" data-auth-status="${authStatus}">${signedOut ? "Guest · Exploring" : "Session expired"}</span>
      <button type="button" class="btn-primary header-btn" data-action="open-dialog" data-dialog-id="dialog-auth">Sign in</button>`;

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
  const stepRow = (activityId: string, note: string, extraAttrs = ""): string => {
    const activity = outlineById.get(activityId);
    return activity ? renderStepRow(activity, selectedActivityId, note, extraAttrs) : "";
  };

  const reviewRows = todayState.todayCards.flatMap((card) => card.activityBreakdown.filter((act) => act.type === "review").map((act) =>
    stepRow(act.activityId, `Scheduled ${shortSessionLabel(card.startAt)}. ${card.reviewSeparation.separationSummary} ${act.scheduledReason}`, ` data-review-separation-valid="${card.reviewSeparation.valid}"`),
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
    `<svg class="legend-swatch" viewBox="0 0 64 20" width="64" height="20" aria-hidden="true" data-tone="${tone}" data-style="${style}"><line x1="2" y1="10" x2="58" y2="10" /><path d="M52 5 58 10 52 15" /></svg>`;
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
  <header class="app-header nav-chrome-glass" role="banner">
    <div class="brand-cluster"><span class="brand-title">Curriculum.io</span></div>
    <nav class="top-level-nav" aria-label="Primary navigation">${topNavHtml}</nav>
    <div class="header-status">
      ${signedOut ? "" : `<span class="duration-pill" data-study-minutes="${studyMinutes}">Study minutes ${studyMinutes}</span>
      <span class="duration-pill" data-self-reported-count="${selfReportedCount}">Self-reported ${selfReportedCount}</span>`}
      ${accountClusterHtml}
    </div>
  </header>
  ${authStatus === "session_expired" ? `<div class="session-banner" role="status"><p><strong>Session expired.</strong> Sign in to resume where you left off.</p><button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-auth">Sign in</button></div>` : ""}
  <div class="app-body-grid">
    <aside class="app-sidebar" aria-label="Learn sections">
      ${signedOut ? `<div class="sidebar-section"><p class="meta-text">Sign in to see your plans.</p></div>` : `<div class="sidebar-section"><nav class="learn-sub-nav" aria-label="Learn sub-navigation">${learnSubNavHtml}</nav></div>
      <div class="sidebar-section sidebar-goal"><p class="meta-text">${escapeHtml(basePlanModel.goal.title)}</p><p class="meta-text">About ${totalEffort.point} min planned (${totalEffort.min}–${totalEffort.max})</p></div>`}
    </aside>
    <main id="main-workspace" class="app-main-workspace" role="main" tabindex="-1">
      ${signedOut ? "" : `      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${isLearn}"${isLearn ? "" : " hidden"}>
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${isLearn && activeLearnSub === "Today"}"${isLearn && activeLearnSub === "Today" ? "" : " hidden"}>
          <header class="today-unified-header" data-opaque-surface="true">
            <div class="section-header">
              <h1 class="page-title">Today</h1>
              <div class="plan-toolbar">
                <label class="field field-inline" for="selected-plan-control"><span>Selected plan</span>
                  <select id="selected-plan-control" name="selected-plan" data-action="select-curriculum">${planOptionsHtml}</select>
                </label>
                <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-new-curriculum">New Curriculum</button>
              </div>
            </div>
            ${recoveryBanner}
            ${nextUpRowHtml}
          </header>
          <section class="today-curricula-grid" aria-label="Active curricula">
          ${queueCardsHtml}
          </section>
          ${todayBoardHtml}
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

      <section class="top-level-panel" id="panel-explore" data-top-panel="Explore" data-active="${activeTopLevel === "Explore"}"${activeTopLevel === "Explore" ? "" : " hidden"}>
        <div class="section-header">
          <h1 class="page-title">Explore</h1>
          <div class="plan-toolbar"><button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share to Marketplace</button></div>
        </div>
        <form class="marketplace-search" role="search" data-action="set-marketplace-query">
          <label class="st-sr" for="marketplace-search">Search the Marketplace</label>
          <input id="marketplace-search" type="search" name="query" value="${escapeHtml(marketplaceQuery)}" placeholder="Search titles, curators, and subjects" autocomplete="off">
          <button type="submit" class="btn-secondary">Search</button>
        </form>
        <div class="marketplace-controls">
          ${filterGroup("Domain", "set-marketplace-domain", "domain", MARKETPLACE_DOMAINS.map((domain) => [domain, domain] as const), marketplaceDomain)}
          ${filterGroup("Rigor", "set-marketplace-rigor", "rigor", MARKETPLACE_RIGORS.map((rigor) => [rigor, rigor === "All" ? "Any rigor" : rigor] as const), marketplaceRigor)}
          ${filterGroup("Sort", "set-marketplace-sort", "sort", MARKETPLACE_SORTS.map((sort) => [sort, SORT_LABELS[sort]] as const), marketplaceSort)}
        </div>
        <p class="marketplace-count" role="status">${shownListings.length} curricul${shownListings.length === 1 ? "um" : "a"}. Community publications have not automatically passed educational review.</p>
        ${shownListings.length > 0
          ? `<div class="marketplace-grid">${shownListings.map(listingCard).join("")}</div>`
          : `<p class="empty-state">${sfIcon("explore")}<span>No curricula match these filters.</span></p>`}
        <div class="action-row load-more-row"><button type="button" class="btn-secondary" data-action="load-more">Load more</button></div>
        ${loadMoreNote ? `<p class="prose" role="status">${escapeHtml(loadMoreNote)}</p>` : ""}
        ${myPublicationsHtml}
      </section>
      </section>

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
  <nav class="compact-bottom-nav nav-chrome-glass" aria-label="Compact mobile navigation">${bottomNavHtml}</nav>

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

  <dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title"${dialogOpen("dialog-partial-adoption")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-partial-adoption-title">Preview &amp; Adopt</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      ${adoptBody}
    </form>
  </dialog>

  <dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title"${dialogOpen("dialog-publication-preview")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-publication-preview-title">Share to Marketplace</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      <p class="meta-text">This preview is exactly what becomes public.</p>
      <section class="publish-preview" aria-labelledby="publish-preview-title">
        <h3 id="publish-preview-title">${escapeHtml(publicProjection.title)}</h3>
        <p class="prose">${escapeHtml(publicProjection.summary)}</p>
        <p class="meta-text">${escapeHtml(handleOf(account))} · ${publicProjection.modules.length} units · ${escapeHtml(`${selectedPlan.domain} · ${selectedPlan.assessmentMode}`)} · CC BY 4.0</p>
        <ol class="publish-units">${publicProjection.modules.map((mod) => `<li>${escapeHtml(displayUnitTitle(mod.title))}</li>`).join("")}</ol>
      </section>
      <section aria-labelledby="publish-private-title">
        <h3 id="publish-private-title">Removed before publishing</h3>
        <ul class="lab-checklist privacy-checklist">${PRIVATE_FIELDS_REMOVED.map((item) => `<li>${statusGlyph("module", "done", 16)}<span>${item}</span></li>`).join("")}</ul>
      </section>
      <p class="prose meta-text">Visibility: Public. The listing appears in Explore, and anyone can read it. Linked materials stay links, and their content is not relicensed.</p>
      ${originListing ? `<p class="prose meta-text">Based on ${escapeHtml(originListing.handle)}'s template. Their attribution stays on your listing.</p>` : ""}
      ${publishedFromHere
        ? `<p class="prose" role="status">This plan is already in the Marketplace as revision 1.</p>`
        : `<div class="action-row"><button type="button" class="btn-primary" data-action="confirm-publish-curriculum">Publish to Marketplace<span aria-hidden="true">→</span></button></div>`}
    </form>
  </dialog>

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

  <dialog id="dialog-auth" closedby="any" aria-labelledby="dialog-auth-title"${dialogOpen("dialog-auth")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface auth-surface" data-action="submit-sign-in">
      <header class="dialog-header"><h2 id="dialog-auth-title">${authStatus === "authenticated" ? "Account" : "Sign in"}</h2><button type="submit" class="btn-secondary" data-action="close-dialog">Close</button></header>
      ${returnTo ? `<p class="auth-return" role="status">After you sign in, you return to <strong>${escapeHtml(returnTo.label)}</strong>. Nothing is voted, published, adopted, or bought on your behalf.</p>` : ""}
      ${authStatus === "session_expired" ? `<p class="prose">Sign in as ${escapeHtml(account.email)} to keep your work. Signing in as another account starts with a clean session.</p>` : ""}
      ${authStatus === "authenticated" ? `<p class="prose">Signed in as <strong>${escapeHtml(account.email)}</strong> · ${account.role}.</p>` : ""}
      <label class="field" for="auth-email-input">Email
        <input id="auth-email-input" type="email" name="email" autocomplete="username webauthn" spellcheck="false" value="${escapeHtml(account.email)}" required>
      </label>
      ${authNotice ? `<p class="field-error" role="alert">${escapeHtml(authNotice)}</p>` : ""}
      <div class="action-row">
        <button type="submit" class="btn-primary">Sign in</button>
        <button type="button" class="btn-secondary" data-action="sign-in-passkey">Sign in with passkey</button>
      </div>
      <p class="meta-text">Local demo: no account provider is connected in this build, so sign-in checks no password.</p>
      <section class="persona-switcher" aria-labelledby="persona-switcher-title">
        <h3 id="persona-switcher-title">Demo personas</h3>
        <div class="persona-grid">
          ${PERSONA_CHOICES.map((persona) => {
            const current = persona === "guest" ? signedOut : !signedOut && account.accountId === PERSONAS[persona].accountId;
            return `<button type="button" class="btn-secondary persona-btn" data-action="switch-persona" data-persona="${persona}" aria-pressed="${current}">${persona === "guest" ? "Guest" : PERSONAS[persona].role}</button>`;
          }).join("")}
          <button type="button" class="btn-secondary persona-btn" data-action="simulate-session-expired"${authStatus === "authenticated" ? "" : " disabled"}>Expire session</button>
        </div>
      </section>
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
