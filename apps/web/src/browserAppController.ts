import { h } from "preact";
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
import {
  DEFAULT_ADAPTATION_PROPOSAL,
  DEFAULT_BYOK_CREDENTIALS,
  DEFAULT_CATALOG_RESOURCES,
  DEFAULT_SYNTHETIC_PROFICIENCY,
  DEFAULT_WALLET,
  MARKETPLACE_LISTINGS,
  OPEN_ACTIONS,
  RAG_PLAN,
  buildTodayFor,
  planIn,
  plansFor,
  renderSyllabusWebAppHtml,
  resolveActivityConceptCheck,
  rubricOf,
  stepOf,
  type PasskeySummaryItem,
  type SyllabusWebAppStateInput,
} from "./renderWebAppHtml.ts";

export function createSyllabusWebAppController(initialState: SyllabusWebAppStateInput = {}) {
  let topLevel: TopLevelDestination = initialState.topLevel ?? "Learn";
  let learnSubDestination: LearnSubDestination = initialState.learnSubDestination ?? "Today";
  let planView: PlanSynchronizedView = initialState.planView ?? "Map";
  let authStatus: AuthStatus = initialState.authStatus ?? "authenticated";
  let account: Account = initialState.account ?? PERSONAS.learner;
  let returnTo: ReturnDestination | null = initialState.returnTo ?? null;
  let authNotice: string | null = initialState.authNotice ?? null;
  let authMode: AuthMode = initialState.authMode ?? "login";
  let authPasswordVisible: boolean = initialState.authPasswordVisible ?? false;
  let passkeys: PasskeySummaryItem[] = [...(initialState.passkeys ?? [])];
  let passkeyNotice: string | null = initialState.passkeyNotice ?? null;
  let profileNotice: string | null = initialState.profileNotice ?? null;
  let marketplaceFilters: MarketplaceFilters = { ...NO_MARKETPLACE_FILTERS, ...initialState.marketplaceFilters };
  let marketplaceSort: MarketplaceSort = initialState.marketplaceSort ?? "top_upvoted";
  let marketplaceTopicsExpanded = initialState.marketplaceTopicsExpanded ?? false;
  let votes: Vote[] = [...(initialState.votes ?? [])];
  let adoptions: Adoption[] = [...(initialState.adoptions ?? [])];
  let publishedListings: MarketplaceListing[] = [...(initialState.publishedListings ?? [])];
  let unpublishedPublicationIds: string[] = [...(initialState.unpublishedPublicationIds ?? [])];
  let unpublishPublicationId: string | null = initialState.unpublishPublicationId ?? null;
  let adoptPublicationId: string | null = initialState.adoptPublicationId ?? null;
  let resourceScope: ResourceScope = initialState.resourceScope ?? "selected";
  let resourceCategory: ResourceCategory = initialState.resourceCategory ?? "All";
  let adminConsoleOpen: boolean = initialState.adminConsoleOpen ?? false;
  let adminSourceFilter: AdminDiscoverySource = initialState.adminSourceFilter ?? "All";
  let adminCategoryFilter: ResourceCategory = initialState.adminCategoryFilter ?? "All";
  let adminSearchQuery: string = initialState.adminSearchQuery ?? "";
  let adminRemovedResourceIds: string[] = [...(initialState.adminRemovedResourceIds ?? [])];
  let adminResourceOverrides: Record<string, Partial<CatalogResourceMetadataInput>> = {
    ...(initialState.adminResourceOverrides ?? {}),
  };
  let adminNotice: string | null = initialState.adminNotice ?? null;
  const listings = (): readonly MarketplaceListing[] =>
    [...MARKETPLACE_LISTINGS, ...publishedListings].filter(
      (entry) => !unpublishedPublicationIds.includes(entry.publicationId),
    );
  const adoptListing = (): MarketplaceListing | undefined => listings().find((entry) => entry.publicationId === adoptPublicationId);
  let adoptModuleIds: string[] = [...(initialState.adoptModuleIds ?? unitIdsOf(adoptListing()))];
  let generatedPlans: ActiveSyllabus[] = [...(initialState.generatedPlans ?? [])];
  let syllabusOverrides: Record<string, Record<string, unknown>> = {
    ...(initialState.syllabusOverrides ?? {}),
  };
  let scheduleOverrides: Record<string, Record<string, unknown>> = {
    ...(initialState.scheduleOverrides ?? {}),
  };
  let userLibraryResourceIds: string[] = [...(initialState.userLibraryResourceIds ?? [])];
  let resourceEditorMode: ResourceEditorMode = initialState.resourceEditorMode ?? "ingest";
  let editingResourceId: string | null = initialState.editingResourceId ?? null;
  let editingResourceSyllabusId: string | null = initialState.editingResourceSyllabusId ?? null;
  let editingResourceModuleId: string | null = initialState.editingResourceModuleId ?? null;
  let editingResourceActivityId: string | null = initialState.editingResourceActivityId ?? null;
  let resourceRawDraft: string = initialState.resourceRawDraft ?? "";
  let resourceEditorError: string | null = initialState.resourceEditorError ?? null;
  let resourceNotice: string | null = initialState.resourceNotice ?? null;
  let dynamicConceptChecks: Record<string, ConceptCheck> = {
    ...(initialState.dynamicConceptChecks ?? {}),
  };
  let conceptCheckSeed: number = initialState.conceptCheckSeed ?? 1;
  let proficiencyOverrides: Record<string, ProficiencyOverrideEntry> = {
    ...(initialState.proficiencyOverrides ?? {}),
  };
  let deletedSyllabusIds: string[] = [...(initialState.deletedSyllabusIds ?? [])];
  let diagnosticObjectiveId: string | null = initialState.diagnosticObjectiveId ?? null;
  let diagnosticChoice: string | null = initialState.diagnosticChoice ?? null;
  let diagnosticFeedback: { readonly passed: boolean; readonly message: string } | null =
    initialState.diagnosticFeedback ?? null;
  let syllabusEditMode: SyllabusEditMode = initialState.syllabusEditMode ?? "syllabus";
  let editingSyllabusModuleId: string | null = initialState.editingSyllabusModuleId ?? null;
  let editingSyllabusActivityId: string | null = initialState.editingSyllabusActivityId ?? null;
  let syllabusEditorError: string | null = initialState.syllabusEditorError ?? null;
  let syllabusEditorNotice: string | null = initialState.syllabusEditorNotice ?? null;
  let authResetEmail: string = initialState.authResetEmail ?? "";
  let emailVerified: boolean = initialState.emailVerified ?? false;
  let emailVerificationPending: boolean = initialState.emailVerificationPending ?? false;
  let wallet: HostedCreditWalletSnapshot = initialState.wallet ?? DEFAULT_WALLET;
  let billingNotice: string | null = initialState.billingNotice ?? null;
  const currentPlans = () =>
    plansFor(account.accountId, adoptions, listings(), generatedPlans, syllabusOverrides, scheduleOverrides, deletedSyllabusIds);
  const isMyPlan = (syllabusId: unknown): syllabusId is string => currentPlans().some((plan) => plan.syllabusId === syllabusId);
  // Input overrides replace the selected plan's syllabus and schedule, the same rule the render applies.
  let selectedSyllabusId = planIn(currentPlans(), initialState.selectedSyllabusId).syllabusId;
  const planData = (): ActiveSyllabus => {
    const plan = planIn(currentPlans(), selectedSyllabusId);
    return {
      ...plan,
      syllabus: syllabusOverrides[plan.syllabusId] ?? initialState.syllabus ?? plan.syllabus,
      schedule: scheduleOverrides[plan.syllabusId] ?? initialState.schedule ?? plan.schedule,
    };
  };
  const openingStep = stepOf(planData().syllabus, initialState.selectedActivityId);
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
  let completedSubtaskIds: string[] = [...(initialState.completedSubtaskIds ?? [])];
  let remindersEnabled = initialState.remindersEnabled ?? true;
  let remindersPaused = initialState.remindersPaused ?? false;
  let reminderTimezone = initialState.reminderTimezone ?? "America/New_York";
  let reminderWeekdayTime = initialState.reminderWeekdayTime ?? "19:00";
  let reminderWeekendTime = initialState.reminderWeekendTime ?? "10:00";
  let reminderLeadMinutes = initialState.reminderLeadMinutes ?? "15";
  let keyVisible = initialState.keyVisible ?? false;
  let byokCredentials: MaskedCredentialRecord[] = [...(initialState.byokCredentials ?? DEFAULT_BYOK_CREDENTIALS)];
  let editingCredentialProviderId: string | null = initialState.editingCredentialProviderId ?? null;
  let primaryCredentialRef =
    initialState.primaryCredentialRef ??
    byokCredentials.find((c) => c.status === "active")?.credential_ref ??
    "";
  let providerModels: Record<string, string> = {
    ...CHEAP_MODEL_BY_PROVIDER,
    ...(initialState.providerModels ?? {}),
  };
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

  const baseProficiency = initialState.proficiency ?? DEFAULT_SYNTHETIC_PROFICIENCY;
  const effectiveProficiencyOf = (syl: Record<string, unknown>) =>
    buildEffectiveProficiency(baseProficiency, syl, proficiencyOverrides);
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
      buildIndexedMaterialCandidates(catalogResources, intakeSubject, intakeTopics, intakeMaterials, intakeGoalTitle).map(
        (m) => m.resourceVersionId,
      )),
  ];
  let intakeSkippedResourceIds: string[] = [...(initialState.intakeSkippedResourceIds ?? [])];
  let lastPipelineReceipt: IntakePipelineExecutionReceipt | null = initialState.lastPipelineReceipt ?? null;
  let flowOrder: FlowOrder = initialState.flowOrder ?? plannedFlowOrder(planData().syllabus);
  let deepDive: DeepDiveMode = initialState.deepDive ?? "included";
  let spacedReview: SpacedReviewMode = initialState.spacedReview ?? "included";

  // A learner's explicit Not started or In progress choice overrides the initial state. Events replay after it,
  // so a later Done still wins. Today is rebuilt when events are dropped, so counts and minutes stay exact.
  const statusOverrides = new Map<string, ActivityExecutionStatus>();
  let recordedProgressEvents: ProgressEventInput[] = [...(initialState.recordedProgressEvents ?? [])];
  const activityStatesInput = (): Readonly<Record<string, ActivityExecutionStatus>> =>
    ({ ...(initialState.activityStates ?? {}), ...Object.fromEntries(statusOverrides) });
  const todayFor = (plan: ActiveSyllabus) => buildTodayFor({
    syllabus: plan.syllabus, schedule: plan.schedule, proficiency: effectiveProficiencyOf(plan.syllabus), catalogResources,
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
    syncSubtasks(activityId, status);
    if (status === "completed") {
      if (!isClosed(todayController.getState().activityExecutionStates[activityId] ?? "not_started")) recordCompletion(activityId);
      return getState();
    }
    statusOverrides.set(activityId, status);
    recordedProgressEvents = recordedProgressEvents.filter((ev) => (ev.activityId ?? ev.activity_id) !== activityId);
    todayController = buildToday();
    return getState();
  }

  // The activity's subtask ids, from the same list the drawer renders.
  function subtaskIdsOf(activityId: string): readonly string[] {
    const plan = planData();
    const modules = buildCurrentPlanModel().outlineModules;
    const activity = modules.flatMap((mod) => mod.activities).find((act) => act.activityId === activityId);
    if (!activity) return [];
    const conceptCheck = resolveActivityConceptCheck(plan, plan.syllabus, activityId, dynamicConceptChecks);
    return activitySubtasks(modules, activity, rubricOf(plan.syllabus, activityId), conceptCheck).map(({ subtaskId }) => subtaskId);
  }

  // A Done activity shows every subtask as checked, even one completed elsewhere, so a change starts from all of them.
  function checkedSubtasksOf(activityId: string): readonly string[] {
    const ids = subtaskIdsOf(activityId);
    const done = isClosed(todayController.getState().activityExecutionStates[activityId] ?? "not_started");
    return done ? ids : ids.filter((sid) => completedSubtaskIds.includes(sid));
  }

  // Not started clears the activity's checked subtasks, and Done checks them all. In progress keeps them as they are.
  function syncSubtasks(activityId: string, status: SettableStatus): void {
    if (status === "in_progress") return;
    const ids = subtaskIdsOf(activityId);
    completedSubtaskIds = [...completedSubtaskIds.filter((sid) => !ids.includes(sid)), ...(status === "completed" ? ids : [])];
  }

  // Checked subtasks set the status: none is Not started, some is In progress, and all is Done.
  function setSubtaskChecked(activityId: string, subtaskId: string, checked: boolean) {
    if (!signedIn()) return requireSignIn(placeOf(topLevel, learnSubDestination));
    const ids = subtaskIdsOf(activityId);
    if (!ids.includes(subtaskId)) return getState();
    const before = checkedSubtasksOf(activityId);
    const after = ids.filter((sid) => (sid === subtaskId ? checked : before.includes(sid)));
    completedSubtaskIds = [...completedSubtaskIds.filter((sid) => !ids.includes(sid)), ...after];
    return setActivityStatus(activityId, after.length === 0 ? "not_started" : after.length === ids.length ? "completed" : "in_progress");
  }

  const buildCurrentPlanModel = (): PlanMapAndOutlineModel => {
    const syl = planData().syllabus;
    return buildPlanMapAndOutlineModel({
      syllabus: syl, proficiency: effectiveProficiencyOf(syl), activityStates: todayController.getState().activityExecutionStates,
      catalogResources, viewportWidthPx, selectedModuleId, selectedActivityId, focusedNodeId, zoom,
    });
  };

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
  function selectSyllabus(syllabusId: string): void {
    if (syllabusId === selectedSyllabusId) return;
    selectedSyllabusId = syllabusId;
    resetPractice();
    const first = stepOf(planData().syllabus);
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
    authMode = "login";
    authPasswordVisible = false;
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
    completedSubtaskIds = [];
    resetPractice();
    keyVisible = false;
    editingCredentialProviderId = null;
    loadMoreNote = null;
    intakeNote = null;
    keyActionNote = null;
    profileNotice = null;
    passkeys = [];
    passkeyNotice = null;
    snoozeNote = null;
    rescheduleSessionId = null;
    rescheduleValue = null;
    depthOverrideReset = false;
    diagnosticControl = "active";
    adaptationChoice = "pending";
    adoptPublicationId = null;
    unpublishPublicationId = null;
    adoptModuleIds = [];
    resourceScope = "selected";
    resourceCategory = "All";
    adminConsoleOpen = false;
    adminSourceFilter = "All";
    adminCategoryFilter = "All";
    adminSearchQuery = "";
    adminRemovedResourceIds = [];
    adminResourceOverrides = {};
    adminNotice = null;
    generatedPlans = [];
    syllabusOverrides = {};
    scheduleOverrides = {};
    userLibraryResourceIds = [];
    resourceEditorMode = "ingest";
    editingResourceId = null;
    editingResourceSyllabusId = null;
    editingResourceModuleId = null;
    editingResourceActivityId = null;
    resourceRawDraft = "";
    resourceEditorError = null;
    resourceNotice = null;
    dynamicConceptChecks = {};
    conceptCheckSeed = 1;
    proficiencyOverrides = {};
    deletedSyllabusIds = [];
    diagnosticObjectiveId = null;
    diagnosticChoice = null;
    diagnosticFeedback = null;
    syllabusEditMode = "syllabus";
    editingSyllabusModuleId = null;
    editingSyllabusActivityId = null;
    syllabusEditorError = null;
    syllabusEditorNotice = null;
    authResetEmail = "";
    emailVerified = false;
    emailVerificationPending = false;
    wallet = DEFAULT_WALLET;
    billingNotice = null;
    intakeGoalTitle = "";
    lastPipelineReceipt = null;
    studyDetailOpen = false;
    openDialogId = null;
    selectedSyllabusId = RAG_PLAN.syllabusId;
    const first = stepOf(planData().syllabus);
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
    authPasswordVisible = false;
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
    signIn(
      Object.values(PERSONAS).find((persona) => persona.email === address) ?? {
        accountId: `account-${address}`,
        email: address,
        username: defaultUsernameOfEmail(address),
        role: "Learner",
      },
    );
  }

  function signUpWithEmail(email: string, password: string): void {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      authNotice = "Enter a valid email address.";
      authMode = "signup";
      openDialogId = "dialog-auth";
      return;
    }
    if (password.length < 8) {
      authNotice = "Use a password with at least 8 characters.";
      authMode = "signup";
      openDialogId = "dialog-auth";
      return;
    }
    signIn({
      accountId: `account-${address}`,
      email: address,
      username: defaultUsernameOfEmail(address),
      role: "Learner",
    });
  }

  // A guest browses public syllabi, so signing out lands on Explore.
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

  // Adoption makes a private draft and opens it in Today. Activation stays a separate, explicit step (@S59).
  function adopt(listing: MarketplaceListing): void {
    if (adoptModuleIds.length === 0) return;
    const moduleIds = adoptionScopeOf(listing, adoptModuleIds).resolvedModuleIds;
    adoptions = [...adoptions, { accountId: account.accountId, publicationId: listing.publicationId, moduleIds, active: false }];
    adoptPublicationId = null;
    adoptModuleIds = [];
    openDialogId = null;
    selectSyllabus(`adopted-${listing.publicationId}`);
    topLevel = "Learn";
    learnSubDestination = "Today";
  }

  function activateSelectedDraft(): void {
    adoptions = adoptions.map((adoption) => (adoption.accountId === account.accountId && `adopted-${adoption.publicationId}` === selectedSyllabusId
      ? { ...adoption, active: true } : adoption));
    generatedPlans = generatedPlans.map((plan) => (plan.syllabusId === selectedSyllabusId ? { ...plan, draft: false } : plan));
  }

  const publishedFromSelected = (): boolean =>
    listings().some((listing) => listing.ownerAccountId === account.accountId && listing.sourceSyllabusId === selectedSyllabusId);

  // Publishing adds an immutable public revision of the selected plan to Explore and My Publications (@S56).
  // The listing keeps the plan's structure and drops account, evidence, date, and reminder data (@S57).
  function publishSelectedPlan(): void {
    const plan = planData();
    const key = `${plan.syllabusId}-${account.accountId}`;
    const nextPubId = `publication-${key}`;
    const origin = listings().find((listing) => listing.publicationId === plan.publicationId && listing.ownerAccountId !== account.accountId);
    const tags = syllabusTagsOf(plan.syllabus, {
      subject: plan.domain,
      gateStyle: plan.assessmentMode,
      topicTags: origin?.topicTags,
    });
    unpublishedPublicationIds = unpublishedPublicationIds.filter((id) => id !== nextPubId);
    publishedListings = [
      ...publishedListings.filter((entry) => entry.publicationId !== nextPubId),
      {
        publicationId: nextPubId, revisionId: `public-revision-${key}-1`,
        subject: tags.subject, gateStyle: tags.gateStyle, topicTags: tags.topicTags, handle: handleOf(account),
        upvotes: 0, adoptions: 0, publishedAt: new Date().toISOString(),
        ownerAccountId: account.accountId, sourceSyllabusId: plan.syllabusId, basedOn: origin?.handle ?? null,
        syllabus: {
          ...plan.syllabus, account_id: "public-template",
          subject: tags.subject, gate_style: tags.gateStyle, topic_tags: tags.topicTags,
          objectives: rawListOf(plan.syllabus, "objectives").map((objective) => ({ ...objective, prior_evidence_refs: [] })),
        },
        schedule: {
          ...plan.schedule,
          sessions: rawListOf(plan.schedule, "sessions").map((session) => ({
            session_id: session["session_id"], duration_minutes: session["duration_minutes"], activity_ids: session["activity_ids"],
          })),
        },
      },
    ];
    openDialogId = null;
    topLevel = "Explore";
  }

  const getState = () => {
    const tState = todayController.getState();
    // Study minutes and completions count across every active plan, as the app header shows them.
    const allToday = currentPlans().map((plan) => (plan.syllabusId === selectedSyllabusId ? tState : todayFor(plan).getState()));
    return {
      topLevel, learnSubDestination, planView, selectedSyllabusId, selectedModuleId, selectedActivityId, focusedNodeId,
      zoom, viewportWidthPx, textScalePercent, themePreference, solidSurfaces, reduceMotion,
      activityStates: tState.activityExecutionStates,
      recordedProgressEvents: [...recordedProgressEvents] as readonly ProgressEventInput[],
      recordedReceipts: tState.recordedEvents,
      totalStudyMinutes: allToday.reduce((sum, today) => sum + today.totalStudyMinutes, 0),
      selfReportedCompletedCount: allToday.reduce((sum, today) => sum + today.selfReportedCompletedCount, 0),
      authStatus, account, returnTo, authNotice, authMode, authPasswordVisible,
      passkeys: [...passkeys] as readonly PasskeySummaryItem[], passkeyNotice,
      profileNotice, marketplaceFilters, marketplaceSort, marketplaceTopicsExpanded,
      votes: [...votes] as readonly Vote[], adoptions: [...adoptions] as readonly Adoption[],
      publishedListings: [...publishedListings] as readonly MarketplaceListing[],
      unpublishedPublicationIds: [...unpublishedPublicationIds] as readonly string[],
      unpublishPublicationId,
      adoptPublicationId, adoptModuleIds: [...adoptModuleIds] as readonly string[],
      resourceScope, resourceCategory,
      adminConsoleOpen,
      adminSourceFilter,
      adminCategoryFilter,
      adminSearchQuery,
      adminRemovedResourceIds: [...adminRemovedResourceIds] as readonly string[],
      adminResourceOverrides: { ...adminResourceOverrides } as Readonly<
        Record<string, Partial<CatalogResourceMetadataInput>>
      >,
      adminNotice,
      openDialogId, hintRequested, workedSolutionRevealed, practiceSubmitted, practiceChoice,
      skippedActivityIds: [...skippedActivityIds] as readonly string[],
      completedSubtaskIds: [...completedSubtaskIds] as readonly string[],
      remindersEnabled, remindersPaused, reminderTimezone,
      reminderWeekdayTime, reminderWeekendTime, reminderLeadMinutes,
      keyVisible,
      byokCredentials: [...byokCredentials] as readonly MaskedCredentialRecord[],
      primaryCredentialRef,
      editingCredentialProviderId,
      providerModels: { ...providerModels } as Readonly<Record<string, string>>,
      diagnosticControl, adaptationChoice,
      loadMoreNote, intakeNote, keyActionNote, snoozeNote, rescheduleSessionId, rescheduleValue,
      depthOverrideReset, studyDetailOpen, inspectorMode, flowOrder, deepDive, spacedReview,
      catalogResources, intakeGoalTitle, intakeSubject,
      intakeTopics: [...intakeTopics] as readonly string[],
      intakeDepth, intakeFlow, intakeMaterials, intakeWeeklyMinutes, intakeFitMode,
      intakeSelectedResourceIds: [...intakeSelectedResourceIds] as readonly string[],
      intakeSkippedResourceIds: [...intakeSkippedResourceIds] as readonly string[],
      generatedPlans: [...generatedPlans] as readonly ActiveSyllabus[],
      syllabusOverrides: { ...syllabusOverrides } as Readonly<Record<string, Record<string, unknown>>>,
      scheduleOverrides: { ...scheduleOverrides } as Readonly<Record<string, Record<string, unknown>>>,
      userLibraryResourceIds: [...userLibraryResourceIds] as readonly string[],
      resourceEditorMode,
      editingResourceId,
      editingResourceSyllabusId,
      editingResourceModuleId,
      editingResourceActivityId,
      resourceRawDraft,
      resourceEditorError,
      resourceNotice,
      lastPipelineReceipt,
      dynamicConceptChecks: { ...dynamicConceptChecks } as Readonly<Record<string, ConceptCheck>>,
      conceptCheckSeed,
      proficiencyOverrides: { ...proficiencyOverrides } as Readonly<Record<string, ProficiencyOverrideEntry>>,
      deletedSyllabusIds: [...deletedSyllabusIds] as readonly string[],
      diagnosticObjectiveId,
      diagnosticChoice,
      diagnosticFeedback,
      syllabusEditMode,
      editingSyllabusModuleId,
      editingSyllabusActivityId,
      syllabusEditorError,
      syllabusEditorNotice,
      authResetEmail,
      emailVerified,
      emailVerificationPending,
      wallet,
      billingNotice,
    };
  };

  function getSyllabusPayload(targetSyllabusId: string): Record<string, unknown> | null {
    if (targetSyllabusId === selectedSyllabusId) return planData().syllabus;
    const found = currentPlans().find((p) => p.syllabusId === targetSyllabusId);
    return found ? found.syllabus : null;
  }

  function setSyllabusPayload(targetSyllabusId: string, updatedSyllabus: Record<string, unknown>): void {
    syllabusOverrides = { ...syllabusOverrides, [targetSyllabusId]: updatedSyllabus };
    if (generatedPlans.some((p) => p.syllabusId === targetSyllabusId)) {
      generatedPlans = generatedPlans.map((p) =>
        p.syllabusId === targetSyllabusId ? { ...p, syllabus: updatedSyllabus } : p,
      );
    }
    todayController = buildToday();
  }

  function lookupAnyCatalogResource(resId: string): CatalogResourceMetadataInput | undefined {
    return (
      catalogResources[resId] ??
      (catalogResourcesJson.global_discovered_resources as Readonly<Record<string, CatalogResourceMetadataInput>>)[resId] ??
      (catalogResourcesJson.resources as Readonly<Record<string, CatalogResourceMetadataInput>>)[resId]
    );
  }

  function intakeFitEvaluation() {
    return evaluateIntakeResourceFit({
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
  }

  // The provider and model that write the syllabus: the primary key's provider, or null without an active key.
  function designatedModel(): { readonly providerId: string; readonly modelId: string } | null {
    const activeByok = byokCredentials.filter((c) => c.status === "active" && Boolean(c.masked_suffix));
    const cred = activeByok.find((c) => c.credential_ref === primaryCredentialRef) ?? activeByok[0];
    if (!cred) return null;
    const providerId = cred.provider_id;
    return { providerId, modelId: providerModels[providerId] ?? CHEAP_MODEL_BY_PROVIDER[providerId as keyof typeof CHEAP_MODEL_BY_PROVIDER] };
  }

  function applyGenerateFields(data: Readonly<Record<string, string | undefined>>) {
    if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
    const parsed = Number.parseInt(data["weeklyMinutes"] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) intakeWeeklyMinutes = parsed;
  }

  return {
    getState,
    renderHtml: (): string => {
      const { activityStates: _a, ...restState } = getState();
      return renderSyllabusWebAppHtml({ ...initialState, ...restState, activityStates: activityStatesInput() });
    },
    // The prompt and model for a live draft, or null when nobody is signed in or no key is configured.
    // The server sends it with the key from its own environment, then passes the outcome to applyUiAction.
    liveGenerationRequest(data: Readonly<Record<string, string | undefined>> = {}): LiveDraftRequest | null {
      if (!signedIn()) return null;
      applyGenerateFields(data);
      const model = designatedModel();
      if (!model) return null;
      const fit = intakeFitEvaluation();
      return {
        ...model,
        prompt: buildLiveDraftPrompt({
          searchPrompt: fit.searchPrompt,
          deltaTopics: fit.deltaTopicsToSearch,
          reusedTitles: fit.indexedMaterials.filter((m) => fit.selectedResourceIds.includes(m.resourceVersionId)).map((m) => m.title),
          bypassedUrls: fit.bypassedCanonicalUrls,
        }),
      };
    },
    // Resources that other sessions indexed. A record this session already holds stays as it is.
    addCatalogResources(entries: Readonly<Record<string, CatalogResourceMetadataInput>>) {
      const missing = Object.entries(entries).filter(([id]) => !catalogResources[id]);
      if (missing.length > 0) catalogResources = { ...catalogResources, ...Object.fromEntries(missing) };
    },
    syncCatalogResources(
      entries: Readonly<Record<string, CatalogResourceMetadataInput>>,
      removedIds: readonly string[] = [],
    ) {
      const removedSet = new Set(removedIds);
      const next: Record<string, CatalogResourceMetadataInput> = { ...catalogResources, ...entries };
      for (const id of removedSet) {
        delete next[id];
      }
      catalogResources = next;
    },
    designatedAiModel: () => designatedModel(),
    navigateTopLevel(destination: TopLevelDestination) {
      if (destination !== "Explore" && !signedIn()) return requireSignIn(placeOf(destination, learnSubDestination));
      adminConsoleOpen = false;
      topLevel = destination;
      studyDetailOpen = false;
      return getState();
    },
    navigateLearnSubDestination(subDestination: LearnSubDestination) {
      if (!signedIn()) return requireSignIn(placeOf("Learn", subDestination));
      adminConsoleOpen = false;
      topLevel = "Learn";
      learnSubDestination = subDestination;
      studyDetailOpen = false;
      return getState();
    },
    switchPlanView(view: PlanSynchronizedView) {
      adminConsoleOpen = false;
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
      syncSubtasks(activityId, "completed");
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
    openDialog(dialogId: string, requestedAuthMode?: string, publicationId?: string) {
      if (dialogId !== "dialog-auth" && !signedIn()) {
        const label = dialogId === "dialog-publication-preview" ? "Share with Community" : undefined;
        return requireSignIn(placeOf(topLevel, learnSubDestination, dialogId, null, label));
      }
      if (dialogId === "dialog-auth") {
        authNotice = null;
        authPasswordVisible = false;
        if (isOneOf(AUTH_MODES, requestedAuthMode)) authMode = requestedAuthMode;
      }
      if (dialogId === "dialog-unpublish") {
        const candidate =
          publicationId && listings().some((l) => l.publicationId === publicationId && l.ownerAccountId === account.accountId)
            ? publicationId
            : (listings().find((l) => l.ownerAccountId === account.accountId)?.publicationId ?? null);
        unpublishPublicationId = candidate;
      }
      openDialogId = dialogId;
      return getState();
    },
    closeDialog() {
      // A guest who closes the sign-in dialog has dropped that return. An expired session keeps it for the banner.
      if (openDialogId === "dialog-auth" && authStatus === "guest") returnTo = null;
      authPasswordVisible = false;
      openDialogId = null;
      return getState();
    },
    completeExternalAuth(nextAccount: Account) {
      const hadReturn = Boolean(returnTo);
      const wasGuest = authStatus === "guest";
      signIn(nextAccount);
      if (!hadReturn && wasGuest) {
        topLevel = "Learn";
        learnSubDestination = "Today";
      }
      return getState();
    },
    failExternalAuth(message: string, mode?: AuthMode) {
      authNotice = message;
      if (mode) authMode = mode;
      openDialogId = "dialog-auth";
      return getState();
    },
    setPasskeys(nextPasskeys: readonly PasskeySummaryItem[], notice?: string | null) {
      passkeys = [...nextPasskeys];
      if (notice !== undefined) passkeyNotice = notice;
      return getState();
    },
    setByokCredentials(
      nextCredentials: readonly MaskedCredentialRecord[],
      nextPrimaryRef?: string,
      note?: string | null,
    ) {
      byokCredentials = [...nextCredentials];
      const active = byokCredentials.filter((c) => c.status === "active" && Boolean(c.masked_suffix));
      if (nextPrimaryRef !== undefined) {
        primaryCredentialRef = active.some((c) => c.credential_ref === nextPrimaryRef)
          ? nextPrimaryRef
          : (active[0]?.credential_ref ?? "");
      } else if (!active.some((c) => c.credential_ref === primaryCredentialRef)) {
        primaryCredentialRef = active[0]?.credential_ref ?? "";
      }
      editingCredentialProviderId = null;
      if (note !== undefined) keyActionNote = note;
      return getState();
    },
    liveConceptCheckRequest(requestedActivityId?: string): LiveTutorModelRequest | null {
      if (!signedIn()) return null;
      const model = designatedModel();
      if (!model) return null;
      const plan = planData();
      const actId = requestedActivityId || selectedActivityId || "";
      const rawAct = rawListOf(plan.syllabus, "activities").find((a) => a["activity_id"] === actId);
      if (!rawAct) return null;
      const rawModules = rawListOf(plan.syllabus, "modules");
      const holder =
        rawModules.find((m) => normalizeStringList(m["activity_ids"]).includes(actId)) ?? rawModules[0];
      const objIds = normalizeStringList(rawAct["objective_ids"]);
      const rawObjectives = rawListOf(plan.syllabus, "objectives");
      const rawObj =
        rawObjectives.find((o) => objIds.includes(String(o["objective_id"] ?? ""))) ?? rawObjectives[0];
      return {
        ...model,
        syllabusTitle: goalTitleOf(plan.syllabus),
        subject: typeof plan.syllabus["subject"] === "string" ? plan.syllabus["subject"] : plan.domain,
        moduleTitle: typeof holder?.["title"] === "string" ? holder["title"] : "Core Unit",
        activityId: actId,
        activityTitle: typeof rawAct["title"] === "string" ? rawAct["title"] : actId,
        activityType: typeof rawAct["type"] === "string" ? rawAct["type"] : "theory",
        activityPrompt: activityPromptOfRaw(rawAct),
        objectiveId: typeof rawObj?.["objective_id"] === "string" ? rawObj["objective_id"] : undefined,
        objectiveTitle: typeof rawObj?.["title"] === "string" ? rawObj["title"] : undefined,
        successCriterion:
          typeof rawObj?.["success_criterion"] === "string" ? rawObj["success_criterion"] : undefined,
        variantSeed: conceptCheckSeed + 1,
      };
    },
    setActivityConceptCheck(activityId: string, check: ConceptCheck) {
      dynamicConceptChecks = { ...dynamicConceptChecks, [activityId]: check };
      resetPractice();
      completedSubtaskIds = completedSubtaskIds.filter((sid) => sid !== conceptCheckSubtaskId(activityId));
      return getState();
    },
    setWallet(nextWallet: HostedCreditWalletSnapshot, notice?: string | null) {
      wallet = nextWallet;
      if (notice !== undefined) billingNotice = notice;
      return getState();
    },
    setEmailVerificationState(verified: boolean, pending?: boolean, notice?: string | null) {
      emailVerified = verified;
      if (pending !== undefined) emailVerificationPending = pending;
      if (notice !== undefined) profileNotice = notice;
      return getState();
    },
    advancePasswordReset(email: string, notice: string) {
      authResetEmail = email.trim().toLowerCase();
      authMode = "reset_confirm";
      authNotice = notice;
      openDialogId = "dialog-auth";
      return getState();
    },
    exportScheduleIcs(): string {
      const escIcs = (raw: string) =>
        raw
          .replace(/\\/g, "\\\\")
          .replace(/;/g, "\\;")
          .replace(/,/g, "\\,")
          .replace(/\r?\n/g, "\\n");
      const fmtUtc = (dt: Date) =>
        dt
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z");
      const nowStamp = fmtUtc(new Date());
      const leadMins = Math.max(0, Number.parseInt(reminderLeadMinutes, 10) || 15);
      const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Syllabus.io//Study Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Syllabus.io Study Schedule",
        `X-WR-TIMEZONE:${escIcs(reminderTimezone)}`,
      ];
      for (const plan of currentPlans()) {
        const effSchedule = scheduleOverrides[plan.syllabusId] ?? plan.schedule;
        const effSyllabus = syllabusOverrides[plan.syllabusId] ?? plan.syllabus;
        const planTitle = goalTitleOf(effSyllabus);
        const actById = new Map(
          rawListOf(effSyllabus, "activities").map((a) => [
            String(a["activity_id"] ?? ""),
            typeof a["title"] === "string" ? a["title"] : String(a["activity_id"] ?? "Study step"),
          ]),
        );
        for (const sess of rawListOf(effSchedule, "sessions")) {
          const sessId = String(sess["session_id"] ?? "session");
          const rawStart =
            sessId === rescheduleSessionId && rescheduleValue
              ? rescheduleValue
              : typeof sess["start_at"] === "string"
                ? sess["start_at"]
                : "";
          const parsedStart = rawStart ? new Date(rawStart) : new Date(Number.NaN);
          const startDt = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
          const durMins =
            typeof sess["duration_minutes"] === "number" && sess["duration_minutes"] > 0
              ? sess["duration_minutes"]
              : 45;
          const endDt = new Date(startDt.getTime() + durMins * 60_000);
          const actIds = normalizeStringList(sess["activity_ids"]);
          const actTitles = actIds.map((id) => actById.get(id) ?? id).filter(Boolean);
          const summary =
            actTitles.length > 0 ? `${planTitle}: ${actTitles[0]}` : `${planTitle}: Study Session`;
          const description =
            actTitles.length > 0
              ? `Syllabus: ${planTitle}\nActivities:\n- ${actTitles.join("\n- ")}`
              : `Syllabus: ${planTitle}`;
          lines.push("BEGIN:VEVENT");
          lines.push(`UID:${escIcs(`${plan.syllabusId}-${sessId}@syllabus.io`)}`);
          lines.push(`DTSTAMP:${nowStamp}`);
          lines.push(`DTSTART:${fmtUtc(startDt)}`);
          lines.push(`DTEND:${fmtUtc(endDt)}`);
          lines.push(`SUMMARY:${escIcs(summary)}`);
          lines.push(`DESCRIPTION:${escIcs(description)}`);
          if (remindersEnabled && !remindersPaused && sess["reminder_enabled"] !== false) {
            lines.push("BEGIN:VALARM");
            lines.push("ACTION:DISPLAY");
            lines.push(`DESCRIPTION:${escIcs(summary)}`);
            lines.push(`TRIGGER:-PT${leadMins}M`);
            lines.push("END:VALARM");
          }
          lines.push("END:VEVENT");
        }
      }
      lines.push("END:VCALENDAR");
      return `${lines.join("\r\n")}\r\n`;
    },
    // The live draft for generate-syllabus-ai and analyzedResourceOutcome for ingest-manual-resource are passed by the server.
    applyUiAction(
      action: string,
      data: Readonly<Record<string, string | undefined>> = {},
      submittedChoice: string | null = null,
      liveOutcome: LiveDraftOutcome | null = null,
      analyzedResourceOutcome: AnalyzedManualResourceDraft | { readonly error: string } | null = null,
      generatedConceptCheckOutcome: GeneratedConceptCheck | null = null,
    ) {
      const value = (key: string) => data[key];
      // Without a valid session only reading, filtering, appearance, and signing in run. Anything else asks for sign-in.
      if (!signedIn() && !OPEN_ACTIONS.has(action)) {
        const listing = action === "open-adopt-dialog" ? listings().find((entry) => entry.publicationId === value("publicationId")) : undefined;
        requireSignIn(listing
          ? placeOf("Explore", learnSubDestination, "dialog-partial-adoption", listing.publicationId, `Explore › Details: ${goalTitleOf(listing.syllabus)}`)
          : placeOf(topLevel, learnSubDestination));
        return { handled: true, state: getState() };
      }
      let handled = true;
      if (action === "close-study-detail") studyDetailOpen = false;
      else if (action === "submit-sign-in") signInWithEmail(value("email") ?? "");
      else if (action === "submit-sign-up") signUpWithEmail(value("email") ?? "", value("password") ?? "");
      else if (action === "request-password-reset") {
        const address = (value("email") ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          authNotice = "Enter a valid email address.";
          authMode = "reset";
          openDialogId = "dialog-auth";
        } else {
          authResetEmail = address;
          authMode = "reset_confirm";
          authNotice = `If an account exists for ${address}, a 6-digit recovery code has been sent.`;
          openDialogId = "dialog-auth";
        }
      } else if (action === "confirm-password-reset") {
        const address = ((value("email") || authResetEmail) ?? "").trim().toLowerCase();
        const code = (value("code") ?? "").trim();
        const nextPassword = value("password") ?? "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          authNotice = "Enter a valid email address.";
          authMode = "reset_confirm";
          openDialogId = "dialog-auth";
        } else if (!/^[0-9]{6}$/.test(code)) {
          authNotice = "Enter the 6-digit recovery code.";
          authMode = "reset_confirm";
          openDialogId = "dialog-auth";
        } else if (nextPassword.length < 8) {
          authNotice = "Use a new password with at least 8 characters.";
          authMode = "reset_confirm";
          openDialogId = "dialog-auth";
        } else {
          authResetEmail = "";
          authMode = "login";
          signInWithEmail(address);
        }
      } else if (action === "request-email-verification") {
        emailVerificationPending = true;
        profileNotice = `Sent a 6-digit verification code to ${account.email}.`;
      } else if (action === "confirm-email-verification") {
        const code = (value("code") ?? "").trim();
        if (!/^[0-9]{6}$/.test(code)) {
          profileNotice = "Enter a valid 6-digit verification code.";
        } else {
          emailVerified = true;
          emailVerificationPending = false;
          profileNotice = `Email address ${account.email} verified.`;
        }
      } else if (action === "switch-auth-mode" && isOneOf(AUTH_MODES, data["authMode"])) {
        authMode = data["authMode"];
        authNotice = null;
        authPasswordVisible = false;
        openDialogId = "dialog-auth";
      } else if (action === "toggle-auth-password") {
        authPasswordVisible = !authPasswordVisible;
      } else if (action === "sign-in-passkey") signIn(account);
      else if (action === "delete-passkey" && data["credentialId"]) {
        passkeys = passkeys.filter((pk) => pk.id !== data["credentialId"]);
        passkeyNotice = "Passkey removed from your account.";
      } else if (action === "update-profile") {
        const nextUsername = (value("username") ?? "").trim().replace(/^@+/, "");
        const nextEmail = (value("email") ?? "").trim().toLowerCase();
        if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
          profileNotice = "Enter a valid email address.";
        } else {
          const resolvedEmail = nextEmail || account.email;
          const prevDefault = defaultUsernameOfEmail(account.email);
          const resolvedUsername =
            nextUsername ||
            (resolvedEmail !== account.email && usernameOf(account) === prevDefault
              ? defaultUsernameOfEmail(resolvedEmail)
              : usernameOf(account));
          account = {
            ...account,
            email: resolvedEmail,
            username: resolvedUsername,
          };
          profileNotice = "Profile saved.";
        }
      } else if (action === "save-avatar-crop") {
        const avatarUrl = (value("avatarUrl") ?? "").trim();
        if (avatarUrl) {
          account = { ...account, avatarUrl };
        }
        profileNotice = "Profile photo updated.";
        openDialogId = null;
      } else if (action === "switch-persona" && isOneOf(PERSONA_CHOICES, data["persona"])) {
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
      else if (action === "confirm-adopt-syllabus" && data["publicationId"] === adoptPublicationId) {
        const listing = adoptableListing(adoptPublicationId);
        if (listing) adopt(listing);
      } else if (action === "confirm-publish-syllabus" && !publishedFromSelected()) publishSelectedPlan();
      else if (action === "confirm-unpublish-syllabus") {
        const targetId =
          data["publicationId"] ||
          unpublishPublicationId ||
          listings().find((l) => l.ownerAccountId === account.accountId)?.publicationId ||
          "";
        const target = listings().find(
          (l) => l.publicationId === targetId && l.ownerAccountId === account.accountId,
        );
        if (target) {
          if (!unpublishedPublicationIds.includes(target.publicationId)) {
            unpublishedPublicationIds = [...unpublishedPublicationIds, target.publicationId];
          }
          publishedListings = publishedListings.filter((l) => l.publicationId !== target.publicationId);
          unpublishPublicationId = null;
          openDialogId = null;
          loadMoreNote = `Unpublished "${goalTitleOf(target.syllabus)}" from Explore.`;
        } else {
          handled = false;
        }
      } else if (action === "confirm-delete-account") {
        if (!signedIn()) {
          handled = false;
        } else {
          signOut();
          authNotice = "Your account and private workspace data have been permanently deleted.";
        }
      } else if (action === "activate-revision" && planData().draft) activateSelectedDraft();
      else if (action === "select-syllabus" && data["syllabusId"] === "__new_syllabus__") {
        openDialogId = "dialog-new-syllabus";
      } else if (action === "select-syllabus" && data["syllabusId"] === "__edit_plan__") {
        topLevel = "Learn";
        learnSubDestination = "Plan";
        studyDetailOpen = false;
      } else if (action === "select-syllabus" && data["syllabusId"] === "all") resourceScope = "all";
      else if (action === "select-syllabus" && isMyPlan(data["syllabusId"])) {
        selectSyllabus(data["syllabusId"]);
        resourceScope = "selected";
      } else if (action === "set-resource-scope" && isOneOf(RESOURCE_SCOPES, data["resourceScope"])) {
        resourceScope = data["resourceScope"];
      } else if (action === "set-resource-category" && isOneOf(RESOURCE_CATEGORIES, data["resourceCategory"])) {
        resourceCategory = data["resourceCategory"];
      } else if (action === "open-admin-resources") {
        adminConsoleOpen = true;
        studyDetailOpen = false;
      } else if (action === "close-admin-resources") {
        adminConsoleOpen = false;
      } else if (action === "set-admin-resource-source" && isOneOf(ADMIN_DISCOVERY_SOURCES, data["adminSource"])) {
        adminSourceFilter = data["adminSource"];
      } else if (action === "set-admin-resource-category" && isOneOf(RESOURCE_CATEGORIES, data["adminCategory"])) {
        adminCategoryFilter = data["adminCategory"];
      } else if (action === "set-admin-resource-query") {
        adminSearchQuery = (value("query") ?? "").trim().slice(0, 120);
      } else if (action === "clear-admin-resource-query") {
        adminSearchQuery = "";
      } else if (action === "admin-verify-resource" && data["resourceId"] && isAdminAccount(account)) {
        const resId = data["resourceId"];
        const prev = adminResourceOverrides[resId];
        adminResourceOverrides = {
          ...adminResourceOverrides,
          [resId]: {
            ...prev,
            vector_index: {
              ...prev?.vector_index,
              status: "indexed",
              discovered_by: "Curator Verified",
              last_indexed_at: new Date().toISOString(),
            },
          },
        };
        adminNotice = `Verified ${resId} and updated its vector corpus provenance to Curator Verified.`;
      } else if (action === "admin-reindex-resource" && data["resourceId"] && isAdminAccount(account)) {
        const resId = data["resourceId"];
        const prev = adminResourceOverrides[resId];
        adminResourceOverrides = {
          ...adminResourceOverrides,
          [resId]: {
            ...prev,
            vector_index: {
              ...prev?.vector_index,
              status: "indexed",
              last_indexed_at: new Date().toISOString(),
            },
          },
        };
        adminNotice = `Re-indexed ${resId} into the TF-IDF cosine index.`;
      } else if (action === "admin-reindex-all" && isAdminAccount(account)) {
        const now = new Date().toISOString();
        const nextOverrides: Record<string, Partial<CatalogResourceMetadataInput>> = { ...adminResourceOverrides };
        for (const id of [
          ...Object.keys(catalogResourcesJson.resources),
          ...Object.keys(catalogResourcesJson.global_discovered_resources),
          ...Object.keys(catalogResources),
        ]) {
          if (adminRemovedResourceIds.includes(id)) continue;
          const prev = nextOverrides[id];
          nextOverrides[id] = {
            ...prev,
            vector_index: {
              ...prev?.vector_index,
              status: "indexed",
              last_indexed_at: now,
            },
          };
        }
        adminResourceOverrides = nextOverrides;
        adminNotice = "Re-indexed all global corpus resources into the TF-IDF cosine index.";
      } else if (action === "admin-remove-resource" && data["resourceId"] && isAdminAccount(account)) {
        const resId = data["resourceId"];
        if (!adminRemovedResourceIds.includes(resId)) {
          adminRemovedResourceIds = [...adminRemovedResourceIds, resId];
        }
        adminNotice = `Removed ${resId} from the global resource index.`;
      } else if (action === "open-syllabus-plan" && isMyPlan(data["syllabusId"])) {
        selectSyllabus(data["syllabusId"]);
        topLevel = "Learn";
        learnSubDestination = "Plan";
      } else if (action === "resume-syllabus" && isMyPlan(data["syllabusId"]) && data["activityId"]) {
        selectSyllabus(data["syllabusId"]);
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
        if (submittedChoice && selectedActivityId) setSubtaskChecked(selectedActivityId, conceptCheckSubtaskId(selectedActivityId), true);
      } else if (action === "generate-activity-check") {
        const plan = planData();
        const actId = (data["activityId"] ?? selectedActivityId ?? "").trim();
        const rawAct = rawListOf(plan.syllabus, "activities").find((a) => a["activity_id"] === actId);
        if (actId && rawAct) {
          const nextSeed = conceptCheckSeed + 1;
          conceptCheckSeed = nextSeed;
          const rawModules = rawListOf(plan.syllabus, "modules");
          const holder =
            rawModules.find((m) => normalizeStringList(m["activity_ids"]).includes(actId)) ?? rawModules[0];
          const objIds = normalizeStringList(rawAct["objective_ids"]);
          const rawObjectives = rawListOf(plan.syllabus, "objectives");
          const rawObj =
            rawObjectives.find((o) => objIds.includes(String(o["objective_id"] ?? ""))) ?? rawObjectives[0];
          const nextCheck: ConceptCheck =
            generatedConceptCheckOutcome ??
            buildDeterministicConceptCheck({
              syllabusTitle: goalTitleOf(plan.syllabus),
              subject: typeof plan.syllabus["subject"] === "string" ? plan.syllabus["subject"] : plan.domain,
              moduleTitle: typeof holder?.["title"] === "string" ? holder["title"] : "Core Unit",
              activityId: actId,
              activityTitle: typeof rawAct["title"] === "string" ? rawAct["title"] : actId,
              activityType: typeof rawAct["type"] === "string" ? rawAct["type"] : "theory",
              activityPrompt: activityPromptOfRaw(rawAct),
              objectiveId: typeof rawObj?.["objective_id"] === "string" ? rawObj["objective_id"] : undefined,
              objectiveTitle: typeof rawObj?.["title"] === "string" ? rawObj["title"] : undefined,
              successCriterion:
                typeof rawObj?.["success_criterion"] === "string" ? rawObj["success_criterion"] : undefined,
              variantSeed: nextSeed,
            });
          dynamicConceptChecks = { ...dynamicConceptChecks, [actId]: nextCheck };
          resetPractice();
          completedSubtaskIds = completedSubtaskIds.filter((sid) => sid !== conceptCheckSubtaskId(actId));
        }
      } else if (action === "toggle-subtask" && data["activityId"] && data["subtaskId"]) {
        const { activityId, subtaskId } = data;
        setSubtaskChecked(activityId, subtaskId, !checkedSubtasksOf(activityId).includes(subtaskId));
      } else if (action === "set-activity-status" && data["activityId"] && isOneOf(SETTABLE_STATUSES, data["status"])) {
        setActivityStatus(data["activityId"], data["status"]);
      } else if (action === "skip-activity" && data["activityId"]) {
        const activityId = data["activityId"];
        if (!skippedActivityIds.includes(activityId)) skippedActivityIds.push(activityId);
      } else if (action === "diagnostic-pause") diagnosticControl = "paused";
      else if (action === "diagnostic-stop-early") diagnosticControl = "stopped";
      else if (action === "diagnostic-continue") {
        diagnosticControl = "active";
        const plan = planData();
        const rawObjectives = rawListOf(plan.syllabus, "objectives");
        const effProf = effectiveProficiencyOf(plan.syllabus);
        const demIds = new Set(
          effProf.objective_evidence.filter((e) => e.status === "demonstrated").map((e) => e.objective_id),
        );
        const requestedObjId = data["objectiveId"]?.trim();
        const targetObj =
          (requestedObjId ? rawObjectives.find((o) => o["objective_id"] === requestedObjId) : undefined) ??
          rawObjectives.find((o) => !demIds.has(String(o["objective_id"] ?? ""))) ??
          rawObjectives[0];
        diagnosticObjectiveId = typeof targetObj?.["objective_id"] === "string" ? targetObj["objective_id"] : null;
        diagnosticChoice = null;
        diagnosticFeedback = null;
        studyDetailOpen = false;
        openDialogId = "dialog-diagnostic-check";
      } else if (action === "submit-diagnostic-answer") {
        const plan = planData();
        const rawObjectives = rawListOf(plan.syllabus, "objectives");
        const objId = (data["objectiveId"] ?? diagnosticObjectiveId ?? "").trim();
        const rawObj = rawObjectives.find((o) => o["objective_id"] === objId) ?? rawObjectives[0];
        const chosenVal = (data["diagnosticChoice"] ?? submittedChoice ?? "").trim();
        if (!rawObj) {
          diagnosticFeedback = { passed: false, message: "Select a target capability first." };
        } else if (!chosenVal) {
          diagnosticFeedback = { passed: false, message: "Select an answer option before verifying." };
        } else {
          const resolvedObjId = String(rawObj["objective_id"] ?? "");
          diagnosticObjectiveId = resolvedObjId;
          diagnosticChoice = chosenVal;
          const q = buildDiagnosticQuestionForObjective({
            syllabusTitle: goalTitleOf(plan.syllabus),
            subject: typeof plan.syllabus["subject"] === "string" ? plan.syllabus["subject"] : plan.domain,
            objectiveId: resolvedObjId,
            objectiveVersionId:
              typeof rawObj["objective_version_id"] === "string" ? rawObj["objective_version_id"] : undefined,
            objectiveTitle:
              typeof rawObj["title"] === "string" ? rawObj["title"] : resolvedObjId,
            description: typeof rawObj["description"] === "string" ? rawObj["description"] : undefined,
            successCriterion:
              typeof rawObj["success_criterion"] === "string" ? rawObj["success_criterion"] : undefined,
          });
          if (chosenVal === q.correctValue) {
            const evidenceRef = `diag-check-${resolvedObjId}`;
            proficiencyOverrides = {
              ...proficiencyOverrides,
              [resolvedObjId]: { status: "demonstrated", evidenceRef },
            };
            adaptationChoice = "pending";
            todayController = buildToday();
            diagnosticFeedback = {
              passed: true,
              message: `Recorded corroborated checkpoint (${evidenceRef}) for "${q.objectiveTitle}". You can now preview and accept plan adaptation.`,
            };
          } else {
            diagnosticFeedback = {
              passed: false,
              message:
                "That choice does not match the capability criterion. Review the explanation below or study the linked unit activities before re-checking.",
            };
          }
        }
      } else if (action === "accept-revision") {
        const plan = planData();
        const effProf = effectiveProficiencyOf(plan.syllabus);
        const hasOv = Object.keys(proficiencyOverrides).length > 0 || Boolean(syllabusOverrides[plan.syllabusId]);
        const proposal =
          initialState.adaptationProposal ??
          (plan.syllabusId === "syllabus-rag-python-001" && !hasOv
            ? DEFAULT_ADAPTATION_PROPOSAL
            : buildDynamicAdaptationProposal(plan.syllabusId, plan.syllabus, effProf, DEFAULT_ADAPTATION_PROPOSAL));
        const adapted = applyAcceptedAdaptationToSyllabus(plan.syllabus, proposal);
        for (const waivedId of adapted.waivedActivityIds) {
          if (!skippedActivityIds.includes(waivedId)) skippedActivityIds = [...skippedActivityIds, waivedId];
          statusOverrides.set(waivedId, "waived");
        }
        setSyllabusPayload(plan.syllabusId, adapted.syllabus);
        adaptationChoice = "accept_reviewed";
      } else if (action === "keep-current-plan") adaptationChoice = "keep_current";
      else if (action === "toggle-reminders") remindersEnabled = !remindersEnabled;
      else if (action === "pause-reminders") remindersPaused = !remindersPaused;
      else if (action === "set-reminder-timezone" && (data["reminderTimezone"] || data["value"])) {
        reminderTimezone = (data["reminderTimezone"] ?? data["value"] ?? "America/New_York").trim();
      } else if (action === "set-reminder-schedule") {
        const field = data["reminderField"];
        const nextVal = (data["value"] ?? "").trim();
        if (typeof data["weekdayTime"] === "string" && data["weekdayTime"].trim()) {
          reminderWeekdayTime = data["weekdayTime"].trim();
        }
        if (typeof data["weekendTime"] === "string" && data["weekendTime"].trim()) {
          reminderWeekendTime = data["weekendTime"].trim();
        }
        if (typeof data["leadMinutes"] === "string" && data["leadMinutes"].trim()) {
          reminderLeadMinutes = data["leadMinutes"].trim();
        }
        if (field === "weekdayTime" && nextVal) reminderWeekdayTime = nextVal;
        else if (field === "weekendTime" && nextVal) reminderWeekendTime = nextVal;
        else if (field === "leadMinutes" && nextVal) reminderLeadMinutes = nextVal;
      }
      else if (action === "snooze-reminder") snoozeNote = "Snooze does not change assessed proficiency. Delivery stays best effort.";
      else if (action === "toggle-key-visibility") keyVisible = !keyVisible;
      else if (action === "edit-provider-key" && data["providerId"]) {
        editingCredentialProviderId = data["providerId"];
        keyActionNote = null;
      } else if (action === "cancel-edit-key") {
        editingCredentialProviderId = null;
      } else if (action === "open-ai-settings") {
        openDialogId = null;
        topLevel = "Settings";
        editingCredentialProviderId = "openai";
      } else if (action === "set-primary-key" && data["credentialRef"]) {
        const matchedCred = byokCredentials.find((c) => c.credential_ref === data["credentialRef"] && c.status === "active");
        if (matchedCred) {
          primaryCredentialRef = matchedCred.credential_ref;
          keyActionNote = `${matchedCred.label ?? primaryCredentialRef} is now set as your primary AI provider for syllabus synthesis and diagnostics.`;
        }
      } else if (action === "set-provider-model" && data["providerId"] && (data["modelId"] || data["value"])) {
        const providerId = data["providerId"];
        const nextModel = (data["modelId"] ?? data["value"] ?? "").trim();
        if (nextModel) {
          providerModels = { ...providerModels, [providerId]: nextModel };
        }
      } else if (action === "set-intake-ai-model" && (data["compoundModel"] || data["value"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        const compound = (data["compoundModel"] ?? data["value"] ?? "").trim();
        const colonIdx = compound.indexOf(":");
        if (colonIdx > 0) {
          const providerId = compound.slice(0, colonIdx);
          const nextModel = compound.slice(colonIdx + 1);
          if (providerId && nextModel) {
            providerModels = { ...providerModels, [providerId]: nextModel };
            const matchedCred = byokCredentials.find((c) => c.provider_id === providerId && c.status === "active");
            if (matchedCred) {
              primaryCredentialRef = matchedCred.credential_ref;
            }
          }
        }
      } else if (action === "replace-key") {
        const providerId =
          data["providerId"] ??
          byokCredentials.find((c) => c.credential_ref === data["credentialRef"])?.provider_id ??
          editingCredentialProviderId ??
          "openai";
        const rawKey = (data["keyValue"] ?? "").trim();
        const existing = byokCredentials.find((c) => c.provider_id === providerId);
        const suffix = rawKey.length >= 4 ? rawKey.slice(-4) : (existing?.masked_suffix || "9a4F");
        const defaultRef =
          data["credentialRef"] ??
          (providerId === "openai" ? "cred-openai-1" : providerId === "anthropic" ? "cred-anthropic-1" : "cred-gemini-1");
        const defaultLabel =
          providerId === "openai" ? "OpenAI Research Key" : providerId === "anthropic" ? "Anthropic Claude Key" : "Google Gemini Key";
        const nextVer = (existing?.version ?? 0) + 1;
        const updatedCred: MaskedCredentialRecord = {
          credential_ref: existing?.credential_ref ?? defaultRef,
          provider_id: providerId,
          label: existing?.label ?? defaultLabel,
          status: "active",
          credential_version_ref: `${existing?.credential_ref ?? defaultRef}-v${nextVer}`,
          masked_hint: `••••${suffix}`,
          masked_suffix: suffix,
          version: nextVer,
          etag: `"credential-${existing?.credential_ref ?? defaultRef}-v${nextVer}"`,
          updated_at: new Date().toISOString(),
        };
        if (existing) {
          byokCredentials = byokCredentials.map((c) => (c.provider_id === providerId ? updatedCred : c));
        } else {
          byokCredentials = [...byokCredentials, updatedCred];
        }
        if (!primaryCredentialRef || !byokCredentials.some((c) => c.credential_ref === primaryCredentialRef && c.status === "active")) {
          primaryCredentialRef = updatedCred.credential_ref;
        }
        editingCredentialProviderId = null;
        keyActionNote = `API key encrypted with AES-256-GCM and stored in server custody (••••${suffix}). Queued jobs keep their active key version.`;
      } else if (action === "delete-connection") {
        const targetRef = data["credentialRef"];
        const targetProvider = data["providerId"];
        if (targetRef || targetProvider) {
          byokCredentials = byokCredentials.filter(
            (c) => (targetRef ? c.credential_ref !== targetRef : true) && (targetProvider ? c.provider_id !== targetProvider : true),
          );
        }
        if (editingCredentialProviderId && !byokCredentials.some((c) => c.provider_id === editingCredentialProviderId)) {
          editingCredentialProviderId = null;
        }
        const remainingActive = byokCredentials.filter((c) => c.status === "active");
        if (!remainingActive.some((c) => c.credential_ref === primaryCredentialRef)) {
          primaryCredentialRef = remainingActive[0]?.credential_ref ?? "";
        }
        keyActionNote = "Removed encrypted API key from server custody. Revoke the key in your provider dashboard if it is no longer needed.";
      }
      else if (action === "load-more") loadMoreNote = "No further public revisions are available in this preview.";
      else if (action === "reschedule-session" && data["sessionId"]) {
        rescheduleSessionId = data["sessionId"];
        rescheduleValue = (data["rescheduleValue"] ?? "").trim();
        if (rescheduleValue) {
          const currentSchedule = planData().schedule;
          const rawSessions = Array.isArray(currentSchedule["sessions"]) ? currentSchedule["sessions"] : [];
          const nextSessions = rawSessions.map((entry) => {
            if (entry && typeof entry === "object" && (entry as Record<string, unknown>)["session_id"] === rescheduleSessionId) {
              return { ...(entry as Record<string, unknown>), start_at: rescheduleValue };
            }
            return entry;
          });
          scheduleOverrides = {
            ...scheduleOverrides,
            [selectedSyllabusId]: { ...currentSchedule, sessions: nextSessions },
          };
          todayController = buildToday();
        }
      } else if (action === "reset-depth-override") depthOverrideReset = true;
      else if (action === "set-intake-goal" && typeof data["intakeGoalTitle"] === "string") {
        intakeGoalTitle = data["intakeGoalTitle"];
        const inferred = inferIntakeSubjectFromGoal(intakeGoalTitle, intakeSubject);
        if (inferred !== intakeSubject) {
          intakeSubject = inferred;
          intakeTopics = [];
          intakeSelectedResourceIds = buildIndexedMaterialCandidates(
            catalogResources,
            intakeSubject,
            intakeTopics,
            intakeMaterials,
            intakeGoalTitle,
          ).map((m) => m.resourceVersionId);
          intakeSkippedResourceIds = [];
        }
      } else if (action === "set-intake-subject" && isOneOf(INTAKE_SUBJECTS, data["intakeSubject"])) {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeSubject = data["intakeSubject"];
        intakeTopics = [];
        intakeSelectedResourceIds = buildIndexedMaterialCandidates(
          catalogResources,
          intakeSubject,
          intakeTopics,
          intakeMaterials,
          intakeGoalTitle,
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
          intakeGoalTitle,
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
          if (!intakeSkippedResourceIds.includes(resId)) {
            intakeSkippedResourceIds = [...intakeSkippedResourceIds, resId];
          }
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
      } else if (action === "intake-open-existing-plan" && isMyPlan(data["syllabusId"])) {
        selectSyllabus(data["syllabusId"]);
        openDialogId = null;
        topLevel = "Learn";
        learnSubDestination = "Today";
      } else if (action === "intake-adopt-marketplace-plan" && data["publicationId"]) {
        const listing = adoptableListing(data["publicationId"]);
        if (listing) {
          adoptPublicationId = listing.publicationId;
          adoptModuleIds = unitIdsOf(listing);
          adopt(listing);
        } else {
          const existing = currentPlans().find((p) => p.publicationId === data["publicationId"]);
          if (existing) {
            selectSyllabus(existing.syllabusId);
            openDialogId = null;
            topLevel = "Learn";
            learnSubDestination = "Today";
          }
        }
      } else if (action === "review-generate") {
        if (typeof data["intakeGoalTitle"] === "string") intakeGoalTitle = data["intakeGoalTitle"];
        intakeNote = "Review recorded. Generation was not started and the plan was not activated. Chargeable inference needs a separate authorization.";
      } else if (action === "generate-syllabus-ai") {
        applyGenerateFields(data);
        const model = designatedModel();
        if (!model) {
          intakeNote = "Configure at least one AI provider API key in Settings before generating a syllabus.";
        } else if (liveOutcome && "error" in liveOutcome) {
          intakeNote = `Live generation with ${model.modelId} failed: ${liveOutcome.error}. No syllabus was created.`;
        } else {
          const pipelineResult = executeIntakeGenerationPipeline({
            fitEvaluation: intakeFitEvaluation(),
            goalTitle: intakeGoalTitle,
            subject: intakeSubject,
            requestedTopics: intakeTopics,
            depth: intakeDepth,
            flowOrder: intakeFlow,
            materialsAccess: intakeMaterials,
            weeklyMinutes: intakeWeeklyMinutes,
            fitMode: intakeFitMode,
            accountId: account.accountId,
            handle: handleOf(account),
            catalogResources,
            designatedProviderId: model.providerId,
            designatedModelId: model.modelId,
            sequence: generatedPlans.length + 1,
            liveDraft: liveOutcome?.draft ?? null,
            now: new Date().toISOString(),
          });
          catalogResources = pipelineResult.updatedCatalogResources;
          generatedPlans = [...generatedPlans, pipelineResult.generatedPlan];
          lastPipelineReceipt = pipelineResult.receipt;
          intakeNote = pipelineResult.receipt.summaryNote;
          openDialogId = null;
          selectSyllabus(pipelineResult.generatedPlan.syllabusId);
          topLevel = "Learn";
          learnSubDestination = "Today";
        }
      } else if (action === "open-resource-editor") {
        resourceEditorMode = isOneOf(RESOURCE_EDITOR_MODES, data["editorMode"]) ? data["editorMode"] : "ingest";
        editingResourceId = data["resourceId"] ?? null;
        editingResourceSyllabusId = data["syllabusId"] ?? selectedSyllabusId;
        editingResourceModuleId = data["moduleId"] ?? null;
        editingResourceActivityId = data["activityId"] ?? null;
        resourceEditorError = null;
        studyDetailOpen = false;
        openDialogId = "dialog-resource-editor";
      } else if (action === "set-resource-editor-mode") {
        if (typeof data["rawText"] === "string") resourceRawDraft = data["rawText"];
        if (isOneOf(RESOURCE_EDITOR_MODES, data["editorMode"])) {
          resourceEditorMode = data["editorMode"];
          resourceEditorError = null;
          if (resourceEditorMode === "link" && editingResourceSyllabusId === "__library_only__") {
            editingResourceSyllabusId = selectedSyllabusId;
          }
        }
      } else if (action === "set-resource-editor-syllabus") {
        if (typeof data["rawText"] === "string") resourceRawDraft = data["rawText"];
        const nextTarget = data["targetSyllabusId"] ?? data["value"];
        if (nextTarget === "__library_only__" || isMyPlan(nextTarget)) {
          editingResourceSyllabusId = nextTarget;
          editingResourceModuleId = null;
          editingResourceActivityId = null;
          resourceEditorError = null;
        }
      } else if (action === "ingest-manual-resource") {
        const rawText = (data["rawText"] ?? "").trim();
        const explicitUrl = data["explicitUrl"]?.trim();
        resourceRawDraft = data["rawText"] ?? "";
        let draft: AnalyzedManualResourceDraft | null = null;
        if (analyzedResourceOutcome && "error" in analyzedResourceOutcome) {
          resourceEditorError = analyzedResourceOutcome.error;
        } else if (analyzedResourceOutcome) {
          draft = analyzedResourceOutcome;
        } else {
          const parsed = parseFreeFormResourceInput(rawText, explicitUrl);
          if ("error" in parsed) {
            resourceEditorError = parsed.error;
          } else {
            draft = analyzeManualResourceDeterministic({ parsed });
          }
        }
        if (draft) {
          const resId = draft.resourceVersionId;
          const metadata = buildCatalogMetadataFromDraft(draft, handleOf(account));
          catalogResources = { ...catalogResources, [resId]: metadata };
          adminRemovedResourceIds = adminRemovedResourceIds.filter((id) => id !== resId);
          if (!userLibraryResourceIds.includes(resId)) {
            userLibraryResourceIds = [resId, ...userLibraryResourceIds];
          }
          if (!intakeSkippedResourceIds.includes(resId) && !intakeSelectedResourceIds.includes(resId)) {
            intakeSelectedResourceIds = [resId, ...intakeSelectedResourceIds];
          }
          const targetCurrId = data["targetSyllabusId"] ?? editingResourceSyllabusId ?? selectedSyllabusId;
          const role = data["role"] === "supplemental" ? "supplemental" : "primary";
          let linkedPlanTitle: string | null = null;
          if (targetCurrId && targetCurrId !== "__library_only__" && isMyPlan(targetCurrId)) {
            const basePayload = getSyllabusPayload(targetCurrId);
            if (basePayload) {
              const updatedSyllabus = applyResourceBindingToSyllabus({
                syllabus: basePayload,
                resourceVersionId: resId,
                resourceEntry: metadata,
                targetModuleId: data["targetModuleId"] ?? editingResourceModuleId,
                targetActivityId: data["targetActivityId"] ?? editingResourceActivityId,
                role,
                selectionRationale: draft.selectionRationale,
              });
              setSyllabusPayload(targetCurrId, updatedSyllabus);
              linkedPlanTitle = goalTitleOf(updatedSyllabus);
            }
          } else {
            resourceScope = "all";
          }
          resourceRawDraft = "";
          resourceEditorError = null;
          editingResourceId = null;
          editingResourceActivityId = null;
          openDialogId = null;
          const sourceTag = draft.analyzedBy === "ai" ? "AI-analyzed" : "Analyzed";
          resourceNotice = linkedPlanTitle
            ? `${sourceTag} and indexed "${draft.title}" (${draft.category}), and linked it to ${linkedPlanTitle}.`
            : `${sourceTag} and indexed "${draft.title}" (${draft.category}) into your resource library.`;
        }
      } else if (action === "link-library-resource") {
        const resId = (data["resourceVersionId"] ?? editingResourceId ?? "").trim();
        const targetCurrId = (data["targetSyllabusId"] ?? editingResourceSyllabusId ?? selectedSyllabusId).trim();
        const entry = resId ? lookupAnyCatalogResource(resId) : undefined;
        const targetSyllabus = isMyPlan(targetCurrId) ? getSyllabusPayload(targetCurrId) : null;
        if (!entry || !resId) {
          resourceEditorError = "Choose an indexed resource from your library.";
        } else if (!targetSyllabus) {
          resourceEditorError = "Choose a target syllabus to link this resource.";
        } else {
          if (!catalogResources[resId]) {
            catalogResources = { ...catalogResources, [resId]: entry };
          }
          const updatedSyllabus = applyResourceBindingToSyllabus({
            syllabus: targetSyllabus,
            resourceVersionId: resId,
            resourceEntry: entry,
            targetModuleId: data["targetModuleId"] ?? editingResourceModuleId,
            targetActivityId: data["targetActivityId"] ?? editingResourceActivityId,
            role: data["role"] === "supplemental" ? "supplemental" : "primary",
            selectionRationale: data["selectionRationale"],
          });
          setSyllabusPayload(targetCurrId, updatedSyllabus);
          resourceEditorError = null;
          editingResourceId = null;
          editingResourceActivityId = null;
          openDialogId = null;
          resourceNotice = `Linked "${entry.title ?? resId}" to ${goalTitleOf(updatedSyllabus)}.`;
        }
      } else if (action === "save-resource-edit") {
        const resId = (data["resourceVersionId"] ?? editingResourceId ?? "").trim();
        const prev = resId ? lookupAnyCatalogResource(resId) : undefined;
        const title = (data["title"] ?? "").trim();
        const rawUrl = (data["canonicalUrl"] ?? "").trim();
        const parsedPrimary = parseFreeFormResourceInput("", rawUrl);
        const parsedUrl = "error" in parsedPrimary ? parseFreeFormResourceInput(rawUrl) : parsedPrimary;
        if (!resId || !prev) {
          resourceEditorError = "Resource record could not be found.";
        } else if (!title) {
          resourceEditorError = "Enter a clear resource title.";
        } else if ("error" in parsedUrl) {
          resourceEditorError = parsedUrl.error;
        } else {
          const category: ManualResourceCategory = isOneOf(MANUAL_RESOURCE_CATEGORIES, data["category"])
            ? data["category"]
            : (MANUAL_RESOURCE_CATEGORIES.includes(prev.category as ManualResourceCategory)
                ? (prev.category as ManualResourceCategory)
                : "Course");
          const accessModel: ManualResourceAccessModel =
            data["accessModel"] === "freemium_optional_certificate" ||
            data["accessModel"] === "paid" ||
            data["accessModel"] === "library_loan"
              ? data["accessModel"]
              : "free";
          const publisher = (data["publisher"] ?? "").trim() || prev.provider?.display_name || "External Resource";
          const topics = (data["topics"] ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          const segmentLines = (data["segments"] ?? "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          const segments =
            segmentLines.length > 0
              ? segmentLines.map((segTitle, idx) => ({
                  segment_id: prev.segments?.[idx]?.segment_id ?? `seg-manual-${idx + 1}`,
                  title: segTitle,
                  verified: prev.segments?.[idx]?.verified ?? true,
                }))
              : (prev.segments ?? []);
          const rationale = (data["selectionRationale"] ?? "").trim();
          const combinedText = [title, rationale, ...topics, ...segments.map((s) => s.title)].join(" ");
          const subject = inferSubjectFromResourceText(combinedText);
          const { tierLabel, costLabel } = formatAccessLabels(
            accessModel,
            undefined,
            accessModel === "freemium_optional_certificate" ? 4900 : 0,
          );
          const nowIso = new Date().toISOString();
          const updatedEntry: CatalogResourceMetadataInput = {
            ...prev,
            resource_version_id: resId,
            title,
            canonical_url: parsedUrl.canonicalUrl,
            category,
            subject,
            description: rationale || prev.description || "",
            topics: topics.length > 0 ? topics : (prev.topics ?? [subject]),
            provider: {
              provider_id: prev.provider?.provider_id ?? parsedUrl.host.replace(/[^a-z0-9]+/g, "-"),
              display_name: publisher,
            },
            access: {
              ...prev.access,
              model: accessModel,
              tier_label: tierLabel,
              cost_label: costLabel,
              rights_label: prev.access?.rights_label ?? "External Link · Metadata Indexed",
              certificate_included: accessModel === "freemium_optional_certificate",
              optional_certificate_price_minor: accessModel === "freemium_optional_certificate" ? 4900 : null,
              access_verified_at: nowIso,
            },
            vector_index: {
              ...prev.vector_index,
              status: "indexed",
              last_indexed_at: nowIso,
            },
            segments,
          };
          catalogResources = { ...catalogResources, [resId]: updatedEntry };
          if (!userLibraryResourceIds.includes(resId)) {
            userLibraryResourceIds = [resId, ...userLibraryResourceIds];
          }
          const targetCurrId = data["targetSyllabusId"];
          const priorCurrId =
            editingResourceSyllabusId && editingResourceSyllabusId !== "__library_only__"
              ? editingResourceSyllabusId
              : selectedSyllabusId;
          if (targetCurrId === "__library_only__") {
            if (isMyPlan(priorCurrId)) {
              const priorPayload = getSyllabusPayload(priorCurrId);
              if (priorPayload) {
                setSyllabusPayload(priorCurrId, removeResourceBindingFromSyllabus(priorPayload, resId));
              }
            }
          } else if (targetCurrId && isMyPlan(targetCurrId)) {
            if (priorCurrId !== targetCurrId && isMyPlan(priorCurrId)) {
              const priorPayload = getSyllabusPayload(priorCurrId);
              if (priorPayload) {
                setSyllabusPayload(priorCurrId, removeResourceBindingFromSyllabus(priorPayload, resId));
              }
            }
            const destPayload = getSyllabusPayload(targetCurrId);
            if (destPayload) {
              const updatedSyllabus = applyResourceBindingToSyllabus({
                syllabus: destPayload,
                resourceVersionId: resId,
                resourceEntry: updatedEntry,
                targetModuleId: data["targetModuleId"],
                role: data["role"] === "supplemental" ? "supplemental" : "primary",
                selectionRationale: rationale || updatedEntry.description,
              });
              setSyllabusPayload(targetCurrId, updatedSyllabus);
            }
          } else {
            todayController = buildToday();
          }
          resourceEditorError = null;
          editingResourceId = null;
          editingResourceActivityId = null;
          openDialogId = null;
          resourceNotice = `Updated "${title}" and refreshed the search index.`;
        }
      } else if (action === "unlink-syllabus-resource") {
        const resId = (data["resourceId"] ?? editingResourceId ?? "").trim();
        const targetCurrId = (data["syllabusId"] ?? editingResourceSyllabusId ?? selectedSyllabusId).trim();
        const entry = resId ? lookupAnyCatalogResource(resId) : undefined;
        const targetPayload = isMyPlan(targetCurrId) ? getSyllabusPayload(targetCurrId) : null;
        if (resId && targetPayload) {
          if (entry && !catalogResources[resId]) {
            catalogResources = { ...catalogResources, [resId]: entry };
          }
          if (!userLibraryResourceIds.includes(resId)) {
            userLibraryResourceIds = [resId, ...userLibraryResourceIds];
          }
          const updatedSyllabus = removeResourceBindingFromSyllabus(targetPayload, resId);
          setSyllabusPayload(targetCurrId, updatedSyllabus);
          if (openDialogId === "dialog-resource-editor") {
            openDialogId = null;
            editingResourceId = null;
            editingResourceActivityId = null;
          }
          resourceNotice = `Removed "${entry?.title ?? resId}" from ${goalTitleOf(updatedSyllabus)}. It remains saved in your library.`;
        }
      } else if (action === "delete-library-resource") {
        const resId = (data["resourceId"] ?? editingResourceId ?? "").trim();
        if (resId) {
          const entry = lookupAnyCatalogResource(resId);
          for (const plan of currentPlans()) {
            const payload = getSyllabusPayload(plan.syllabusId);
            if (payload) {
              setSyllabusPayload(plan.syllabusId, removeResourceBindingFromSyllabus(payload, resId));
            }
          }
          const { [resId]: _removed, ...restCatalog } = catalogResources;
          catalogResources = restCatalog;
          userLibraryResourceIds = userLibraryResourceIds.filter((id) => id !== resId);
          intakeSelectedResourceIds = intakeSelectedResourceIds.filter((id) => id !== resId);
          if (!adminRemovedResourceIds.includes(resId)) {
            adminRemovedResourceIds = [...adminRemovedResourceIds, resId];
          }
          todayController = buildToday();
          if (openDialogId === "dialog-resource-editor") {
            openDialogId = null;
            editingResourceId = null;
            editingResourceActivityId = null;
          }
          resourceNotice = `Deleted "${entry?.title ?? resId}" from your library and search index.`;
        }
      } else if (action === "open-syllabus-editor") {
        syllabusEditMode = isOneOf(SYLLABUS_EDIT_MODES, data["syllabusEditMode"])
          ? data["syllabusEditMode"]
          : "syllabus";
        if (data["moduleId"]) editingSyllabusModuleId = data["moduleId"];
        else if (!editingSyllabusModuleId) editingSyllabusModuleId = selectedModuleId;
        if (data["activityId"]) editingSyllabusActivityId = data["activityId"];
        else if (syllabusEditMode === "edit-activity" && !editingSyllabusActivityId) {
          editingSyllabusActivityId = selectedActivityId;
        }
        syllabusEditorError = null;
        syllabusEditorNotice = null;
        studyDetailOpen = false;
        openDialogId = "dialog-syllabus-editor";
      } else if (action === "save-syllabus-meta") {
        const res = mutateSyllabusMeta(planData().syllabus, {
          title: value("title") ?? "",
          summary: value("summary") ?? "",
        });
        if ("error" in res) {
          syllabusEditorError = res.error;
        } else {
          setSyllabusPayload(selectedSyllabusId, res.syllabus);
          syllabusEditorError = null;
          syllabusEditorNotice = `Saved title "${goalTitleOf(res.syllabus)}".`;
        }
      } else if (action === "save-syllabus-module") {
        const res = upsertSyllabusModule(planData().syllabus, {
          moduleId: value("moduleId") || undefined,
          title: value("title") ?? "",
          summary: value("summary"),
          requirementLevel: value("requirementLevel"),
        });
        if ("error" in res) {
          syllabusEditorError = res.error;
        } else {
          setSyllabusPayload(selectedSyllabusId, res.syllabus);
          selectedModuleId = res.moduleId;
          focusedNodeId = res.moduleId;
          editingSyllabusModuleId = res.moduleId;
          syllabusEditMode = "syllabus";
          syllabusEditorError = null;
          syllabusEditorNotice = value("moduleId") ? "Updated unit." : "Added new unit to syllabus.";
        }
      } else if (action === "move-syllabus-module") {
        const modId = (data["moduleId"] ?? "").trim();
        const dir = data["direction"] === "up" ? "up" : "down";
        if (modId) {
          const updated = moveSyllabusModule(planData().syllabus, modId, dir);
          setSyllabusPayload(selectedSyllabusId, updated);
          syllabusEditorError = null;
          syllabusEditorNotice = "Updated unit order.";
        }
      } else if (action === "delete-syllabus-module") {
        const modId = (data["moduleId"] ?? "").trim();
        const res = removeSyllabusModule(planData().syllabus, modId, planData().schedule);
        if ("error" in res) {
          syllabusEditorError = res.error;
        } else {
          setSyllabusPayload(selectedSyllabusId, res.syllabus);
          if (res.schedule) {
            scheduleOverrides = { ...scheduleOverrides, [selectedSyllabusId]: res.schedule };
          }
          const nextStep = stepOf(res.syllabus);
          selectedModuleId = nextStep.moduleId;
          selectedActivityId = nextStep.activityId;
          focusedNodeId = nextStep.moduleId;
          editingSyllabusModuleId = nextStep.moduleId;
          syllabusEditorError = null;
          syllabusEditorNotice = "Removed unit from syllabus.";
        }
      } else if (action === "save-syllabus-activity") {
        const res = upsertSyllabusActivity(planData().syllabus, {
          activityId: value("activityId") || undefined,
          moduleId: value("moduleId") || editingSyllabusModuleId || selectedModuleId || "",
          title: value("title") ?? "",
          activityType: value("activityType"),
          durationMinutes: value("durationMinutes"),
          requirementLevel: value("requirementLevel"),
          prompt: value("prompt"),
        });
        if ("error" in res) {
          syllabusEditorError = res.error;
        } else {
          setSyllabusPayload(selectedSyllabusId, res.syllabus);
          selectedModuleId = res.moduleId;
          selectedActivityId = res.activityId;
          focusedNodeId = res.moduleId;
          editingSyllabusModuleId = res.moduleId;
          editingSyllabusActivityId = res.activityId;
          syllabusEditMode = "syllabus";
          syllabusEditorError = null;
          syllabusEditorNotice = value("activityId") ? "Updated study step." : "Added new study step.";
        }
      } else if (action === "move-syllabus-activity") {
        const modId = (data["moduleId"] ?? "").trim();
        const actId = (data["activityId"] ?? "").trim();
        const dir = data["direction"] === "up" ? "up" : "down";
        if (modId && actId) {
          const updated = moveSyllabusActivity(planData().syllabus, modId, actId, dir);
          setSyllabusPayload(selectedSyllabusId, updated);
          syllabusEditorError = null;
          syllabusEditorNotice = "Updated step order.";
        }
      } else if (action === "delete-syllabus-activity") {
        const actId = (data["activityId"] ?? "").trim();
        const res = removeSyllabusActivity(planData().syllabus, actId, planData().schedule);
        if ("error" in res) {
          syllabusEditorError = res.error;
        } else {
          setSyllabusPayload(selectedSyllabusId, res.syllabus);
          if (res.schedule) {
            scheduleOverrides = { ...scheduleOverrides, [selectedSyllabusId]: res.schedule };
          }
          const nextStep = stepOf(res.syllabus);
          selectedModuleId = nextStep.moduleId;
          selectedActivityId = nextStep.activityId;
          editingSyllabusActivityId = nextStep.activityId;
          syllabusEditorError = null;
          syllabusEditorNotice = "Removed study step.";
        }
      } else if (action === "confirm-delete-syllabus") {
        const targetId = (data["syllabusId"] ?? selectedSyllabusId).trim();
        if (targetId && isMyPlan(targetId)) {
          if (!deletedSyllabusIds.includes(targetId)) {
            deletedSyllabusIds = [...deletedSyllabusIds, targetId];
          }
          generatedPlans = generatedPlans.filter((p) => p.syllabusId !== targetId);
          adoptions = adoptions.filter(
            (a) => !(a.accountId === account.accountId && `adopted-${a.publicationId}` === targetId),
          );
          const { [targetId]: _dropSyl, ...restSyl } = syllabusOverrides;
          syllabusOverrides = restSyl;
          const { [targetId]: _dropSched, ...restSched } = scheduleOverrides;
          scheduleOverrides = restSched;
          openDialogId = null;
          studyDetailOpen = false;
          const remaining = currentPlans();
          if (remaining.length > 0) {
            const nextPlan = remaining[0]!;
            selectedSyllabusId = nextPlan.syllabusId;
            const first = stepOf(nextPlan.syllabus);
            selectedModuleId = first.moduleId;
            selectedActivityId = first.activityId;
            focusedNodeId = first.moduleId;
          } else {
            selectedSyllabusId = "";
            selectedModuleId = "";
            selectedActivityId = "";
            focusedNodeId = "";
          }
          todayController = buildToday();
        }
      } else if (action === "start-hosted-checkout") {
        const amountMinor = Number.parseInt(data["amountMinor"] ?? "1000", 10);
        const validAmount = Number.isFinite(amountMinor) && amountMinor > 0 ? amountMinor : 1000;
        wallet = {
          ...wallet,
          available_minor: wallet.available_minor + validAmount,
          updated_at: new Date().toISOString(),
        };
        billingNotice = `Added ${formatMinorCurrency(validAmount, wallet.currency)} to your hosted AI credit wallet. New available balance: ${formatMinorCurrency(wallet.available_minor, wallet.currency)}.`;
      } else if (action === "view-evidence" || action === "check-prerequisites") handled = true;
      else handled = false;
      return { handled, state: getState() };
    },
  };
}
export type SyllabusWebAppController = ReturnType<typeof createSyllabusWebAppController>;
export type SyllabusWebAppResolvedState = ReturnType<SyllabusWebAppController["getState"]>;
