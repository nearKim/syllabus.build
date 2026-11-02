import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  buildPlanMapAndOutlineModel, OBJECTIVE_PROFICIENCY_BADGE_STATUSES,
  renderTextWithLatexHtml, renderUntrustedCatalogText, resolveSurfaceStyle, resolveThemeMode, resolveThemePalette,
  type ActivityExecutionStatus, type CatalogResourceMetadataInput, type MapKeyboardKey,
  type PlanMapAndOutlineModel, type ThemePreference,
} from "@syllabus/ui";
import {
  createNavigationShellController, LEARN_SUB_DESTINATIONS, PLAN_SYNCHRONIZED_VIEWS,
  resolveResponsiveLayout, TOP_LEVEL_DESTINATIONS,
  type LearnSubDestination, type MapNonDraggingControl, type PlanSynchronizedView, type TopLevelDestination,
} from "./navigationShell.ts";
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
import { asRecord, clamp, escapeHtml, normalizeStringList, rawListOf } from "./shared.ts";
import { SfIcon, StatusGlyph, type SegmentStyle, type SfIconName } from "./components/Icons.tsx";
import {
  DEEP_DIVE_MODES, FLOW_ORDERS, SPACED_REVIEW_MODES, TRACK_LABELS, TRACK_OF_TYPE,
  StepRow, StudyFlowBoard, displayUnitTitle, effortWords, executionTone,
  executionWords, fit, humanize, isClosed, isOneOf, plannedFlowOrder, rightsWords, trackOf, unitGate, unitProgress,
  type DeepDiveMode, type FlowOrder, type FlowView, type SpacedReviewMode, type StudyActivity, type StudyModule,
} from "./components/StudyFlowBoard.tsx";
import {
  INSPECTOR_ID, InspectorDrawer, SETTABLE_STATUSES, activitySubtasks, conceptCheckSubtaskId,
  type ConceptCheck, type InspectorMode, type SelfCheckRubric, type SettableStatus,
} from "./components/InspectorDrawer.tsx";
import {
  AppSidebar, CompactBottomNav, HeaderBar, SessionExpiredBanner,
} from "./components/HeaderBar.tsx";
import {
  defaultUsernameOfEmail, initialsOf, usernameOf,
  type Account, type AuthStatus,
} from "./auth.ts";
import {
  AUTH_MODES, AuthDialog, PERSONAS, PERSONA_CHOICES, handleOf,
  type AuthMode, type PersonaChoice, type ReturnDestination,
} from "./components/AuthDialog.tsx";
import {
  AdoptSyllabusDialog, SyllabusTagStrip, ExploreMarketplace, MARKETPLACE_FACETS, MARKETPLACE_SORTS, NO_MARKETPLACE_FILTERS,
  PublicationPreviewDialog, adoptedPlanOf, adoptionScopeOf, syllabusTagsOf, facetValuesOf, goalTitleOf, mathDepthFor,
  studyMinutesOf, unitIdsOf, withMarketplaceFilter,
  type ActiveSyllabus, type Adoption, type SyllabusTagDescriptor, type MarketplaceFilters, type MarketplaceListing,
  type MarketplaceSort, type Vote,
} from "./components/ExploreMarketplace.tsx";
import {
  RESOURCE_CATEGORIES, RESOURCE_SCOPES, ResourcesView,
  type ResourceCategory, type ResourceScope,
} from "./components/ResourcesView.tsx";
import {
  MANUAL_RESOURCE_CATEGORIES, RESOURCE_EDITOR_MODES, ResourceEditorDialog,
  type ResourceEditorMode,
} from "./components/ResourceEditorDialog.tsx";
import {
  analyzeManualResourceDeterministic, applyResourceBindingToSyllabus, buildCatalogMetadataFromDraft,
  formatAccessLabels, inferSubjectFromResourceText, parseFreeFormResourceInput, removeResourceBindingFromSyllabus,
  type AnalyzedManualResourceDraft, type ManualResourceAccessModel, type ManualResourceCategory,
} from "./resourceAnalyzer.ts";
import {
  ADMIN_DISCOVERY_SOURCES, AdminResourcesView, isAdminAccount,
  type AdminDiscoverySource,
} from "./components/AdminResourcesView.tsx";
import catalogResourcesJson from "./data/catalogResources.json" with { type: "json" };
import {
  CHEAP_MODEL_BY_PROVIDER, DEFAULT_SUBJECT_TOPICS, DESIGNATED_AI_MODELS, INTAKE_DEPTH_CHOICES, INTAKE_FIT_MODES, INTAKE_FLOW_CHOICES,
  INTAKE_MATERIALS_CHOICES, INTAKE_SUBJECTS, NewSyllabusDialog, buildIndexedMaterialCandidates,
  evaluateIntakeResourceFit, executeIntakeGenerationPipeline, inferIntakeSubjectFromGoal, resolveDependentTopicToggle,
  type IntakeDepthChoice, type IntakeFitMode, type IntakeFlowChoice, type IntakeMaterialsChoice,
  type IntakePipelineExecutionReceipt, type IntakeSubject,
} from "./components/NewSyllabusDialog.tsx";
import { buildLiveDraftPrompt, type LiveDraftOutcome, type LiveDraftRequest } from "./liveDraft.ts";
import {
  buildDeterministicConceptCheck,
  buildDiagnosticQuestionForObjective,
  type GeneratedConceptCheck,
  type LiveTutorModelRequest,
} from "./liveTutor.ts";
import {
  DeleteSyllabusDialog,
  DiagnosticCheckDialog,
  SYLLABUS_EDIT_MODES,
  SyllabusStructureEditorDialog,
  activityPromptOfRaw,
  applyAcceptedAdaptationToSyllabus,
  buildDynamicAdaptationProposal,
  buildDynamicDiagnosticSession,
  buildEffectiveProficiency,
  moveSyllabusActivity,
  moveSyllabusModule,
  mutateSyllabusMeta,
  removeSyllabusActivity,
  removeSyllabusModule,
  upsertSyllabusActivity,
  upsertSyllabusModule,
  type ProficiencyOverrideEntry,
  type SyllabusEditMode,
} from "./components/SyllabusEditorAndDiagnosticDialogs.tsx";

export interface PasskeySummaryItem {
  readonly id: string;
  readonly name: string;
  readonly credentialDeviceType: "singleDevice" | "multiDevice";
  readonly credentialBackedUp: boolean;
  readonly registeredAt: number;
  readonly lastUsedAt?: number | undefined;
}

export interface SyllabusWebAppStateInput {
  readonly topLevel?: TopLevelDestination; readonly learnSubDestination?: LearnSubDestination;
  readonly planView?: PlanSynchronizedView; readonly selectedModuleId?: string | null;
  readonly selectedActivityId?: string | null; readonly focusedNodeId?: string | null;
  readonly zoom?: number; readonly viewportWidthPx?: number; readonly textScalePercent?: number;
  readonly themePreference?: ThemePreference; readonly solidSurfaces?: boolean; readonly reduceMotion?: boolean;
  readonly activityStates?: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly recordedProgressEvents?: readonly ProgressEventInput[];
  readonly syllabus?: Record<string, unknown>; readonly schedule?: Record<string, unknown>;
  readonly proficiency?: ProficiencyProfileFixture;
  readonly catalogResources?: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly diagnosticSession?: DiagnosticSessionFixture; readonly adaptationProposal?: AdaptationProposalFixture;
  readonly byokMode?: InferenceMode; readonly byokCredentials?: readonly MaskedCredentialRecord[];
  readonly primaryCredentialRef?: string;
  readonly editingCredentialProviderId?: string | null;
  readonly providerModels?: Readonly<Record<string, string>>;
  readonly wallet?: HostedCreditWalletSnapshot; readonly openDialogId?: string | null;
  readonly hintRequested?: boolean; readonly workedSolutionRevealed?: boolean;
  readonly practiceSubmitted?: boolean; readonly practiceChoice?: string | null;
  readonly skippedActivityIds?: readonly string[];
  readonly completedSubtaskIds?: readonly string[];
  readonly remindersEnabled?: boolean; readonly remindersPaused?: boolean; readonly reminderTimezone?: string;
  readonly reminderWeekdayTime?: string; readonly reminderWeekendTime?: string; readonly reminderLeadMinutes?: string;
  readonly keyVisible?: boolean;
  readonly diagnosticControl?: "active" | "paused" | "stopped";
  readonly adaptationChoice?: "pending" | "accept_reviewed" | "keep_current";
  readonly loadMoreNote?: string | null; readonly intakeNote?: string | null;
  readonly keyActionNote?: string | null; readonly snoozeNote?: string | null;
  readonly rescheduleSessionId?: string | null; readonly rescheduleValue?: string | null;
  readonly depthOverrideReset?: boolean; readonly studyDetailOpen?: boolean;
  readonly inspectorMode?: InspectorMode;
  readonly flowOrder?: FlowOrder; readonly deepDive?: DeepDiveMode; readonly spacedReview?: SpacedReviewMode;
  readonly selectedSyllabusId?: string;
  readonly authStatus?: AuthStatus; readonly account?: Account; readonly returnTo?: ReturnDestination | null;
  readonly authNotice?: string | null; readonly profileNotice?: string | null;
  readonly authMode?: AuthMode; readonly authPasswordVisible?: boolean;
  readonly passkeys?: readonly PasskeySummaryItem[]; readonly passkeyNotice?: string | null;
  readonly marketplaceFilters?: Partial<MarketplaceFilters>; readonly marketplaceSort?: MarketplaceSort;
  readonly marketplaceTopicsExpanded?: boolean;
  readonly votes?: readonly Vote[]; readonly adoptions?: readonly Adoption[];
  readonly publishedListings?: readonly MarketplaceListing[];
  readonly unpublishedPublicationIds?: readonly string[];
  readonly unpublishPublicationId?: string | null;
  readonly adoptPublicationId?: string | null; readonly adoptModuleIds?: readonly string[];
  readonly resourceScope?: ResourceScope; readonly resourceCategory?: ResourceCategory;
  readonly adminConsoleOpen?: boolean;
  readonly adminSourceFilter?: AdminDiscoverySource;
  readonly adminCategoryFilter?: ResourceCategory;
  readonly adminSearchQuery?: string;
  readonly adminRemovedResourceIds?: readonly string[];
  readonly adminResourceOverrides?: Readonly<Record<string, Partial<CatalogResourceMetadataInput>>>;
  readonly adminNotice?: string | null;
  readonly intakeGoalTitle?: string; readonly intakeSubject?: IntakeSubject;
  readonly intakeTopics?: readonly string[]; readonly intakeDepth?: IntakeDepthChoice;
  readonly intakeFlow?: IntakeFlowChoice; readonly intakeMaterials?: IntakeMaterialsChoice;
  readonly intakeWeeklyMinutes?: number; readonly intakeFitMode?: IntakeFitMode;
  readonly intakeSelectedResourceIds?: readonly string[]; readonly intakeSkippedResourceIds?: readonly string[];
  readonly generatedPlans?: readonly ActiveSyllabus[];
  readonly syllabusOverrides?: Readonly<Record<string, Record<string, unknown>>>;
  readonly scheduleOverrides?: Readonly<Record<string, Record<string, unknown>>>;
  readonly userLibraryResourceIds?: readonly string[];
  readonly resourceEditorMode?: ResourceEditorMode;
  readonly editingResourceId?: string | null;
  readonly editingResourceSyllabusId?: string | null;
  readonly editingResourceModuleId?: string | null;
  readonly editingResourceActivityId?: string | null;
  readonly resourceRawDraft?: string;
  readonly resourceEditorError?: string | null;
  readonly resourceNotice?: string | null;
  readonly lastPipelineReceipt?: IntakePipelineExecutionReceipt | null;
  readonly dynamicConceptChecks?: Readonly<Record<string, ConceptCheck>>;
  readonly conceptCheckSeed?: number;
  readonly proficiencyOverrides?: Readonly<Record<string, ProficiencyOverrideEntry>>;
  readonly deletedSyllabusIds?: readonly string[];
  readonly diagnosticObjectiveId?: string | null;
  readonly diagnosticChoice?: string | null;
  readonly diagnosticFeedback?: { readonly passed: boolean; readonly message: string } | null;
  readonly syllabusEditMode?: SyllabusEditMode;
  readonly editingSyllabusModuleId?: string | null;
  readonly editingSyllabusActivityId?: string | null;
  readonly syllabusEditorError?: string | null;
  readonly syllabusEditorNotice?: string | null;
  readonly authResetEmail?: string;
  readonly emailVerified?: boolean;
  readonly emailVerificationPending?: boolean;
  readonly billingNotice?: string | null;
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

const DEFAULT_SYNTHETIC_SYLLABUS: Record<string, unknown> = {
  schema_version: "0.2.0", syllabus_id: "syllabus-rag-python-001",
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
  version: 1, syllabus_revision_id: "revision-attention-v2", timezone: "America/New_York", weekly_minutes: 120,
  sessions: [
    { session_id: "session-today-1", start_at: "2026-10-26T18:00:00-04:00", duration_minutes: 65, activity_ids: ["activity-theory", "activity-example", "activity-coding"], reminder_enabled: true },
    { session_id: "session-quiz-2", start_at: "2026-10-28T18:00:00-04:00", duration_minutes: 10, activity_ids: ["activity-quiz"], reminder_enabled: true },
    { session_id: "session-spaced-review-3", start_at: "2026-10-30T18:00:00-04:00", duration_minutes: 23, activity_ids: ["activity-review", "activity-reflection"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

export const DEFAULT_SYNTHETIC_PROFICIENCY: ProficiencyProfileFixture = {
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

export const DEFAULT_CATALOG_RESOURCES: Readonly<Record<string, CatalogResourceMetadataInput>> =
  catalogResourcesJson.resources as Readonly<Record<string, CatalogResourceMetadataInput>>;

const LINEAR_ALGEBRA_SYLLABUS: Record<string, unknown> = {
  schema_version: "0.2.0", syllabus_id: "syllabus-linear-algebra-002",
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
  version: 1, syllabus_revision_id: "revision-linear-algebra-v1", timezone: "America/New_York", weekly_minutes: 150,
  sessions: [
    { session_id: "la-session-1", start_at: "2026-10-27T18:00:00-04:00", duration_minutes: 65, activity_ids: ["la-read-eigen", "la-example-projection", "la-lab-power-iteration"], reminder_enabled: true },
    { session_id: "la-session-2", start_at: "2026-10-29T18:00:00-04:00", duration_minutes: 30, activity_ids: ["la-gate-spectral"], reminder_enabled: true },
    { session_id: "la-session-3", start_at: "2026-11-02T18:00:00-05:00", duration_minutes: 75, activity_ids: ["la-read-svd", "la-example-svd", "la-gate-svd"], reminder_enabled: true },
    { session_id: "la-session-4", start_at: "2026-11-05T18:00:00-05:00", duration_minutes: 10, activity_ids: ["la-review-svd"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

const TOLSTOY_SYLLABUS: Record<string, unknown> = {
  schema_version: "0.2.0", syllabus_id: "syllabus-tolstoy-lit-003",
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
  version: 1, syllabus_revision_id: "revision-tolstoy-v1", timezone: "America/New_York", weekly_minutes: 180,
  sessions: [
    { session_id: "tl-session-1", start_at: "2026-10-27T20:00:00-04:00", duration_minutes: 85, activity_ids: ["tl-read-war-and-peace", "tl-close-austerlitz"], reminder_enabled: true },
    { session_id: "tl-session-2", start_at: "2026-10-30T20:00:00-04:00", duration_minutes: 80, activity_ids: ["tl-read-berlin", "tl-gate-war-and-peace"], reminder_enabled: true },
    { session_id: "tl-session-3", start_at: "2026-11-03T20:00:00-05:00", duration_minutes: 95, activity_ids: ["tl-review-war-and-peace", "tl-read-anna-karenina", "tl-close-obiralovka"], reminder_enabled: true },
    { session_id: "tl-session-4", start_at: "2026-11-06T20:00:00-05:00", duration_minutes: 40, activity_ids: ["tl-gate-anna-karenina"], reminder_enabled: true },
    { session_id: "tl-session-5", start_at: "2026-11-10T20:00:00-05:00", duration_minutes: 10, activity_ids: ["tl-review-anna-karenina"], reminder_enabled: false },
  ],
  generated_at: "2026-10-20T16:00:00Z",
};

function makeActiveSyllabus(
  syllabusId: string,
  syllabus: Record<string, unknown>,
  schedule: Record<string, unknown>,
  publicationId: string | null,
): ActiveSyllabus {
  const tags = syllabusTagsOf(syllabus);
  return {
    syllabusId,
    domain: tags.subject,
    assessmentMode: tags.gateStyle,
    syllabus,
    schedule,
    publicationId,
    draft: false,
  };
}

export const RAG_PLAN: ActiveSyllabus = makeActiveSyllabus(
  "syllabus-rag-python-001",
  DEFAULT_SYNTHETIC_SYLLABUS,
  DEFAULT_SYNTHETIC_SCHEDULE,
  "publication-synthetic-001",
);

// The base plans in queue order. The first one is selected by default.
const ACTIVE_SYLLABI: readonly ActiveSyllabus[] = [
  RAG_PLAN,
  makeActiveSyllabus("syllabus-linear-algebra-002", LINEAR_ALGEBRA_SYLLABUS, LINEAR_ALGEBRA_SCHEDULE, "publication-linear-algebra-001"),
  makeActiveSyllabus("syllabus-tolstoy-lit-003", TOLSTOY_SYLLABUS, TOLSTOY_SCHEDULE, "publication-tolstoy-001"),
];

export const planIn = (plans: readonly ActiveSyllabus[], syllabusId: unknown): ActiveSyllabus =>
  plans.find((plan) => plan.syllabusId === syllabusId) ?? plans[0] ?? RAG_PLAN;

const RUST_ASYNC_SYLLABUS: Record<string, unknown> = {
  schema_version: "0.2.0", syllabus_id: "syllabus-rust-async-004",
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
  version: 1, syllabus_revision_id: "revision-rust-async-v1", timezone: "America/New_York", weekly_minutes: 180,
  sessions: [
    { session_id: "rs-session-1", start_at: "2026-10-28T19:00:00-04:00", duration_minutes: 50, activity_ids: ["rs-read-futures", "rs-example-waker"], reminder_enabled: true },
    { session_id: "rs-session-2", start_at: "2026-10-31T10:00:00-04:00", duration_minutes: 45, activity_ids: ["rs-gate-executor"], reminder_enabled: true },
    { session_id: "rs-session-3", start_at: "2026-11-04T19:00:00-05:00", duration_minutes: 100, activity_ids: ["rs-read-reactor", "rs-example-stealing", "rs-gate-timer"], reminder_enabled: true },
    { session_id: "rs-session-4", start_at: "2026-11-07T10:00:00-05:00", duration_minutes: 10, activity_ids: ["rs-review-pinning"], reminder_enabled: false },
  ],
  generated_at: "2026-10-18T12:00:00Z",
};

const STAT_MECH_SYLLABUS: Record<string, unknown> = {
  schema_version: "0.2.0", syllabus_id: "syllabus-statmech-005",
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
  version: 1, syllabus_revision_id: "revision-statmech-v1", timezone: "America/New_York", weekly_minutes: 150,
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
  const tags = syllabusTagsOf(input.syllabus);
  return {
    ...input,
    subject: tags.subject,
    gateStyle: tags.gateStyle,
    topicTags: tags.topicTags,
  };
}

export const MARKETPLACE_LISTINGS: readonly MarketplaceListing[] = [
  makeMarketplaceListing({
    publicationId: "publication-synthetic-001", revisionId: "public-revision-synthetic-001",
    handle: "@alex", upvotes: 14, adoptions: 142, publishedAt: "2026-10-20T16:00:00Z",
    ownerAccountId: "learner-default", sourceSyllabusId: "syllabus-rag-python-001", basedOn: null,
    syllabus: DEFAULT_SYNTHETIC_SYLLABUS, schedule: DEFAULT_SYNTHETIC_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-linear-algebra-001", revisionId: "public-revision-linear-algebra-001",
    handle: "@spectral_sam", upvotes: 31, adoptions: 87, publishedAt: "2026-10-12T15:00:00Z",
    ownerAccountId: null, sourceSyllabusId: null, basedOn: null, syllabus: LINEAR_ALGEBRA_SYLLABUS, schedule: LINEAR_ALGEBRA_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-tolstoy-001", revisionId: "public-revision-tolstoy-001",
    handle: "@tolstoy_seminar", upvotes: 19, adoptions: 23, publishedAt: "2026-10-16T18:00:00Z",
    ownerAccountId: null, sourceSyllabusId: null, basedOn: null, syllabus: TOLSTOY_SYLLABUS, schedule: TOLSTOY_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-rust-async-001", revisionId: "public-revision-rust-async-001",
    handle: "@ferris_ops", upvotes: 48, adoptions: 64, publishedAt: "2026-10-18T12:00:00Z",
    ownerAccountId: null, sourceSyllabusId: null, basedOn: null, syllabus: RUST_ASYNC_SYLLABUS, schedule: RUST_ASYNC_SCHEDULE,
  }),
  makeMarketplaceListing({
    publicationId: "publication-statmech-001", revisionId: "public-revision-statmech-001",
    handle: "@ada_curates", upvotes: 27, adoptions: 39, publishedAt: "2026-10-08T10:00:00Z",
    ownerAccountId: null, sourceSyllabusId: null, basedOn: null, syllabus: STAT_MECH_SYLLABUS, schedule: STAT_MECH_SCHEDULE,
  }),
];

export const PRACTICE_ACTIONS: ReadonlySet<string> = new Set(["request-hint", "study-worked-solution", "submit-practice"]);

// Actions that need no valid session: signing in, password recovery, browsing the Marketplace, appearance, and view layout.
export const OPEN_ACTIONS: ReadonlySet<string> = new Set([
  "submit-sign-in", "submit-sign-up", "request-password-reset", "confirm-password-reset",
  "switch-auth-mode", "toggle-auth-password",
  "sign-in-passkey", "switch-persona", "simulate-session-expired", "sign-out",
  "set-marketplace-filter", "toggle-marketplace-topics", "clear-marketplace-filters", "set-marketplace-sort", "set-marketplace-query",
  "load-more",
  "close-study-detail", "toggle-solid-surfaces", "toggle-reduce-motion", "set-flow-order", "set-deep-dive", "set-spaced-review",
  "view-evidence", "check-prerequisites", "set-resource-scope", "set-resource-category",
]);

// The drawer's practice question for each published syllabus. An adopted copy keeps its publication id, so it shares the check.
const CONCEPT_CHECKS: Readonly<Record<string, ConceptCheck>> = {
  "publication-synthetic-001": {
    formula: "\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
    question: "Which statement matches the scaling term?",
    choices: [
      { value: "variance", label: "It keeps the variance of each dot-product score near 1 as d_k grows" },
      { value: "normalize", label: "It makes each row of attention weights sum to 1" },
      { value: "cost", label: "It makes attention cost linear instead of quadratic in sequence length" },
    ],
    correctValue: "variance",
    hint: "Suppose the entries of q and k are independent, with mean 0 and variance 1. The dot product $q \\cdot k$ adds $d_k$ such products. What is its variance?",
    solution: "The dot product q·k has variance d_k. Dividing by $\\sqrt{d_k}$ brings the variance back to $1$, so the softmax does not saturate and its gradients stay useful. The softmax, not the scale, makes each row sum to 1. The scale does not change the quadratic cost.",
    generatedBy: "curated",
  },
  "publication-linear-algebra-001": {
    formula: "A = Q \\Lambda Q^T",
    question: "Why does a real symmetric matrix A admit an orthogonal eigenbasis Q?",
    choices: [
      { value: "orthogonal", label: "Its eigenvalues are real, and eigenvectors for distinct eigenvalues are orthogonal" },
      { value: "invertible", label: "Every real symmetric matrix is invertible" },
      { value: "distinct", label: "Its eigenvalues are always distinct" },
    ],
    correctValue: "orthogonal",
    hint: "Take eigenvectors $v_1$ and $v_2$ with eigenvalues $\\lambda_1 \\neq \\lambda_2$. Compute $v_1^T A v_2$ in two ways, and use $A^T = A$.",
    solution: "Because $A^T = A$, $v_1^T A v_2$ equals both $\\lambda_2 v_1^T v_2$ and $\\lambda_1 v_1^T v_2$. With $\\lambda_1 \\neq \\lambda_2$, this forces $v_1^T v_2 = 0$. The spectral theorem also gives a full set of real eigenvectors, so each repeated eigenvalue has an orthonormal basis for its eigenspace. These orthonormal eigenvectors are the columns of $Q$, and the eigenvalues fill the diagonal of $\\Lambda$. The zero matrix and the identity show that $A$ need not be invertible or have distinct eigenvalues.",
    generatedBy: "curated",
  },
  "publication-statmech-001": {
    formula: "P_i = \\frac{1}{Z} e^{-\\beta E_i}",
    question: "What does the partition function Z do in the Boltzmann distribution?",
    choices: [
      { value: "normalize", label: "It makes the probabilities of all microstates sum to 1" },
      { value: "energy", label: "It is the mean energy of the system" },
      { value: "temperature", label: "It sets the temperature of the heat bath" },
    ],
    correctValue: "normalize",
    hint: "Add $P_i$ over every microstate $i$. What must the total be, and what does that force $Z$ to equal?",
    solution: "The probabilities must sum to $1$, so $Z = \\sum_j e^{-\\beta E_j}$, a sum over states. The bath temperature enters through $\\beta = \\frac{1}{k_B T}$, not through $Z$. The mean energy comes from $Z$ as $\\langle E \\rangle = -\\frac{\\partial \\ln Z}{\\partial \\beta}$, but $Z$ itself is not an energy.",
    generatedBy: "curated",
  },
  "publication-rust-async-001": {
    formula: "\\mathrm{poll}(cx) \\in \\{\\mathrm{Pending}, \\mathrm{Ready}(T)\\}",
    question: "What must a future do before its poll returns Poll::Pending?",
    choices: [
      { value: "waker", label: "Make sure cx.waker() is woken when the future can make progress" },
      { value: "spin", label: "Loop inside poll until the result is ready" },
      { value: "nothing", label: "Nothing, because the executor polls every pending future again on its next tick" },
    ],
    correctValue: "waker",
    hint: "After Pending, the executor parks the task. What tells the executor that the task is worth polling again?",
    solution: "Before it returns Pending, the future stores or registers cx.waker() with the I/O source, timer, or task that it waits on. That source calls wake() when progress is possible, and only then does the executor poll the task again. A loop inside poll blocks the executor thread, and an executor does not poll a parked task again by itself.",
    generatedBy: "curated",
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
  diagnostic_session_id: "diagnostic-synthetic-001", syllabus_id: "syllabus-rag-python-001",
  syllabus_revision_id: "revision-attention-v2", state: "active",
  target_objective_version_ids: ["objective-tokenization-v1", "objective-attention-v1"],
  assessed_objective_version_ids: ["objective-tokenization-v1"], unassessed_objective_version_ids: ["objective-attention-v1"],
  proficiency_snapshot_ref: "proficiency-snapshot-001", stop_reason: null,
};

export const DEFAULT_ADAPTATION_PROPOSAL: AdaptationProposalFixture = {
  proposal_id: "adaptation-synthetic-001", syllabus_id: "syllabus-rag-python-001",
  base_revision_id: "revision-attention-v2", candidate_revision_id: "revision-attention-v3-candidate",
  base_schedule_revision_id: "schedule-revision-attention-1", proficiency_snapshot_ref: "proficiency-snapshot-001",
  proposal_sha256: "e3de58105ed9020b861fa9ed9fda685296a6a2f6d278f65e8bd7485e4c99a20d", status: "pending",
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

export const DEFAULT_BYOK_CREDENTIALS: readonly MaskedCredentialRecord[] = [
  makeDefaultCred("cred-openai-1", "openai", "OpenAI Research Key", "9a4F", "2026-10-20T14:00:00Z"),
  makeDefaultCred("cred-anthropic-1", "anthropic", "Anthropic Claude Key", "7c2B", "2026-10-20T14:10:00Z"),
  makeDefaultCred("cred-gemini-1", "google_gemini", "Google Gemini Key", "3e8D", "2026-10-20T14:20:00Z"),
];

export const DEFAULT_WALLET: HostedCreditWalletSnapshot = {
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

// The plan model keeps one prompt per activity, so a lab's deliverables and a gate's assessment come from the raw syllabus.
const rawContentOf = (syllabus: Record<string, unknown>, activityId: string): Readonly<Record<string, unknown>> =>
  asRecord(rawListOf(syllabus, "activities").find((entry) => entry["activity_id"] === activityId)?.["content"]);

export const rubricOf = (syllabus: Record<string, unknown>, activityId: string): SelfCheckRubric | null => {
  const ref = rawContentOf(syllabus, activityId)["assessment_ref"];
  return typeof ref === "string" ? SELF_CHECK_RUBRICS[ref] ?? null : null;
};

export function resolveActivityConceptCheck(
  plan: ActiveSyllabus,
  syllabus: Record<string, unknown>,
  activityId: string,
  dynamicChecks: Readonly<Record<string, ConceptCheck>> = {},
): ConceptCheck | null {
  if (dynamicChecks[activityId]) return dynamicChecks[activityId]!;
  if (plan.publicationId && CONCEPT_CHECKS[plan.publicationId]) {
    return CONCEPT_CHECKS[plan.publicationId]!;
  }
  if (
    plan.publicationId === "publication-tolstoy-001" ||
    plan.assessmentMode === "Self-Check Rubric" ||
    rubricOf(syllabus, activityId) !== null
  ) {
    return null;
  }
  const rawActs = rawListOf(syllabus, "activities");
  const rawAct = rawActs.find((a) => a["activity_id"] === activityId);
  if (!rawAct) return null;
  const rawModules = rawListOf(syllabus, "modules");
  const holder =
    rawModules.find((m) => normalizeStringList(m["activity_ids"]).includes(activityId)) ?? rawModules[0];
  const objIds = normalizeStringList(rawAct["objective_ids"]);
  const rawObjectives = rawListOf(syllabus, "objectives");
  const rawObj =
    rawObjectives.find((o) => objIds.includes(String(o["objective_id"] ?? ""))) ?? rawObjectives[0];
  return buildDeterministicConceptCheck({
    syllabusTitle: goalTitleOf(syllabus),
    subject: typeof syllabus["subject"] === "string" ? syllabus["subject"] : plan.domain,
    moduleTitle: typeof holder?.["title"] === "string" ? holder["title"] : "Core Unit",
    activityId,
    activityTitle: typeof rawAct["title"] === "string" ? rawAct["title"] : activityId,
    activityType: typeof rawAct["type"] === "string" ? rawAct["type"] : "theory",
    activityPrompt: activityPromptOfRaw(rawAct),
    objectiveId: typeof rawObj?.["objective_id"] === "string" ? rawObj["objective_id"] : undefined,
    objectiveTitle: typeof rawObj?.["title"] === "string" ? rawObj["title"] : undefined,
    successCriterion:
      typeof rawObj?.["success_criterion"] === "string" ? rawObj["success_criterion"] : undefined,
    variantSeed: 0,
  });
}

const activityIdsOf = (syllabus: Record<string, unknown>): ReadonlySet<string> =>
  new Set(rawListOf(syllabus, "activities").map((entry) => entry["activity_id"]).filter((id): id is string => typeof id === "string"));

// The module that holds the given activity, or else the plan's first module, and the activity to open there.
export function stepOf(syllabus: Record<string, unknown>, activityId?: string | null): { readonly moduleId: string; readonly activityId: string } {
  const modules = rawListOf(syllabus, "modules").map((mod) => ({ id: mod["module_id"], activityIds: normalizeStringList(mod["activity_ids"]) }));
  const holder = modules.find((mod) => activityId && mod.activityIds.includes(activityId)) ?? modules[0];
  return {
    moduleId: typeof holder?.id === "string" ? holder.id : "",
    activityId: activityId && holder?.activityIds.includes(activityId) ? activityId : holder?.activityIds[0] ?? "",
  };
}

interface TodayInput {
  readonly syllabus: Record<string, unknown>;
  readonly schedule: Record<string, unknown>;
  readonly proficiency: ProficiencyProfileFixture;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly activityStates: Readonly<Record<string, ActivityExecutionStatus>>;
  readonly events: readonly ProgressEventInput[];
}

// One plan's Today view. All plans share one activity-state map, and each replays only its own progress events.
export function buildTodayFor({ syllabus, schedule, proficiency, catalogResources, activityStates, events }: TodayInput) {
  const own = activityIdsOf(syllabus);
  const today = createTodayViewController({ syllabus, schedule, proficiency, catalogResources, initialActivityStates: activityStates });
  for (const ev of events) if (own.has(ev.activityId ?? ev.activity_id ?? "")) today.recordProgressEvent(ev);
  return today;
}

function deliverablesOf(syllabus: Record<string, unknown>, activityId: string): readonly string[] {
  const content = rawContentOf(syllabus, activityId);
  const listed: unknown = content["deliverables"];
  return [content["deliverable_description"], ...(Array.isArray(listed) ? listed : [])]
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => renderUntrustedCatalogText(item, { maxLength: 2000 }).text);
}

// An account's plans: the base plans, its own adopted copies, and any AI-generated drafts.
export const plansFor = (
  accountId: string,
  adoptions: readonly Adoption[],
  listings: readonly MarketplaceListing[],
  generatedPlans: readonly ActiveSyllabus[] = [],
  syllabusOverrides: Readonly<Record<string, Record<string, unknown>>> = {},
  scheduleOverrides: Readonly<Record<string, Record<string, unknown>>> = {},
  deletedSyllabusIds: readonly string[] = [],
): readonly ActiveSyllabus[] => {
  const deletedSet = new Set(deletedSyllabusIds);
  const resolved = [
    ...ACTIVE_SYLLABI,
    ...adoptions.filter((adoption) => adoption.accountId === accountId).flatMap((adoption) => {
      const listing = listings.find((entry) => entry.publicationId === adoption.publicationId);
      return listing ? [adoptedPlanOf(listing, adoption)] : [];
    }),
    ...generatedPlans.filter((plan) => (plan.syllabus["account_id"] ?? accountId) === accountId),
  ]
    .filter((plan) => !deletedSet.has(plan.syllabusId))
    .map((plan) => ({
      ...plan,
      ...(syllabusOverrides[plan.syllabusId] ? { syllabus: syllabusOverrides[plan.syllabusId]! } : {}),
      ...(scheduleOverrides[plan.syllabusId] ? { schedule: scheduleOverrides[plan.syllabusId]! } : {}),
    }));
  if (resolved.length > 0) return resolved;
  return [
    makeActiveSyllabus(
      "syllabus-starter-empty",
      {
        ...DEFAULT_SYNTHETIC_SYLLABUS,
        syllabus_id: "syllabus-starter-empty",
        account_id: accountId,
        goal: {
          title: "Starter Study Workspace",
          summary: "Create a new syllabus with AI or adopt a community syllabus from Explore.",
          included_topics: [],
          excluded_topics: [],
        },
      },
      { ...DEFAULT_SYNTHETIC_SCHEDULE, schedule_id: "schedule-starter-empty" },
      null,
    ),
  ];
};

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

export function renderPlanDagSvgHtml(planModel: PlanMapAndOutlineModel): string {
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

  return `<svg class="plan-dag-svg" role="group" aria-label="Syllabus prerequisite DAG map" viewBox="${escapeHtml(svgViewport.viewBox)}" width="100%" height="400" overflow="visible" data-zoom="${svgViewport.zoom}" data-focused-node="${escapeHtml(svgViewport.focusedNodeId ?? "")}" data-opaque-surface="true">
          <defs>
            <filter id="node-elev" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#17191C" flood-opacity="0.10" /></filter>
            <filter id="node-elev-selected" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="2" stdDeviation="3.5" flood-color="#17191C" flood-opacity="0.14" /></filter>
            <marker id="dag-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-border-control)" /></marker>
          </defs>
          <g class="map-edges-layer">${edgesHtml}</g>
          <g class="map-nodes-layer">${nodesHtml}</g>
        </svg>`;
}

export function renderSyllabusWebAppHtml(inputState: SyllabusWebAppStateInput = {}): string {
  // A guest sees only public pages. Private panels, the drawer, and private dialogs are not rendered at all (UI-023).
  const authStatus: AuthStatus = inputState.authStatus ?? "authenticated";
  const account: Account = inputState.account ?? PERSONAS.learner;
  const signedOut = authStatus === "guest";
  const unpublishedSet = new Set(inputState.unpublishedPublicationIds ?? []);
  const listings = [...MARKETPLACE_LISTINGS, ...(inputState.publishedListings ?? [])].filter(
    (entry) => !unpublishedSet.has(entry.publicationId),
  );
  const votes = inputState.votes ?? [];
  const adoptions = inputState.adoptions ?? [];
  const generatedPlans = inputState.generatedPlans ?? [];
  const syllabusOverrides = inputState.syllabusOverrides ?? {};
  const scheduleOverrides = inputState.scheduleOverrides ?? {};
  const deletedSyllabusIds = inputState.deletedSyllabusIds ?? [];
  const plans = plansFor(account.accountId, adoptions, listings, generatedPlans, syllabusOverrides, scheduleOverrides, deletedSyllabusIds);
  // A syllabus or schedule in the input replaces the selected plan's own, so single-plan callers keep working.
  const registered = planIn(plans, inputState.selectedSyllabusId);
  const selectedPlan: ActiveSyllabus = {
    ...registered,
    syllabus: syllabusOverrides[registered.syllabusId] ?? inputState.syllabus ?? registered.syllabus,
    schedule: scheduleOverrides[registered.syllabusId] ?? inputState.schedule ?? registered.schedule,
  };
  const { syllabus, schedule } = selectedPlan;
  const proficiencyOverrides = inputState.proficiencyOverrides ?? {};
  const hasProficiencyOverrides = Object.keys(proficiencyOverrides).length > 0;
  const proficiency = buildEffectiveProficiency(
    inputState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY,
    syllabus,
    proficiencyOverrides,
  );
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

  const todayOf = (plan: ActiveSyllabus) => buildTodayFor({
    syllabus: plan.syllabus, schedule: plan.schedule, proficiency, catalogResources,
    activityStates: inputState.activityStates ?? {}, events: inputState.recordedProgressEvents ?? [],
  }).getState();
  const todayState = todayOf(selectedPlan);
  const planToday = plans.map((plan) => (plan === registered ? { plan: selectedPlan, today: todayState } : { plan, today: todayOf(plan) }));
  // Today queues active plans only. A draft waits on the Plan page until the learner activates it.
  const queue = planToday.filter(({ plan }) => !plan.draft);
  const openingStep = stepOf(syllabus, inputState.selectedActivityId);

  const basePlanModel = buildPlanMapAndOutlineModel({
    syllabus, proficiency, activityStates: todayState.activityExecutionStates, catalogResources, viewportWidthPx,
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
    syllabusId: basePlanModel.syllabusId, revisionId: basePlanModel.revisionId,
    ifMatch: `"${basePlanModel.revisionId}-etag"`, confirmedByLearner: true, acknowledgeScheduleChanges: true,
  });

  const diagnosticControl = inputState.diagnosticControl ?? "active";
  const hasSyllabusOverride = Boolean(syllabusOverrides[selectedPlan.syllabusId]);
  const effectiveDiagnosticSession =
    inputState.diagnosticSession ??
    (selectedPlan.syllabusId === "syllabus-rag-python-001" && !hasProficiencyOverrides && !hasSyllabusOverride && diagnosticControl === "active"
      ? DEFAULT_DIAGNOSTIC_SESSION
      : buildDynamicDiagnosticSession(selectedPlan.syllabusId, syllabus, proficiency, diagnosticControl));
  const diagnosticState = createDiagnosticFlowController(
    effectiveDiagnosticSession, proficiency, resolvedThemeMode,
  ).getState();

  const effectiveAdaptationProposal =
    inputState.adaptationProposal ??
    (selectedPlan.syllabusId === "syllabus-rag-python-001" && !hasProficiencyOverrides && !hasSyllabusOverride
      ? DEFAULT_ADAPTATION_PROPOSAL
      : buildDynamicAdaptationProposal(selectedPlan.syllabusId, syllabus, proficiency, DEFAULT_ADAPTATION_PROPOSAL));
  const adaptationDiff = createAdaptationDiffController(
    effectiveAdaptationProposal, resolvedThemeMode,
  ).getDiffModel();

  // Marketplace: public listings filtered and sorted for this viewer. Counts are public totals across accounts.
  const marketplaceFilters = { ...NO_MARKETPLACE_FILTERS, ...inputState.marketplaceFilters };
  const marketplaceSort = inputState.marketplaceSort ?? "top_upvoted";
  const myPlans = signedOut ? [] : plans;
  const originListing = listings.find((listing) => listing.publicationId === selectedPlan.publicationId && listing.ownerAccountId !== account.accountId);
  const adoptListing = listings.find((listing) => listing.publicationId === inputState.adoptPublicationId);
  const returnTo = inputState.returnTo ?? null;
  const authNotice = inputState.authNotice ?? null;
  const authMode: AuthMode = inputState.authMode ?? "login";
  const authPasswordVisible = inputState.authPasswordVisible ?? false;
  const passkeys = inputState.passkeys ?? [];
  const passkeyNotice = inputState.passkeyNotice ?? null;

  const byokCredentialsList = inputState.byokCredentials ?? DEFAULT_BYOK_CREDENTIALS;
  const activeByokCredentials = byokCredentialsList.filter((c) => c.status === "active" && Boolean(c.masked_suffix));
  const effectivePrimaryRef =
    inputState.primaryCredentialRef && activeByokCredentials.some((c) => c.credential_ref === inputState.primaryCredentialRef)
      ? inputState.primaryCredentialRef
      : (activeByokCredentials[0]?.credential_ref ?? "");

  const byokState = createByokCustodyController({
    initialMode: inputState.byokMode ?? "byok",
    initialCredentials: [...byokCredentialsList],
    selectedCredentialRef: effectivePrimaryRef || null,
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

  const selectedTimezone = inputState.reminderTimezone ?? "America/New_York";
  const reminderWeekdayTime = inputState.reminderWeekdayTime ?? "19:00";
  const reminderWeekendTime = inputState.reminderWeekendTime ?? "10:00";
  const reminderLeadMinutes = inputState.reminderLeadMinutes ?? "15";
  const parsedLeadMinutes = Number.parseInt(reminderLeadMinutes, 10);
  const reminderState = createReminderPreferenceController(
    {
      enabled: true, channels: ["email", "web_push"], timezone: selectedTimezone,
      quiet_hours: { start_local_time: "22:00", end_local_time: "07:30" },
      lead_time_minutes: Number.isFinite(parsedLeadMinutes) && parsedLeadMinutes >= 0 ? parsedLeadMinutes : 15,
      version: 1, etag: '"notification-prefs-v1"',
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
    order: inputState.flowOrder ?? plannedFlowOrder(syllabus),
    deepDive: inputState.deepDive ?? "included",
    spacedReview: inputState.spacedReview ?? "included",
  };
  const adminConsoleOpen = !signedOut && Boolean(inputState.adminConsoleOpen);
  const adminSourceFilter: AdminDiscoverySource = inputState.adminSourceFilter ?? "All";
  const adminCategoryFilter: ResourceCategory = inputState.adminCategoryFilter ?? "All";
  const adminSearchQuery = inputState.adminSearchQuery ?? "";
  const adminRemovedResourceIds = inputState.adminRemovedResourceIds ?? [];
  const adminResourceOverrides = inputState.adminResourceOverrides ?? {};
  const adminNotice = inputState.adminNotice ?? null;
  const isLearn = !adminConsoleOpen && activeTopLevel === "Learn";
  const isExplore = !adminConsoleOpen && activeTopLevel === "Explore";
  const isSettings = !adminConsoleOpen && activeTopLevel === "Settings";

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
    const id = escapeHtml(plan.syllabusId);
    const planTags = syllabusTagsOf(plan.syllabus, { subject: plan.domain, gateStyle: plan.assessmentMode });
    const session = today.nextSession?.activityBreakdown ?? [];
    const open = session.filter((act) => !isClosed(act.executionStatus));
    const next = open[0];
    const done = session.length - open.length;
    const minutesLeft = open.reduce((sum, act) => sum + act.durationTriplet.point, 0);
    return `<article class="syllabus-card" data-syllabus-id="${id}" data-action="select-syllabus" aria-labelledby="queue-${id}-title"${plan.syllabusId === selectedPlan.syllabusId ? ' aria-current="true"' : ""}>
            <p class="domain-pill">${escapeHtml(`${planTags.subject} · ${planTags.gateStyle}`)}</p>
            <h2 id="queue-${id}-title" class="syllabus-card-title">${escapeHtml(goalTitleOf(plan.syllabus))}</h2>
            <p class="queue-progress"><span class="st-sr">Upcoming session: </span>${done}/${session.length} completed${minutesLeft > 0 ? ` · ${minutesLeft}m left` : ""}</p>
            ${next ? `<div class="queue-next"><p class="queue-next-title">${renderTextWithLatexHtml(next.title)}</p><p class="queue-next-meta"><span>${next.durationTriplet.point}m</span><span class="track-badge">${TRACK_LABELS[TRACK_OF_TYPE[next.type]].badge}</span></p></div>` : `<p class="queue-next">Nothing is scheduled next.</p>`}
            <div class="queue-actions">
              ${next ? `<button type="button" class="btn-primary" data-action="resume-syllabus" data-syllabus-id="${id}" data-activity-id="${escapeHtml(next.activityId)}" data-module-id="${escapeHtml(next.moduleId)}">Resume<span aria-hidden="true">→</span></button>` : ""}
            </div>
          </article>`;
  }).join("");
  const planOptionsHtml = [
    ...planToday.map(({ plan, today }) => {
      const planTags = syllabusTagsOf(plan.syllabus, { subject: plan.domain, gateStyle: plan.assessmentMode });
      const session = today.nextSession?.activityBreakdown ?? [];
      const open = session.filter((act) => !isClosed(act.executionStatus));
      const done = session.length - open.length;
      const unitsCount = rawListOf(plan.syllabus, "modules").length;
      return `<option value="${escapeHtml(plan.syllabusId)}" data-domain="${escapeHtml(planTags.subject)}" data-units="${unitsCount} units" data-progress="${done}/${session.length} completed"${plan.draft ? ' data-draft="true"' : ""}${plan.syllabusId === selectedPlan.syllabusId ? " selected" : ""}>${escapeHtml(goalTitleOf(plan.syllabus))}${plan.draft ? " · Draft" : ""}</option>`;
    }),
    `<option value="__new_syllabus__" data-action-option="new-syllabus">+ New Syllabus</option>`,
  ].join("");
  const selectedTagStripHtml = renderToString(
    h(SyllabusTagStrip, {
      syllabus: selectedPlan.syllabus,
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
      syllabusId: selectedPlan.syllabusId,
      rigor: mathDepthFor(syllabus, selectedActivity.objectiveIds.flatMap((objectiveId) => topicOf.get(objectiveId) ?? [])),
      deliverables: deliverablesOf(syllabus, selectedActivity.activityId), catalogResources,
      rubric: rubricOf(syllabus, selectedActivity.activityId),
      conceptCheck: resolveActivityConceptCheck(selectedPlan, syllabus, selectedActivity.activityId, inputState.dynamicConceptChecks ?? {}),
      practice: { hintRequested, workedSolutionRevealed, submitted: practiceSubmitted, choice: practiceChoice },
      skipRecorded: skippedActivityIds.has(selectedActivity.activityId),
      completedSubtaskIds: inputState.completedSubtaskIds ?? [],
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
      return "Reviewed check on a recorded date; in-app help was not used and outside help was not verified.";
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
      return "Delayed retention check has not been recorded yet.";
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

  const totalObjectives = basePlanModel.objectiveTracks.length;
  const masteryPct = totalObjectives > 0 ? Math.round((demonstratedObjectives / totalObjectives) * 100) : 0;
  const effortPct = requiredActivities.length > 0 ? Math.round((requiredCompleted / requiredActivities.length) * 100) : 0;
  const assessedCount = assessedCapabilityTitles.length;
  const sampledCount = sampledCapabilityTitles.length || totalObjectives;
  const checkPct = sampledCount > 0 ? Math.round((assessedCount / sampledCount) * 100) : 0;

  const progressUnitCardsHtml = modules.map((mod, idx) => {
    const gate = unitGate(mod);
    const unitProg = unitProgress(mod.activities);
    const unitObjectives = mod.objectiveIds
      .map((id) => objectiveById.get(id))
      .filter((obj): obj is NonNullable<typeof obj> => Boolean(obj));
    const cardsHtml = unitObjectives.map((obj) => {
      const linked = mod.activities.filter((act) => act.objectiveIds.includes(obj.objectiveId));
      const activitiesForObj = linked.length > 0 ? linked : mod.activities;
      const activityChipsHtml = activitiesForObj.map((act) => {
        const track = trackOf(act);
        const done = isClosed(act.executionStatus);
        return `<button type="button" class="progress-act-chip" data-action="select-outline-activity" data-activity-id="${escapeHtml(act.activityId)}" data-module-id="${escapeHtml(mod.moduleId)}" data-done="${done}">
          <span class="progress-act-track">${escapeHtml(TRACK_LABELS[track].badge)}</span>
          <span class="progress-act-duration">${act.durationTriplet.point}m</span>
        </button>`;
      }).join('<span class="progress-act-sep" aria-hidden="true">·</span>');
      const shortConclusion = obj.proficiencyStatus === "demonstrated" ? "Demonstrated" : conclusionLabel(obj.proficiencyStatus);
      return `<article class="progress-capability-row" data-objective-id="${escapeHtml(obj.objectiveId)}" data-proficiency-status="${escapeHtml(obj.proficiencyStatus)}">
        <div class="progress-cap-main">
          <div class="progress-cap-identity">
            <div class="progress-cap-title-row">
              ${proficiencyGlyph(obj.proficiencyStatus)}
              <p class="capability-title">${escapeHtml(obj.title || "Learning objective: title unavailable")}</p>
            </div>
            <p class="prose capability-support progress-cap-description">${escapeHtml(calibrationSummary(obj))} ${escapeHtml(retentionSummary(obj))}</p>
            <div class="progress-cap-activities" aria-label="Linked unit activities">
              <span class="progress-cap-topic">${escapeHtml(humanize(obj.topicId.replace(/^topic-/, "")))}</span>
              <span aria-hidden="true">·</span>
              <span class="progress-status-pill" data-status="${escapeHtml(obj.proficiencyStatus)}">${escapeHtml(shortConclusion)}<span class="st-sr"> (${escapeHtml(conclusionLabel(obj.proficiencyStatus))})</span></span>
              <span aria-hidden="true">·</span>
              <span class="progress-cap-activities-label">Study flow:</span>
              ${activityChipsHtml}
            </div>
          </div>
          <div class="plan-objective-actions">
            <button type="button" class="progress-check-btn" data-action="diagnostic-continue" data-objective-id="${escapeHtml(obj.objectiveId)}">Check understanding <span aria-hidden="true">→</span></button>
          </div>
        </div>
      </article>`;
    }).join("\n");

    return `<section class="progress-unit-row" data-module-id="${escapeHtml(mod.moduleId)}">
      <header class="progress-unit-header">
        <div class="progress-unit-title-row">
          <span class="progress-unit-code">U${idx + 1}</span>
          <h3 class="progress-unit-title">${escapeHtml(displayUnitTitle(mod.title))}</h3>
        </div>
        <div class="progress-unit-meta">
          <span class="progress-unit-effort">${unitProg.done}/${unitProg.total} required done</span>
          <span aria-hidden="true">·</span>
          <span class="progress-unit-gate" data-passed="${gate.passed}">${gate.passed ? "✓ Gate passed" : "◇ Gate open"}</span>
        </div>
      </header>
      <div class="progress-unit-capabilities">
        ${cardsHtml}
      </div>
    </section>`;
  }).join("\n");
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
    ? "Revision applied to your active syllabus. Corroborated introductory steps were waived and targeted bridge work was inserted."
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
    <details class="today-syllabus-overview evidence-technical-details">
      <summary class="today-overview-summary"><span>Technical revision metadata</span></summary>
      <div class="today-overview-body">
        <p class="meta-text">Preserved math depth: <code>${escapeHtml(adaptationDiff.preserved_math_depth ?? "formal")}</code> · Proposal SHA-256: <code>${escapeHtml(adaptationDiff.proposal_sha256)}</code> · Waived IDs: <code>${escapeHtml(adaptationDiff.waivers.map((w) => w.node_id).join(", "))}</code> · Evidence refs: <code>${escapeHtml(adaptationDiff.waivers.flatMap((w) => w.qualifying_evidence_refs).join(", "))}</code></p>
      </div>
    </details>
    <div class="action-row"><button type="button" class="btn-secondary" data-action="keep-current-plan">Keep current plan</button><button type="button" class="btn-primary" data-action="accept-revision">Accept revision</button></div>
    <p class="prose meta-text">${adaptationChoiceCopy}</p>`;

  const REMINDER_TIMEZONES: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
    { id: "America/New_York", label: "Eastern Time" },
    { id: "America/Chicago", label: "Central Time" },
    { id: "America/Denver", label: "Mountain Time" },
    { id: "America/Los_Angeles", label: "Pacific Time" },
    { id: "UTC", label: "UTC" },
    { id: "Europe/London", label: "British Time" },
    { id: "Europe/Berlin", label: "Central European Time" },
    { id: "Asia/Seoul", label: "Korea Standard Time" },
    { id: "Asia/Tokyo", label: "Japan Standard Time" },
    { id: "Asia/Singapore", label: "Singapore Time" },
    { id: "Australia/Sydney", label: "Australian Eastern Time" },
  ];
  const timezoneLabel =
    REMINDER_TIMEZONES.find((tz) => tz.id === reminderState.timezone)?.label ?? reminderState.timezone;
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
              ? `Session ${sessionNum} rescheduled to <strong>${escapeHtml(humanTime)}</strong> · Saved.`
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

  const sidebarSyllabi = planToday.map(({ plan, today }) => {
    const planTags = syllabusTagsOf(plan.syllabus, { subject: plan.domain, gateStyle: plan.assessmentMode });
    const session = today.nextSession?.activityBreakdown ?? [];
    const open = session.filter((act) => !isClosed(act.executionStatus));
    const done = session.length - open.length;
    return {
      syllabusId: plan.syllabusId,
      title: goalTitleOf(plan.syllabus),
      subject: planTags.subject,
      progressLabel: `${done}/${session.length} done`,
      isSelected: plan.syllabusId === selectedPlan.syllabusId,
      isDraft: Boolean(plan.draft),
    };
  });

  // The ready state needs no banner. Any other state still shows above the Next-up bar.
  const recoveryBanner = todayState.asyncRecoveryBanner.state === "ready" ? "" : `<p class="status-banner" role="${todayState.asyncRecoveryBanner.role}"><strong>${escapeHtml(todayState.asyncRecoveryBanner.title)}:</strong> ${escapeHtml(todayState.asyncRecoveryBanner.message)} ${escapeHtml(todayState.asyncRecoveryBanner.actionableNextStep)}</p>`;

  const openDialogId = inputState.openDialogId ?? null;
  const dialogOpen = (id: string) => ` data-open="${openDialogId === id}"`;

  const ownedListings = signedOut ? [] : listings.filter((listing) => listing.ownerAccountId === account.accountId);
  const upvotesOfListing = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOfListing = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const studyHoursOfListing = (listing: MarketplaceListing): number =>
    Math.round((studyMinutesOf(listing.syllabus) * adoptionsOfListing(listing)) / 60);
  const totalLearnersReached = ownedListings.reduce((sum, listing) => sum + adoptionsOfListing(listing), 0);
  const totalStudyHoursGifted = ownedListings.reduce((sum, listing) => sum + studyHoursOfListing(listing), 0);
  const totalUpvotesReceived = ownedListings.reduce((sum, listing) => sum + upvotesOfListing(listing), 0);
  const derivedListings = listings.filter((listing) => listing.basedOn === handleOf(account));

  return `<div class="syllabus-app-shell" data-theme="${resolvedThemeMode}" data-theme-preference="${themePreference}" data-solid-surfaces="${solidSurfaces}" data-reduce-motion="${reduceMotion}" data-auth-status="${authStatus}" data-breakpoint="${layout.breakpoint}" data-navigation-chrome="${layout.navigationChrome}" data-current-top-level="${adminConsoleOpen ? "Admin" : activeTopLevel}" data-current-learn-sub="${activeLearnSub}" data-current-plan-view="${activePlanView}" data-selected-module-id="${escapeHtml(basePlanModel.selectedModuleId ?? "")}" data-selected-activity-id="${escapeHtml(basePlanModel.selectedActivityId ?? "")}" style="--active-canvas: ${palette.colors.canvas}; --active-surface: ${studySurface.backgroundColor};">
  <a class="skip-link" href="#main-workspace">Skip to main study workspace</a>
  ${renderToString(h(HeaderBar, {
    activeTopLevel,
    authStatus,
    account,
    studyMinutes,
    selfReportedCount,
    resolvedThemeMode,
    adminConsoleOpen,
  }))}
  ${renderToString(h(SessionExpiredBanner, { authStatus }))}
  <div class="app-body-grid">
    ${renderToString(h(AppSidebar, {
      signedOut,
      activeTopLevel,
      activeLearnSub,
      goalTitle: basePlanModel.goal.title,
      totalEffort,
      syllabi: sidebarSyllabi,
      adminConsoleOpen,
    }))}
    <main id="main-workspace" class="app-main-workspace" role="main" tabindex="-1">
      ${signedOut ? "" : `      <section class="top-level-panel" id="panel-learn" data-top-panel="Learn" data-active="${isLearn}"${isLearn ? "" : " hidden"}>
        <section class="learn-sub-panel" id="panel-learn-today" data-learn-panel="Today" data-active="${isLearn && activeLearnSub === "Today"}"${isLearn && activeLearnSub === "Today" ? "" : " hidden"}>
          <div class="today-active-workspace">
            <header class="today-unified-header" data-opaque-surface="true">
              <div class="section-header">
                <div class="today-selected-heading">
                  <h1 class="page-title today-selected-title">${escapeHtml(goalTitleOf(selectedPlan.syllabus))}</h1>
                  <span class="today-selected-eyebrow"><span class="today-selected-progress">${planProgress.done}/${planProgress.total} completed${planProgress.left > 0 ? ` · ${planProgress.left}m left` : ""}</span></span>
                  ${selectedTagStripHtml}
                </div>
                <div class="plan-toolbar today-syllabus-actions">
                  ${selectedPlan.draft ? `<button type="button" class="btn-primary" data-action="activate-revision" data-syllabus-id="${escapeHtml(revisionActivationReq.syllabusId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">Activate plan</button>` : ""}
                  <button type="button" class="btn-secondary" data-action="open-resource-editor" data-editor-mode="ingest" data-syllabus-id="${escapeHtml(selectedPlan.syllabusId)}">+ Add resource</button>
                  <button type="button" class="btn-ghost-share" data-action="open-dialog" data-dialog-id="dialog-publication-preview"><svg class="sf-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5h3v3"/><path d="M6.5 9.5 13.5 2.5"/><path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/></svg><span>Share with Community</span></button>
                </div>
                <div class="plan-toolbar plan-command-picker" hidden>
                  <label class="field field-inline plan-command-field" for="selected-plan-control"><span class="plan-command-label st-sr">Syllabus</span>
                    <select id="selected-plan-control" class="plan-command-select" name="selected-plan" data-action="select-syllabus" data-tom-select="plan">${planOptionsHtml}</select>
                  </label>
                </div>
              </div>
              <div class="plan-brief today-syllabus-brief">
                <section class="plan-brief-goal" aria-labelledby="today-goal-label">
                  <h2 id="today-goal-label" class="plan-brief-label">Goal</h2>
                  <p class="plan-goal">${escapeHtml(basePlanModel.goal.summary)}</p>
                </section>
                ${basePlanModel.goal.includedTopics.length > 0 ? `<section class="plan-brief-covers" aria-labelledby="today-covers-label">
                  <h2 id="today-covers-label" class="plan-brief-label">Covers</h2>
                  <ul class="plan-scope-list">${basePlanModel.goal.includedTopics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>
                </section>` : ""}
              </div>
              ${selectedPlan.draft ? `<p class="draft-notice" role="status">This plan is your private draft of ${originListing ? `${escapeHtml(originListing.handle)}'s template` : "a community template"}. Review it, then select Activate plan to add it to Today.</p>` : ""}
              ${recoveryBanner}
            </header>
            ${todayBoardHtml}
          </div>
          <section class="today-bottom-grid" aria-label="Reviews and completed work" data-opaque-surface="true" hidden>
            <section class="review-queue" data-review-separation-valid="${todayState.reviewSeparationValid}" aria-labelledby="review-queue-title">
              <h2 id="review-queue-title">Review queue <span class="count-badge">${reviewRows.length}</span></h2>
              ${listOrEmpty(reviewRows, "today", "No reviews are due.")}
            </section>
            <section class="completed-history" aria-labelledby="completed-history-title">
              <h2 id="completed-history-title">Completed work <span class="count-badge">${completedRows.length}</span></h2>
              ${listOrEmpty(completedRows, "check", "No self-reported completions yet.")}
            </section>
          </section>
          <section class="today-syllabi-grid" aria-label="Active syllabi" hidden>
          ${queueCardsHtml}
          </section>
        </section>

        <section class="learn-sub-panel" id="panel-learn-plan" data-learn-panel="Plan" data-active="${isLearn && activeLearnSub === "Plan"}"${isLearn && activeLearnSub === "Plan" ? "" : " hidden"} data-opaque-surface="true">
          <header class="plan-hero">
            ${planToday.length < 2 ? "" : `<nav class="plan-switcher" aria-label="Your syllabi">
              ${planToday.map(({ plan }) => {
                const planTags = syllabusTagsOf(plan.syllabus, { subject: plan.domain, gateStyle: plan.assessmentMode });
                return `<button type="button" class="plan-switch" data-action="select-syllabus" data-syllabus-id="${escapeHtml(plan.syllabusId)}"${plan.syllabusId === selectedPlan.syllabusId ? ' aria-current="true"' : ""}>
                <span class="plan-switch-domain">${escapeHtml(planTags.subject)}</span>
                <span class="plan-switch-title">${escapeHtml(goalTitleOf(plan.syllabus))}</span>
                <span class="plan-switch-meta">${rawListOf(plan.syllabus, "modules").length} units${plan.draft ? " · Draft" : ""}</span>
              </button>`;
              }).join("")}
            </nav>`}
            <div class="plan-title-row">
              <h1 class="page-title plan-title">${escapeHtml(goalTitleOf(syllabus))}</h1>
              <div class="plan-toolbar">
                ${selectedPlan.draft ? `<button type="button" class="btn-primary" data-action="activate-revision" data-syllabus-id="${escapeHtml(revisionActivationReq.syllabusId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}">Activate plan</button>` : `<button type="button" class="btn-secondary" data-action="activate-revision" data-syllabus-id="${escapeHtml(revisionActivationReq.syllabusId)}" data-revision-id="${escapeHtml(revisionActivationReq.revisionId)}" data-if-match="${escapeHtml(revisionActivationReq.headers["If-Match"] ?? "")}" hidden>Activate plan</button>`}
                <button type="button" class="btn-secondary" data-action="open-syllabus-editor" data-syllabus-edit-mode="syllabus">Edit structure</button>
                <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-adaptation-diff">Preview adaptation</button>
                <button type="button" class="btn-secondary" data-action="open-resource-editor" data-editor-mode="ingest" data-syllabus-id="${escapeHtml(selectedPlan.syllabusId)}">+ Add resource</button>
                <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share with Community</button>
                <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Today">Resume Study<span aria-hidden="true">→</span></button>
              </div>
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
              </div>
              <div class="plan-outline-container" data-plan-surface="Outline" data-active="${activePlanView === "Outline"}">${planArchitectureOutlineHtml}</div>
              ${relationshipLegend}
            </section>
          </div>
        </section>

        <section class="learn-sub-panel" id="panel-learn-progress" data-learn-panel="Progress" data-active="${isLearn && activeLearnSub === "Progress"}"${isLearn && activeLearnSub === "Progress" ? "" : " hidden"}>
          <div class="section-header">
            <div class="page-heading-group">
              <h1 class="page-title">Your learning evidence</h1>
              <p class="page-description">${escapeHtml(goalTitleOf(selectedPlan.syllabus))} — verified objective checks alongside self-reported study activities.</p>
            </div>
            <div class="plan-toolbar">
              <label class="field field-inline" for="progress-syllabus-control" hidden><span>Syllabus</span>
                <select id="progress-syllabus-control" name="progress-syllabus" data-action="select-syllabus">${planOptionsHtml}</select>
              </label>
              <button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-adaptation-diff">Preview adaptation</button>
              <button type="button" class="btn-secondary" data-action="navigate-learn-sub" data-sub-destination="Today">Open Study Flow<span aria-hidden="true">→</span></button>
            </div>
          </div>

          <div class="plan-sections-stack">
            <section class="progress-portfolio-section" id="progress-capability-portfolio" aria-labelledby="progress-portfolio-heading" data-opaque-surface="true">
              <div class="progress-overview-strip" aria-label="Progress overview">
                <div class="progress-overview-col">
                  <div class="progress-overview-head">
                    <span class="progress-overview-label">Verified mastery</span>
                    <span class="progress-overview-meta">${masteryPct}%</span>
                  </div>
                  <p class="progress-overview-value">${demonstratedObjectives} of ${totalObjectives} objectives demonstrated</p>
                </div>

                <div class="progress-overview-col">
                  <div class="progress-overview-head">
                    <span class="progress-overview-label">Study effort</span>
                    <span class="progress-overview-meta">${planProgress.left > 0 ? `${planProgress.left}m left` : "Complete"}</span>
                  </div>
                  <p class="progress-overview-value">${requiredCompleted} of ${requiredActivities.length} required activities · ${reviewSummary}</p>
                </div>

                <div class="progress-overview-col diagnostic-panel" id="progress-diagnostic-verification" data-diagnostic-session-id="${escapeHtml(diagnosticState.diagnostic_session_id)}" data-diagnostic-state="${escapeHtml(diagnosticState.state)}">
                  <div class="progress-overview-head">
                    <span class="progress-overview-label">Understanding check</span>
                    <span class="progress-overview-meta">Session ${escapeHtml(diagnosticControl)}</span>
                  </div>
                  <p class="progress-overview-value">${assessedCount} of ${sampledCount} sampled capabilities checked</p>
                  <div class="progress-overview-actions">
                    <button type="button" class="btn-primary" data-action="diagnostic-continue">Continue ~5m check</button>
                    <button type="button" class="btn-secondary" data-action="diagnostic-pause">Pause</button>
                    <button type="button" class="btn-secondary" data-action="diagnostic-stop-early">Stop</button>
                  </div>
                </div>
              </div>

              <div class="section-header progress-portfolio-header">
                <h2 id="progress-portfolio-heading">Capabilities by unit</h2>
                <span class="meta-text">${evidenceSummary}</span>
              </div>
              <div class="progress-units-list">
                ${progressUnitCardsHtml}
              </div>
            </section>

            <section class="surface-panel" id="progress-evidence-detail" aria-labelledby="progress-evidence-detail-heading" data-opaque-surface="true" hidden>
              <h2 id="progress-evidence-detail-heading">${escapeHtml(inspectedObjective?.title ?? "Capability evidence detail")}</h2>
              <p>${escapeHtml(inspectedObjective ? calibrationSummary(inspectedObjective) : "No qualifying check is recorded.")}</p>
              <p>Demonstrating introductory matrix operations does not establish matrix calculus or unassessed downstream objectives.</p>
              <p>${escapeHtml(inspectedObjective ? retentionSummary(inspectedObjective) : "No delayed check recorded.")}</p>
              <details class="today-syllabus-overview evidence-technical-details">
                <summary class="today-overview-summary"><span>Technical audit metadata</span></summary>
                <div class="today-overview-body">
                  <p class="meta-text">Canonical proficiency states: ${canonicalStatusesLegendHtml}</p>
                  <div class="honest-two-layer-summary">
                    <h3>Honest Two-Layer Status Summary</h3>
                  </div>
                </div>
              </details>
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
          userLibraryResourceIds: inputState.userLibraryResourceIds ?? [],
          removedResourceIds: adminRemovedResourceIds,
          resourceNotice: inputState.resourceNotice ?? null,
        }))}
      </section>`}

      ${renderToString(h(ExploreMarketplace, {
        active: isExplore,
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

      ${signedOut ? "" : `      <section class="top-level-panel" id="panel-settings" data-top-panel="Settings" data-active="${isSettings}"${isSettings ? "" : " hidden"}>
        <div class="section-header">
          <h1 class="page-title">Profile &amp; settings</h1>
          <button type="button" class="btn-secondary" data-action="sign-out">Sign out</button>
        </div>
        <div class="settings-stack">
          <section class="settings-section profile-identity" aria-labelledby="settings-profile-title" data-opaque-surface="true">
            <h2 class="st-sr" id="settings-profile-title">Profile</h2>
            <div class="profile-layout-grid">
              <div class="profile-photo-stack">
                <button type="button" class="profile-avatar-trigger" data-action="open-dialog" data-dialog-id="dialog-avatar-cropper" aria-label="Edit profile photo">
                  <span class="user-avatar-circle user-avatar-xl" aria-hidden="true">${account.avatarUrl ? `<img class="user-avatar-img" src="${escapeHtml(account.avatarUrl)}" alt="">` : escapeHtml(initialsOf(account))}</span>
                  <span class="profile-avatar-edit-badge" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </span>
                </button>
              </div>
              <form class="profile-edit-form" data-action="update-profile">
                <div class="profile-fields-grid">
                  <label class="field" for="profile-handle-input">Username
                    <input id="profile-handle-input" type="text" name="username" autocomplete="username" spellcheck="false" value="${escapeHtml(usernameOf(account))}">
                  </label>
                  <label class="field" for="profile-email-input">Email address
                    <input id="profile-email-input" type="email" name="email" autocomplete="email" spellcheck="false" value="${escapeHtml(account.email)}" required>
                  </label>
                </div>
                <div class="profile-form-actions">
                  <button type="submit" class="btn-primary profile-save-btn">Save changes</button>
                  ${inputState.profileNotice ? `<p class="profile-save-status" role="status">${escapeHtml(inputState.profileNotice)}</p>` : ""}
                </div>
              </form>
            </div>
            <div class="profile-verification-bar" data-email-verified="${Boolean(inputState.emailVerified)}">
              <div class="profile-verification-copy">
                <span class="badge" data-verified="${Boolean(inputState.emailVerified)}">${inputState.emailVerified ? "Email verified" : "Email unverified"}</span>
                <span class="row-meta">${inputState.emailVerified ? `Recovery and study notifications are active for ${escapeHtml(account.email)}.` : "Verify your email address to enable account recovery and scheduled study notifications."}</span>
              </div>
              ${inputState.emailVerified ? "" : `<div class="profile-verification-controls">
                <button type="button" class="btn-secondary" data-action="request-email-verification">Send verification code</button>
                <form class="email-verify-form" data-action="confirm-email-verification" novalidate>
                  <label class="field" for="profile-verify-code-input">
                    <span class="st-sr">Email verification code</span>
                    <span class="field-hint" id="profile-verify-code-hint">6-digit code</span>
                    <input id="profile-verify-code-input" type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="6-digit code" aria-describedby="profile-verify-code-hint" autocomplete="one-time-code" required>
                  </label>
                  <button type="submit" class="btn-secondary">Verify email</button>
                </form>
              </div>`}
            </div>
          </section>

          <section class="settings-section" id="settings-passkeys" aria-labelledby="settings-passkeys-title" data-opaque-surface="true">
            <div class="settings-section-head">
              <div>
                <h2 id="settings-passkeys-title">Passkeys</h2>
                <p class="section-lede">Sign in with Touch ID, Face ID, Windows Hello, or your password manager without typing a password.</p>
              </div>
              <button type="button" class="btn-secondary" data-action="register-passkey">+ Add a passkey</button>
            </div>
            ${passkeyNotice ? `<p class="section-lede" id="settings-passkey-notice" role="status">${escapeHtml(passkeyNotice)}</p>` : ""}
            ${passkeys.length > 0 ? `<ul class="passkey-list">
              ${passkeys.map((pk) => {
                const syncLabel = pk.credentialDeviceType === "multiDevice" && pk.credentialBackedUp
                  ? "Synced across devices"
                  : "This device only";
                const addedDate = pk.registeredAt > 0
                  ? new Date(pk.registeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
                  : "Recently";
                const usedPart = pk.lastUsedAt
                  ? ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
                  : "";
                return `<li class="passkey-row" data-passkey-id="${escapeHtml(pk.id)}">
                <div class="passkey-row-text">
                  <span class="passkey-row-title">${escapeHtml(pk.name)}</span>
                  <p class="row-meta">${escapeHtml(`${syncLabel} · Added ${addedDate}${usedPart}`)}</p>
                </div>
                <div class="row-actions">
                  <button type="button" class="btn-secondary" data-action="delete-passkey" data-credential-id="${escapeHtml(pk.id)}">Remove</button>
                </div>
              </li>`;
              }).join("\n")}
            </ul>` : ""}
          </section>

          <section class="settings-section" id="settings-community" aria-labelledby="settings-community-title" data-opaque-surface="true">
            <div class="settings-section-head">
              <div>
                <h2 id="settings-community-title">Your contributions</h2>
              </div>
              ${ownedListings.length > 0 ? `<button type="button" class="btn-secondary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">+ Share another syllabus</button>` : ""}
            </div>
            ${ownedListings.length > 0 ? `<div class="community-impact-banner">
              <div class="impact-copy-group">
                <p class="impact-summary">Your shared ${ownedListings.length === 1 ? "plan" : "plans"} reached <strong>${totalLearnersReached} ${totalLearnersReached === 1 ? "learner" : "learners"}</strong>, who planned about <strong>${totalStudyHoursGifted} ${totalStudyHoursGifted === 1 ? "study hour" : "study hours"}</strong> with ${ownedListings.length === 1 ? "it" : "them"}. <strong>${totalUpvotesReceived} ${totalUpvotesReceived === 1 ? "person" : "people"}</strong> upvoted your work.</p>
                <p class="row-meta">Every adoption is free for the learner under CC BY 4.0. Thank you for teaching in the open.</p>
              </div>
            </div>
            <ul class="contribution-list">
              ${ownedListings.map((listing) => {
                const title = goalTitleOf(listing.syllabus);
                const myPlan = plans.find((plan) => plan.publicationId === listing.publicationId || plan.syllabusId === listing.sourceSyllabusId);
                const adoptCount = adoptionsOfListing(listing);
                const upvoteCount = upvotesOfListing(listing);
                const hoursCount = studyHoursOfListing(listing);
                return `<li class="contribution-row" data-publication-id="${escapeHtml(listing.publicationId)}">
                <div class="contribution-text">
                  <div class="contribution-status-line">
                    <span class="status-dot" data-status="public" aria-hidden="true"></span>
                    <span class="status-text" data-status="public">Public · Revision 1</span>
                    <span class="row-meta">· CC BY 4.0</span>
                  </div>
                  <h3 class="contribution-title">${escapeHtml(title)}</h3>
                  <div class="contribution-metrics">
                    ${adoptCount > 0 ? `<span class="contribution-metric">${sfIcon("course", 15)}<span><strong>${adoptCount}</strong> ${adoptCount === 1 ? "adoption" : "adoptions"}</span></span>
                    <span class="contribution-metric">${sfIcon("upvote", 15)}<span><strong>${upvoteCount}</strong> ${upvoteCount === 1 ? "upvote" : "upvotes"}</span></span>
                    <span class="contribution-metric">${sfIcon("clock", 15)}<span><strong>${hoursCount}</strong> ${hoursCount === 1 ? "study hour" : "study hours"}</span></span>` : `<span class="row-meta">Live in Explore and ready for its first learner</span>`}
                  </div>
                </div>
                <div class="row-actions">
                  ${myPlan ? `<button type="button" class="btn-secondary" data-action="open-syllabus-plan" data-syllabus-id="${escapeHtml(myPlan.syllabusId)}">Open plan</button>` : ""}
                  <button type="button" class="btn-secondary" data-action="navigate-top" data-destination="Explore">View in Explore</button>
                  <button type="button" class="unpublish-btn" data-action="open-dialog" data-dialog-id="dialog-unpublish" data-publication-id="${escapeHtml(listing.publicationId)}" aria-label="Unpublish ${escapeHtml(title)}">Unpublish</button>
                </div>
              </li>`;
              }).join("\n")}
            </ul>
            <div class="learner-comments">
              <div class="learner-comments-head">
                <h3>Comments from learners</h3>
                <span class="row-meta">${derivedListings.length > 0 ? `${derivedListings.length} community remix${derivedListings.length === 1 ? "" : "es"}` : "Community notes on your shared syllabus"}</span>
              </div>
              <ul class="comment-list">
                <li class="comment-card">
                  <div class="comment-card-top">
                    <span class="comment-upvote-tag">${sfIcon("upvote", 15)}<span>Upvoted &amp; adopted</span></span>
                    <time class="row-meta" datetime="2026-10-24">2 days ago</time>
                  </div>
                  <blockquote class="comment-body"><p>The BPE and scaled dot-product attention progression finally made variance scaling click before writing the retrieval pipeline.</p></blockquote>
                  <div class="comment-author-row">
                    <span class="user-avatar-circle comment-avatar" aria-hidden="true">MD</span>
                    <p class="row-meta"><strong>@maya_dev</strong> on ${escapeHtml(goalTitleOf(ownedListings[0]?.syllabus ?? syllabus))}</p>
                  </div>
                </li>
                <li class="comment-card">
                  <div class="comment-card-top">
                    <span class="comment-upvote-tag">${sfIcon("upvote", 15)}<span>Upvoted &amp; adopted</span></span>
                    <time class="row-meta" datetime="2026-10-21">5 days ago</time>
                  </div>
                  <blockquote class="comment-body"><p>Cleanest self-study syllabus I have found for RAG evaluation metrics. It saved me weeks of piecing together scattered blog posts.</p></blockquote>
                  <div class="comment-author-row">
                    <span class="user-avatar-circle comment-avatar" aria-hidden="true">KM</span>
                    <p class="row-meta"><strong>@kenji_ml</strong> on ${escapeHtml(goalTitleOf(ownedListings[0]?.syllabus ?? syllabus))}</p>
                  </div>
                </li>
              </ul>
            </div>` : `<div class="settings-card">
              <p class="section-lede">Share a plan and any self-learner can adopt it for free. Your progress, notes, keys, billing, and session dates stay private.</p>
              <div class="action-row"><button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-publication-preview">Share your first syllabus</button></div>
            </div>`}
          </section>

          <section class="settings-section" id="settings-ai" aria-labelledby="settings-ai-title" data-byok-mode="${escapeHtml(byokState.mode)}" data-primary-credential="${escapeHtml(effectivePrimaryRef)}" data-has-active-keys="${activeByokCredentials.length > 0}" data-allow-hosted-fallback="${byokState.allowHostedFallback}" data-opaque-surface="true">
            <div class="settings-section-head">
              <div>
                <h2 id="settings-ai-title">AI providers (BYOK)</h2>
                <p class="section-lede">Save your API key, choose your preferred model per provider, and mark one Primary provider for synthesis, diagnostics, and native web search grounding.</p>
                <p class="row-meta">${escapeHtml(byokState.serverCustodyDisclosure)}</p>
              </div>
            </div>
            <div tabindex="0" role="region" aria-labelledby="settings-ai-title" class="providers-table-wrapper">
              <table class="providers-data-table">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Model</th>
                    <th scope="col">API key</th>
                    <th scope="col">Status</th>
                    <th scope="col" class="provider-actions-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${(["openai", "anthropic", "google_gemini"] as const).map((providerId) => {
                    const cred = byokState.credentials.find((c) => c.provider_id === providerId);
                    const hasKey = Boolean(cred && cred.status === "active" && cred.masked_suffix);
                    const defaultCredRef =
                      cred?.credential_ref ??
                      (providerId === "openai" ? "cred-openai-1" : providerId === "anthropic" ? "cred-anthropic-1" : "cred-gemini-1");
                    const isPrimary = Boolean(hasKey && cred && cred.credential_ref === effectivePrimaryRef);
                    const isEditing = inputState.editingCredentialProviderId === providerId;
                    const providerTitle = providerId === "openai" ? "OpenAI" : providerId === "anthropic" ? "Anthropic" : "Google Gemini";
                    const capabilitySubtitle = providerId === "openai"
                      ? "Responses API · Web search"
                      : providerId === "anthropic"
                        ? "Messages API · Web search"
                        : "Google Search grounding";
                    const modelOptions: ReadonlyArray<{ readonly id: string; readonly label: string }> =
                      DESIGNATED_AI_MODELS
                        .filter((m) => m.providerId === providerId)
                        .map((m) => ({ id: m.modelId, label: m.modelLabel }));
                    const selectedModelId =
                      inputState.providerModels?.[providerId] ?? modelOptions[0]?.id ?? "";
                    const keyPrefix = providerId === "openai" ? "sk-proj-" : providerId === "anthropic" ? "sk-ant-" : "AIzaSy-";
                    const inputId = providerId === "openai" ? "byok-key" : `byok-key-${providerId}`;
                    const statusTone = !hasKey
                      ? (cred && cred.status !== "active" ? cred.status : "unconfigured")
                      : isPrimary
                        ? "active"
                        : "standby";
                    const statusLabel = !hasKey
                      ? (cred && cred.status !== "active" ? humanize(cred.status) : "No key")
                      : isPrimary
                        ? "Primary"
                        : "Standby";
                    const logoSvg = providerId === "openai"
                      ? `<svg class="provider-logo-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.75a4.75 4.75 0 0 1 4.46 3.12 4.75 4.75 0 0 1 4.1 6.72 4.75 4.75 0 0 1-2.56 6.46A4.75 4.75 0 0 1 12 21.25a4.75 4.75 0 0 1-6-2.2 4.75 4.75 0 0 1-2.56-6.46 4.75 4.75 0 0 1 4.1-6.72A4.75 4.75 0 0 1 12 2.75Z"/><polygon points="12 7.5 15.9 9.75 15.9 14.25 12 16.5 8.1 14.25 8.1 9.75"/></svg>`
                      : providerId === "anthropic"
                        ? `<svg class="provider-logo-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 18.5 9.6 5.5h1.5l5.1 13"/><path d="M6.5 14.2h7.4"/><path d="M15.8 5.5 20 18.5"/></svg>`
                        : `<svg class="provider-logo-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2.25c.62 4.92 4.83 9.13 9.75 9.75-4.92.62-9.13 4.83-9.75 9.75-.62-4.92-4.83-9.13-9.75-9.75 4.92-.62 9.13-4.83 9.75-9.75Z"/></svg>`;
                    const keyCellHtml = isEditing
                      ? `<div class="provider-key-group" data-primary="${isPrimary}" data-editing="true">
                        <input id="${escapeHtml(inputId)}" class="provider-key-input" name="provider-key-${escapeHtml(providerId)}" type="${keyVisible ? "text" : "password"}" aria-label="${escapeHtml(providerTitle)} API key" placeholder="${escapeHtml(hasKey && cred ? `${keyPrefix}••••••••${cred.masked_suffix}` : `Paste ${keyPrefix}... key`)}" autocomplete="off" spellcheck="false" data-transient-key="true" data-provider-id="${escapeHtml(providerId)}" value="">
                        <button type="button" class="provider-key-apply-btn" data-action="replace-key" data-provider-id="${escapeHtml(providerId)}" data-credential-ref="${escapeHtml(defaultCredRef)}" aria-label="Save ${escapeHtml(providerTitle)} API key" title="Save API key">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                        <button type="button" class="provider-key-cancel-btn" data-action="cancel-edit-key" data-provider-id="${escapeHtml(providerId)}" aria-label="Cancel editing ${escapeHtml(providerTitle)} API key" title="Cancel">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>`
                      : hasKey && cred
                        ? `<div class="provider-key-readonly" data-primary="${isPrimary}">
                        <code class="provider-key-masked" aria-label="Configured ${escapeHtml(providerTitle)} API key">${escapeHtml(`${keyPrefix}••••••••${cred.masked_suffix}`)}</code>
                        <button type="button" class="provider-compact-btn provider-edit-key-btn" data-action="edit-provider-key" data-provider-id="${escapeHtml(providerId)}" data-credential-ref="${escapeHtml(cred.credential_ref)}" aria-label="Edit ${escapeHtml(providerTitle)} API key">Edit</button>
                      </div>`
                        : `<div class="provider-key-readonly" data-empty="true">
                        <span class="provider-key-empty">No API key set</span>
                        <button type="button" class="provider-compact-btn provider-edit-key-btn" data-action="edit-provider-key" data-provider-id="${escapeHtml(providerId)}" data-credential-ref="${escapeHtml(defaultCredRef)}" aria-label="Add ${escapeHtml(providerTitle)} API key">+ Add key</button>
                      </div>`;
                    return `<tr class="provider-row" data-credential-ref="${escapeHtml(hasKey && cred ? cred.credential_ref : "")}" data-provider-id="${escapeHtml(providerId)}" data-selected-model="${escapeHtml(selectedModelId)}" data-primary="${isPrimary}" data-has-key="${hasKey}" data-editing-key="${isEditing}">
                    <th scope="row" class="provider-primary-cell">
                      <div class="provider-identity">
                        <span class="provider-brand-tile" data-provider="${escapeHtml(providerId)}" data-primary="${isPrimary}" aria-hidden="true">${logoSvg}</span>
                        <div class="provider-text">
                          <span class="provider-name">${escapeHtml(providerTitle)}</span>
                          <span class="row-meta">${escapeHtml(capabilitySubtitle)}</span>
                        </div>
                      </div>
                    </th>
                    <td class="provider-model-cell">
                      <select id="provider-model-${escapeHtml(providerId)}" class="provider-model-select" name="provider-model-${escapeHtml(providerId)}" aria-label="${escapeHtml(providerTitle)} model" data-action="set-provider-model" data-provider-id="${escapeHtml(providerId)}" data-primary="${isPrimary}">
                        ${modelOptions.map((opt) => `<option value="${escapeHtml(opt.id)}"${opt.id === selectedModelId ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                      </select>
                    </td>
                    <td class="provider-key-cell">
                      ${keyCellHtml}
                      ${cred?.etag ? `<span class="st-sr"> · ${escapeHtml(cred.etag)}</span>` : ""}
                    </td>
                    <td class="provider-status-cell">
                      <span class="provider-status-inline" data-primary="${isPrimary}">
                        ${isPrimary
                          ? `<svg class="provider-star-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.4 14.88 8.23l6.44.94-4.66 4.54 1.1 6.41L12 17.09l-5.76 3.03 1.1-6.41L2.68 9.17l6.44-.94L12 2.4Z"/></svg>`
                          : `<span class="status-dot" data-status="${escapeHtml(statusTone)}" aria-hidden="true"></span>`}
                        <span class="status-text" data-status="${escapeHtml(statusTone)}">${escapeHtml(statusLabel)}</span>
                      </span>
                    </td>
                    <td class="provider-actions-cell">
                      <div class="row-actions provider-row-actions">
                        ${hasKey && cred && !isPrimary ? `<button type="button" class="provider-compact-btn" data-action="set-primary-key" data-credential-ref="${escapeHtml(cred.credential_ref)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>Set primary</span></button>` : ""}
                        ${hasKey && cred ? `<button type="button" class="provider-icon-btn provider-remove-btn" data-action="delete-connection" data-provider-id="${escapeHtml(providerId)}" data-credential-ref="${escapeHtml(cred.credential_ref)}" aria-label="Remove ${escapeHtml(providerTitle)} key" title="Remove key">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>` : `<span class="row-meta provider-no-actions">—</span>`}
                      </div>
                    </td>
                  </tr>`;
                  }).join("\n")}
                </tbody>
              </table>
            </div>
            ${activeByokCredentials.length === 0 ? `<p class="provider-empty-banner" role="status">No API keys configured. Click <strong>+ Add key</strong> on OpenAI, Anthropic, or Google Gemini above to enable AI syllabus synthesis and web search grounding.</p>` : ""}${"\n            "}${keyActionNote ? `<p class="section-lede" role="status">${escapeHtml(keyActionNote)}</p>` : ""}
            <details class="settings-disclosure" id="byok-add">
              <summary>Custody, rotation &amp; billing details</summary>
              <p class="disclosure-text">${escapeHtml(byokState.externalBillingDisclosure)} You act directly as the API account holder with your chosen provider (OpenAI, Anthropic, or Google) under their respective Terms of Service and direct billing. Saving a key does not run a chargeable test. Applying a new key updates future jobs while queued jobs stay on their active key version. Removing a key deletes this app's encrypted copy and does not revoke the key at the issuer.</p>
            </details>
            <details class="settings-disclosure" id="hosted-wallet-panel"${inputState.billingNotice ? " open" : ""}>
              <summary>Hosted AI credit wallet (optional) · ${escapeHtml(formatMinorCurrency(billingState.wallet.available_minor, billingState.wallet.currency))} available</summary>
              <p class="disclosure-text">BYOK inference incurs $0.00 platform fees. Optional hosted credits cover AI synthesis and dynamic concept checks when you prefer managed inference without storing a personal provider key. Reserved holds: ${escapeHtml(formatMinorCurrency(billingState.wallet.reserved_minor, billingState.wallet.currency))}.</p>
              <div class="action-row wallet-topup-actions">
                <button type="button" class="btn-secondary" data-action="start-hosted-checkout" data-amount-minor="1000">Top up $10.00</button>
                <button type="button" class="btn-secondary" data-action="start-hosted-checkout" data-amount-minor="2500">Top up $25.00</button>
              </div>
              ${inputState.billingNotice ? `<p class="section-lede" id="settings-billing-notice" role="status">${escapeHtml(inputState.billingNotice)}</p>` : ""}
            </details>
          </section>

          <section class="settings-section settings-card" id="settings-schedule" data-opaque-surface="true">
            <div class="settings-section-head">
              <div>
                <h2>Reminders</h2>
                <p class="row-meta">${escapeHtml(timezoneLabel)} (<code>${escapeHtml(reminderState.timezone)}</code>)</p>
              </div>
              <label class="switch-field switch-field-inline"><span>Enable reminders</span><input type="checkbox" class="ui-switch" data-action="toggle-reminders"${remindersOn ? " checked" : ""}></label>
            </div>
            <div class="reminder-gcal-bar">
              <label class="field reminder-timezone-field" for="reminder-timezone">Time zone
                <select id="reminder-timezone" name="reminder-timezone" data-action="set-reminder-timezone">
                  ${REMINDER_TIMEZONES.map((tz) => `<option value="${escapeHtml(tz.id)}"${tz.id === reminderState.timezone ? " selected" : ""}>${escapeHtml(tz.label)} (${escapeHtml(tz.id)})</option>`).join("")}
                </select>
              </label>
              <label class="field" for="reminder-weekday-time">Weekdays (Mon–Fri)
                <input id="reminder-weekday-time" type="time" name="weekday-time" data-action="set-reminder-schedule" data-reminder-field="weekdayTime" value="${escapeHtml(reminderWeekdayTime)}">
              </label>
              <label class="field" for="reminder-weekend-time">Weekends (Sat–Sun)
                <input id="reminder-weekend-time" type="time" name="weekend-time" data-action="set-reminder-schedule" data-reminder-field="weekendTime" value="${escapeHtml(reminderWeekendTime)}">
              </label>
              <label class="field" for="reminder-lead-time">Notify me
                <select id="reminder-lead-time" name="lead-time" data-action="set-reminder-schedule" data-reminder-field="leadMinutes">
                  <option value="0"${reminderLeadMinutes === "0" ? " selected" : ""}>At start time</option>
                  <option value="10"${reminderLeadMinutes === "10" ? " selected" : ""}>10 minutes before</option>
                  <option value="15"${reminderLeadMinutes === "15" ? " selected" : ""}>15 minutes before</option>
                  <option value="30"${reminderLeadMinutes === "30" ? " selected" : ""}>30 minutes before</option>
                  <option value="60"${reminderLeadMinutes === "60" ? " selected" : ""}>1 hour before</option>
                </select>
              </label>
            </div>
            <div class="action-row reminder-export-row">
              <a class="btn-secondary" href="/api/schedule.ics" download="syllabus-schedule.ics">Export calendar (.ics)</a>
            </div>
          </section>

          <section class="settings-section settings-card" id="settings-privacy" data-opaque-surface="true">
            <div class="settings-privacy-row">
              <div>
                <h2>Privacy &amp; account</h2>
                <p class="row-meta">Download a portable archive of your syllabi and study history, or permanently delete your account.</p>
              </div>
              <button type="button" class="btn-danger" data-action="open-dialog" data-dialog-id="dialog-account-deletion">Export &amp; deletion</button>
            </div>
            <details class="settings-disclosure">
              <summary>Export scope, retention &amp; license terms</summary>
              <p class="disclosure-text">Export includes ${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}. It excludes ${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}.</p>
              <p class="disclosure-text">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
              <p class="disclosure-text">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
              <p class="disclosure-text">${escapeHtml(privacyState.disclosures.financialAuditRetention)} Open-source software licensed under Apache-2.0. Shared syllabus structures in Explore are licensed under CC BY 4.0, while linked books, papers, and videos remain governed by their original publishers.</p>
            </details>
          </section>
        </div>
      </section>
      ${adminConsoleOpen ? renderToString(h(AdminResourcesView, {
        account,
        catalogResources,
        adminSourceFilter,
        adminCategoryFilter,
        adminSearchQuery,
        adminRemovedResourceIds,
        adminResourceOverrides,
        adminNotice,
      })) : ""}`}
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
    const defaultCandidateIds = buildIndexedMaterialCandidates(catalogResources, intakeSubject, intakeTopics, intakeMaterials, intakeGoalTitle)
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
    const activePrimaryCred =
      activeByokCredentials.find((c) => c.credential_ref === effectivePrimaryRef) ??
      activeByokCredentials[0];
    const designatedProviderId = activePrimaryCred?.provider_id ?? "openai";
    const designatedModelId =
      inputState.providerModels?.[designatedProviderId] ?? CHEAP_MODEL_BY_PROVIDER[designatedProviderId as keyof typeof CHEAP_MODEL_BY_PROVIDER];
    const configuredProviderIds = activeByokCredentials.map((c) => c.provider_id);
    return renderToString(
      h(NewSyllabusDialog, {
        open: openDialogId === "dialog-new-syllabus",
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
        designatedProviderId,
        designatedModelId,
        configuredProviderIds,
      }),
    );
  })()}

  ${renderToString(
    h(ResourceEditorDialog, {
      open: openDialogId === "dialog-resource-editor",
      mode: inputState.resourceEditorMode ?? "ingest",
      selectedPlan,
      allPlans: plans,
      catalogResources: {
        ...(catalogResourcesJson.global_discovered_resources as Readonly<Record<string, CatalogResourceMetadataInput>>),
        ...catalogResources,
      },
      userLibraryResourceIds: inputState.userLibraryResourceIds ?? [],
      removedResourceIds: adminRemovedResourceIds,
      editingResourceId: inputState.editingResourceId ?? null,
      targetSyllabusId: inputState.editingResourceSyllabusId ?? selectedPlan.syllabusId,
      targetModuleId: inputState.editingResourceModuleId ?? null,
      targetActivityId: inputState.editingResourceActivityId ?? null,
      rawDraft: inputState.resourceRawDraft ?? "",
      editorError: inputState.resourceEditorError ?? null,
    }),
  )}

  <dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title"${dialogOpen("dialog-adaptation-diff")} data-opaque-surface="true">
    <form method="dialog" class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-adaptation-diff-title">Adaptation Diff Preview (${escapeHtml(adaptationDiff.proposal_id)})</h2>${DIALOG_CLOSE_BUTTON}</header>
      ${adaptationBody}
    </form>
  </dialog>

  ${renderToString(h(AdoptSyllabusDialog, {
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
    publishedFromHere: listings.some((listing) => listing.ownerAccountId === account.accountId && listing.sourceSyllabusId === selectedPlan.syllabusId),
    originListing,
  }))}

  <dialog id="dialog-unpublish" closedby="any" aria-labelledby="dialog-unpublish-title"${dialogOpen("dialog-unpublish")} data-publication-id="${escapeHtml(inputState.unpublishPublicationId ?? "")}" data-opaque-surface="true">
    <div class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-unpublish-title">Unpublish</h2><form method="dialog">${DIALOG_CLOSE_BUTTON}</form></header>
      <p class="prose warning-copy">Unpublish makes all public revisions of this publication unavailable through app-controlled publication routes. It does not erase permitted private copies or external copies. Historical votes are not transferred.</p>
      <footer class="dialog-footer">
        <form method="dialog"><button type="submit" class="btn-secondary" data-action="close-dialog" autofocus>Cancel</button></form>
        <button type="button" class="btn-danger" data-action="confirm-unpublish-syllabus" data-publication-id="${escapeHtml(inputState.unpublishPublicationId ?? "")}">Unpublish syllabus</button>
      </footer>
    </div>
  </dialog>

  <dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title"${dialogOpen("dialog-account-deletion")} data-opaque-surface="true">
    <div class="dialog-surface">
      <header class="dialog-header"><h2 id="dialog-account-deletion-title">Account Export &amp; Destructive Deletion Confirmation</h2><form method="dialog">${DIALOG_CLOSE_BUTTON}</form></header>
      <p>Export Scope Included: <code>${escapeHtml(privacyState.disclosures.exportScope.includedRecords.join(", "))}</code></p>
      <p>Export Scope Excluded: <code>${escapeHtml(privacyState.disclosures.exportScope.excludedRecords.join(", "))}</code></p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.byokDeletionVsProviderRevocation)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.publicPublicationsImpact)}</p>
      <p class="disclosure-text">${escapeHtml(privacyState.disclosures.financialAuditRetention)} Deletion does not promise immediate removal from every backup.</p>
      <footer class="dialog-footer">
        <a class="btn-secondary" href="/api/account/export" download="syllabus-account-export.json">Download export (.json)</a>
        <form method="dialog"><button type="submit" class="btn-secondary" data-action="close-dialog" autofocus>Cancel</button></form>
        <button type="button" class="btn-danger" data-action="confirm-delete-account">Delete account permanently</button>
      </footer>
    </div>
  </dialog>

  <dialog id="dialog-avatar-cropper" class="modal-dialog modal-dialog-sm avatar-cropper-dialog" closedby="any" aria-labelledby="dialog-avatar-cropper-title"${dialogOpen("dialog-avatar-cropper")} data-opaque-surface="true">
    <div class="dialog-surface avatar-cropper-surface">
      <header class="dialog-header">
        <div>
          <h2 id="dialog-avatar-cropper-title">Edit profile photo</h2>
          <p class="row-meta">Drag to reposition and use the slider to resize inside the circular frame.</p>
        </div>
        <form method="dialog">${DIALOG_CLOSE_BUTTON}</form>
      </header>
      <div class="avatar-cropper-body">
        <div class="avatar-cropper-stage">
          <img id="avatar-cropper-source" class="avatar-cropper-source" src="${escapeHtml(account.avatarUrl ?? `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#DDE6F9"/><circle cx="160" cy="160" r="118" fill="#C7D7F7"/><text x="160" y="184" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="76" font-weight="700" fill="#0B5CAD">${initialsOf(account)}</text></svg>`)}`)}" alt="Profile photo crop preview" data-cropper-target="avatar">
        </div>
        <div class="avatar-cropper-controls">
          <label class="btn-secondary avatar-upload-btn" for="avatar-file-input">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Upload photo</span>
            <input id="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp" class="st-sr">
          </label>
          <label class="field avatar-zoom-field" for="avatar-zoom-range">
            <span>Zoom</span>
            <input id="avatar-zoom-range" type="range" min="1" max="3" step="0.05" value="1" data-cropper-zoom="true">
          </label>
        </div>
        <p class="profile-photo-caption avatar-cropper-meta">Supported formats: PNG, JPG, WEBP<br>Maximum file size: 5MB</p>
      </div>
      <footer class="dialog-footer">
        <form method="dialog"><button type="submit" class="btn-secondary" data-action="close-dialog">Cancel</button></form>
        <button type="button" class="btn-primary" data-action="save-avatar-crop">Apply photo</button>
      </footer>
    </div>
  </dialog>

  ${(() => {
    const rawObjectives = rawListOf(syllabus, "objectives");
    const demObjIds = new Set(
      proficiency.objective_evidence.filter((e) => e.status === "demonstrated").map((e) => e.objective_id),
    );
    const defaultDiagObj =
      rawObjectives.find((o) => !demObjIds.has(String(o["objective_id"] ?? ""))) ?? rawObjectives[0];
    const activeDiagObjId =
      inputState.diagnosticObjectiveId && rawObjectives.some((o) => o["objective_id"] === inputState.diagnosticObjectiveId)
        ? inputState.diagnosticObjectiveId
        : (typeof defaultDiagObj?.["objective_id"] === "string" ? defaultDiagObj["objective_id"] : null);
    const activeRawObj = activeDiagObjId
      ? rawObjectives.find((o) => o["objective_id"] === activeDiagObjId)
      : undefined;
    const diagQuestion = activeRawObj
      ? buildDiagnosticQuestionForObjective({
          syllabusTitle: goalTitleOf(syllabus),
          subject: typeof syllabus["subject"] === "string" ? syllabus["subject"] : selectedPlan.domain,
          objectiveId: String(activeRawObj["objective_id"] ?? ""),
          objectiveVersionId:
            typeof activeRawObj["objective_version_id"] === "string"
              ? activeRawObj["objective_version_id"]
              : undefined,
          objectiveTitle:
            typeof activeRawObj["title"] === "string"
              ? activeRawObj["title"]
              : String(activeRawObj["objective_id"] ?? ""),
          description:
            typeof activeRawObj["description"] === "string" ? activeRawObj["description"] : undefined,
          successCriterion:
            typeof activeRawObj["success_criterion"] === "string"
              ? activeRawObj["success_criterion"]
              : undefined,
        })
      : null;
    const nextUnassessedObj = rawObjectives.find(
      (o) =>
        o["objective_id"] !== activeDiagObjId &&
        !demObjIds.has(String(o["objective_id"] ?? "")),
    ) ?? rawObjectives.find((o) => o["objective_id"] !== activeDiagObjId);
    const nextDiagObjId =
      typeof nextUnassessedObj?.["objective_id"] === "string"
        ? nextUnassessedObj["objective_id"]
        : null;
    return [
      renderToString(
        h(DiagnosticCheckDialog, {
          open: openDialogId === "dialog-diagnostic-check",
          question: diagQuestion,
          selectedChoice: inputState.diagnosticChoice ?? null,
          feedback: inputState.diagnosticFeedback ?? null,
          isDemonstrated: Boolean(activeDiagObjId && demObjIds.has(activeDiagObjId)),
          assessedCount: rawObjectives.filter((o) => demObjIds.has(String(o["objective_id"] ?? ""))).length,
          totalCount: rawObjectives.length,
          nextObjectiveId: nextDiagObjId,
        }),
      ),
      renderToString(
        h(SyllabusStructureEditorDialog, {
          open: openDialogId === "dialog-syllabus-editor",
          mode: inputState.syllabusEditMode ?? "syllabus",
          syllabusId: selectedPlan.syllabusId,
          syllabus,
          editingModuleId: inputState.editingSyllabusModuleId ?? selectedModuleId ?? null,
          editingActivityId: inputState.editingSyllabusActivityId ?? selectedActivityId ?? null,
          editorError: inputState.syllabusEditorError ?? null,
          editorNotice: inputState.syllabusEditorNotice ?? null,
        }),
      ),
      renderToString(
        h(DeleteSyllabusDialog, {
          open: openDialogId === "dialog-delete-syllabus",
          syllabusId: selectedPlan.syllabusId,
          syllabusTitle: goalTitleOf(syllabus),
        }),
      ),
    ].join("\n  ");
  })()}`}

  ${renderToString(h(AuthDialog, {
    open: openDialogId === "dialog-auth",
    authStatus,
    account,
    returnTo,
    authNotice,
    authMode,
    authPasswordVisible,
    resetEmail: inputState.authResetEmail,
  }))}

  <script data-dialog-light-dismiss-fallback="true">
${getDialogLightDismissFallbackScript()}
  </script>
</div>`;
}