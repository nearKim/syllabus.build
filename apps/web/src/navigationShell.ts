import { isSafeResourceUrl, UI_TOKENS, type AppearancePreferences } from "@syllabus/ui";
import { CANONICAL_SPEC_SHA256, OPENAPI_OPERATIONS, type OperationId } from "@syllabus/api-client";
import { clamp } from "./shared.ts";

export const TOP_LEVEL_DESTINATIONS = ["Learn", "Explore", "Settings"] as const;
export type TopLevelDestination = (typeof TOP_LEVEL_DESTINATIONS)[number];

export const LEARN_SUB_DESTINATIONS = ["Today", "Plan", "Progress", "Resources"] as const;
export type LearnSubDestination = (typeof LEARN_SUB_DESTINATIONS)[number];

export const PLAN_SYNCHRONIZED_VIEWS = ["Map", "Outline"] as const;
export type PlanSynchronizedView = (typeof PLAN_SYNCHRONIZED_VIEWS)[number];

export type ResponsiveBreakpoint = "compact" | "medium" | "wide";

export function resolveResponsiveLayout(viewportWidthPx: number, textScalePercent = 100, viewportHeightPx = 800) {
  const safeWidth = Math.max(320, Math.floor(viewportWidthPx));
  const safeScale = Math.max(100, textScalePercent);
  const effectiveWidthPx = safeWidth / (safeScale / 100);
  const { medium_min, wide_min } = UI_TOKENS.breakpoints_css_px;
  const breakpoint: ResponsiveBreakpoint =
    safeWidth < medium_min || effectiveWidthPx < medium_min ? "compact"
    : safeWidth < wide_min || effectiveWidthPx < wide_min ? "medium" : "wide";

  const isCompact = breakpoint === "compact";
  const isMedium = breakpoint === "medium";
  const { touch_target_min: touchMin, primary_compact_target: primaryCompact } = UI_TOKENS.layout_css_px;

  return {
    breakpoint, viewportWidthPx: safeWidth, textScalePercent: safeScale, effectiveWidthPx,
    columns: (isCompact ? 1 : 2) as 1 | 2,
    flowMode: (isCompact ? "single_column" : isMedium ? "two_column_workspace" : "sidebar_and_workspace") as
      | "single_column" | "two_column_workspace" | "sidebar_and_workspace",
    navigationChrome: (isCompact ? "bottom_navigation_bar" : isMedium ? "navigation_rail" : "left_sidebar") as
      | "bottom_navigation_bar" | "navigation_rail" | "left_sidebar",
    sidebarWidthPx: isCompact ? 0 : isMedium ? 80 : UI_TOKENS.layout_css_px.sidebar_wide,
    contentMaxWidthPx: UI_TOKENS.layout_css_px.content_max,
    gutterPx: isCompact ? UI_TOKENS.layout_css_px.gutter_compact : isMedium ? UI_TOKENS.layout_css_px.gutter_medium : UI_TOKENS.layout_css_px.gutter_wide,
    headerBaseHeightPx: 64 as const,
    bottomNavBaseHeightPx: isCompact ? 64 : 0,
    touchTargetMinPx: touchMin,
    touchTargetMinSize: { widthPx: touchMin, heightPx: touchMin },
    primaryCompactActionHeightPx: primaryCompact,
    activePrimaryActionHeightPx: isCompact ? primaryCompact : touchMin,
    hasPageHorizontalScroll: false as const,
    shellContainerStyle: {
      overflowX: "hidden" as const, maxWidth: "100%" as const, overflowWrap: "anywhere" as const, wordBreak: "break-word" as const,
    },
    longTokenCodeMathRegionStyle: {
      overflowX: "auto" as const, maxWidth: "100%" as const, whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const,
    },
    stickySurfacePolicy: {
      obscuresFocusedControl: false as const, obscuresPrimaryActionOrError: false as const,
      demotesStickyToInFlow: viewportHeightPx < 520 || safeScale >= 200,
      focusScrollMarginBottomPx: isCompact ? 72 : 24,
    },
  };
}
export type ResponsiveLayoutResolution = ReturnType<typeof resolveResponsiveLayout>;

export const PLAN_ACTION_IDS = [
  "select_module", "select_activity", "open_module", "open_activity",
  "inspect_prerequisites", "study_ahead", "skip_activity",
] as const;
export type PlanActionId = (typeof PLAN_ACTION_IDS)[number];

export const MAP_NON_DRAGGING_CONTROLS = ["zoom_in", "zoom_out", "fit_view", "reset_focus"] as const;
export type MapNonDraggingControl = (typeof MAP_NON_DRAGGING_CONTROLS)[number];

export interface PlanModuleDescriptor {
  readonly moduleId: string; readonly title: string; readonly required: boolean;
  readonly prerequisiteModuleIds: readonly string[]; readonly activityIds: readonly string[];
  readonly reviewDueCount?: number;
}

export interface PlanFilters {
  readonly showOptionalEnrichment: boolean; readonly showDueReviewsOnly: boolean;
  readonly requirementFilter: "all" | "required" | "optional";
}

const DEFAULT_PLAN_MODULES: readonly PlanModuleDescriptor[] = [
  {
    moduleId: "module-foundations", title: "Tokenization & Sequence Foundations", required: true,
    prerequisiteModuleIds: [], activityIds: ["activity-theory", "activity-example", "activity-coding"], reviewDueCount: 0,
  },
  {
    moduleId: "module-attention", title: "Attention Mechanisms & Complexity", required: true,
    prerequisiteModuleIds: ["module-foundations"], activityIds: ["activity-quiz", "activity-review", "activity-reflection"], reviewDueCount: 1,
  },
];

export function createPlanViewController(options?: {
  readonly initialView?: PlanSynchronizedView; readonly modules?: readonly PlanModuleDescriptor[];
  readonly initialSelectedModuleId?: string | null; readonly initialSelectedActivityId?: string | null;
}) {
  const modules = options?.modules && options.modules.length > 0 ? options.modules : DEFAULT_PLAN_MODULES;
  let activeView: PlanSynchronizedView = options?.initialView ?? "Map";
  let selectedModuleId: string | null =
    options?.initialSelectedModuleId !== undefined ? options.initialSelectedModuleId : (modules[0]?.moduleId ?? null);
  let selectedActivityId: string | null =
    options?.initialSelectedActivityId !== undefined ? options.initialSelectedActivityId : (modules[0]?.activityIds[0] ?? null);
  let filters: PlanFilters = { showOptionalEnrichment: true, showDueReviewsOnly: false, requirementFilter: "all" };
  let zoomLevel = 1.0;

  const findMod = (actId: string) => modules.find((m) => m.activityIds.includes(actId));
  const getState = () => ({
    activeView, selectedModuleId, selectedActivityId,
    mapSelectedModuleId: selectedModuleId, outlineSelectedModuleId: selectedModuleId,
    mapSelectedActivityId: selectedActivityId, outlineSelectedActivityId: selectedActivityId,
    filters, zoomLevel, modules,
  });

  return {
    getState,
    switchView(view: PlanSynchronizedView) {
      activeView = view;
      return getState();
    },
    selectModule(moduleId: string, _sourceView?: PlanSynchronizedView) {
      selectedModuleId = moduleId;
      const mod = modules.find((m) => m.moduleId === moduleId);
      if (mod?.activityIds.length && (!selectedActivityId || !mod.activityIds.includes(selectedActivityId))) {
        selectedActivityId = mod.activityIds[0] ?? null;
      }
      return getState();
    },
    selectActivity(activityId: string, explicitModuleId?: string, _sourceView?: PlanSynchronizedView) {
      selectedActivityId = activityId;
      selectedModuleId = explicitModuleId ?? findMod(activityId)?.moduleId ?? selectedModuleId;
      return getState();
    },
    setFilters(nextFilters: Partial<PlanFilters>) {
      filters = { ...filters, ...nextFilters };
      return getState();
    },
    handleKeyboardNavigation(key: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End") {
      if (!modules.length) return getState();
      const idx = Math.max(0, modules.findIndex((m) => m.moduleId === selectedModuleId));
      const nextIdx =
        key === "ArrowDown" || key === "ArrowRight" ? Math.min(modules.length - 1, idx + 1)
        : key === "ArrowUp" || key === "ArrowLeft" ? Math.max(0, idx - 1)
        : key === "Home" ? 0 : modules.length - 1;
      const target = modules[nextIdx];
      if (target) {
        selectedModuleId = target.moduleId;
        selectedActivityId = target.activityIds[0] ?? selectedActivityId;
      }
      return getState();
    },
    applyMapViewportControl(control: MapNonDraggingControl) {
      zoomLevel =
        control === "zoom_in" ? clamp(Number((zoomLevel + 0.25).toFixed(2)), 0.5, 2.0)
        : control === "zoom_out" ? clamp(Number((zoomLevel - 0.25).toFixed(2)), 0.5, 2.0) : 1.0;
      return getState();
    },
    getAvailableActions: (_view: PlanSynchronizedView): readonly PlanActionId[] => PLAN_ACTION_IDS,
    getParityReport: () => ({
      selectionSynchronized: true, filtersSynchronized: true,
      mapActions: PLAN_ACTION_IDS, outlineActions: PLAN_ACTION_IDS,
      mapNonDraggingControls: MAP_NON_DRAGGING_CONTROLS, actionsEquivalent: true,
      requiresDragging: false as const, keyboardReachable: true as const, singlePointerReachable: true as const,
    }),
    studyAhead(activityId: string, unmetPrerequisiteIds: readonly string[] = []) {
      selectedActivityId = activityId;
      selectedModuleId = findMod(activityId)?.moduleId ?? selectedModuleId;
      return {
        action: "study_ahead" as const, startedActivityId: activityId, unmetPrerequisiteIds,
        prerequisiteActivitiesCompletedOrSkipped: false as const, waiverCreated: false as const,
        proficiencyChanged: false as const, demonstrationGateSatisfied: false as const,
        bypassesResourceRightsOrPaidAuth: false as const,
      };
    },
    skipActivity(activityId: string) {
      selectedActivityId = activityId;
      return {
        action: "skip_activity" as const, skippedActivityId: activityId,
        recordedStatus: "self_reported_skipped" as const,
        prerequisiteEvidenceManufactured: false as const, bypassesResourceRightsOrPaidAuth: false as const,
      };
    },
  };
}
export type PlanViewController = ReturnType<typeof createPlanViewController>;
export type PlanViewState = ReturnType<PlanViewController["getState"]>;
export type PlanParityReport = ReturnType<PlanViewController["getParityReport"]>;
export type StudyAheadActionOutcome = ReturnType<PlanViewController["studyAhead"]>;
export type SkipActivityActionOutcome = ReturnType<PlanViewController["skipActivity"]>;

export interface NavigationRouteContext {
  readonly topLevel: TopLevelDestination; readonly learnSubDestination: LearnSubDestination;
  readonly planView: PlanSynchronizedView; readonly selectedSyllabusId: string | null;
  readonly selectedRevisionId: string | null; readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
}

export function createNavigationShellController(options?: {
  readonly initialAccountId?: string | null; readonly initialSyllabusId?: string | null;
  readonly initialViewportWidthPx?: number; readonly initialTextScalePercent?: number;
  readonly initialAppearance?: AppearancePreferences; readonly planModules?: readonly PlanModuleDescriptor[];
}) {
  const planController = createPlanViewController(options?.planModules ? { modules: options.planModules } : undefined);
  let accountId: string | null = options?.initialAccountId ?? "learner-default";
  let current: NavigationRouteContext = {
    topLevel: "Learn", learnSubDestination: "Today", planView: planController.getState().activeView,
    selectedSyllabusId: options?.initialSyllabusId ?? "syllabus-default", selectedRevisionId: null,
    selectedModuleId: planController.getState().selectedModuleId, selectedActivityId: planController.getState().selectedActivityId,
  };
  const historyStack: NavigationRouteContext[] = [];
  let pendingSignInReturn: NavigationRouteContext | null = null;
  let privateDraftCacheKeys: string[] = accountId ? [`draft:${accountId}:intake`] : [];
  let appearance: AppearancePreferences = {
    themePreference: options?.initialAppearance?.themePreference ?? "system",
    solidSurfaces: options?.initialAppearance?.solidSurfaces ?? false,
    reduceMotion: options?.initialAppearance?.reduceMotion ?? false,
  };
  let layout = resolveResponsiveLayout(options?.initialViewportWidthPx ?? 1280, options?.initialTextScalePercent ?? 100);

  const syncFromPlan = () => {
    const s = planController.getState();
    current = { ...current, planView: s.activeView, selectedModuleId: s.selectedModuleId, selectedActivityId: s.selectedActivityId };
  };

  const applyRouteToPlan = (route: Partial<NavigationRouteContext>) => {
    if (route.planView) planController.switchView(route.planView);
    if (route.selectedModuleId) planController.selectModule(route.selectedModuleId);
    if (route.selectedActivityId) planController.selectActivity(route.selectedActivityId, route.selectedModuleId ?? undefined);
  };

  const pushHistory = (next: NavigationRouteContext) => {
    historyStack.push(current);
    current = next;
  };

  const getState = () => {
    syncFromPlan();
    return {
      accountId, current, historyDepth: historyStack.length, pendingSignInReturn,
      privateDraftCacheKeys: [...privateDraftCacheKeys] as readonly string[], appearance, layout,
    };
  };

  return {
    getState,
    navigateTopLevel(destination: TopLevelDestination) {
      syncFromPlan();
      pushHistory({ ...current, topLevel: destination });
      return getState();
    },
    navigateLearnSubDestination(subDestination: LearnSubDestination) {
      syncFromPlan();
      pushHistory({ ...current, topLevel: "Learn", learnSubDestination: subDestination });
      return getState();
    },
    navigateDeepLink(partial: Partial<NavigationRouteContext>) {
      applyRouteToPlan(partial);
      syncFromPlan();
      pushHistory({ ...current, ...partial });
      return getState();
    },
    navigateBack() {
      const previous = historyStack.pop();
      if (previous) {
        current = previous;
        applyRouteToPlan(previous);
      }
      return getState();
    },
    updateViewport(viewportWidthPx: number, textScalePercent = 100) {
      layout = resolveResponsiveLayout(viewportWidthPx, textScalePercent);
      return layout;
    },
    updateAppearance(nextAppearance: Partial<AppearancePreferences>) {
      appearance = { ...appearance, ...nextAppearance };
      return getState();
    },
    preserveSignInReturnContext(): NavigationRouteContext {
      syncFromPlan();
      pendingSignInReturn = { ...current };
      return pendingSignInReturn;
    },
    completeSignInReturn(newAccountId: string) {
      if (accountId !== newAccountId) privateDraftCacheKeys = [`draft:${newAccountId}:session`];
      accountId = newAccountId;
      current = { ...(pendingSignInReturn ?? current) };
      pendingSignInReturn = null;
      return {
        accountId: newAccountId, restoredContext: current,
        autoVoteTriggered: false as const, autoPublishTriggered: false as const,
        autoActivateTriggered: false as const, autoPaymentTriggered: false as const,
      };
    },
    handleAccountSwitch(newAccountId: string | null) {
      accountId = newAccountId;
      privateDraftCacheKeys = newAccountId ? [`draft:${newAccountId}:clean`] : [];
      return getState();
    },
    openExternalResource(activityId: string, resourceUrl: string) {
      const safe = isSafeResourceUrl(resourceUrl);
      planController.selectActivity(activityId);
      syncFromPlan();
      return {
        activityId, resourceUrl, openedExternally: safe,
        markedCompletedOnOpen: false as const, demonstratedCompetenceOnOpen: false as const,
      };
    },
    selectAssessmentOption: (questionId: string, selectedOptionId: string) => ({
      questionId, selectedOptionId, submitted: false as const, advancedToNextQuestion: false as const,
    }),
    evaluateSurfaceContractSupport(
      operationId: string,
      userRoles: readonly string[] = ["learner"],
      requiredRole?: string,
    ) {
      if (requiredRole && !userRoles.includes(requiredRole)) {
        return {
          status: "unauthorized_role" as const, operationId, simulatedSuccessRendered: false as const,
          message: `Role "${requiredRole}" is required to operate surface "${operationId}".`,
          actionableNextStep: "Return to Learn or sign in with an authorized curator/moderator account.",
        };
      }
      if (!(operationId in OPENAPI_OPERATIONS)) {
        return {
          status: "unsupported_contract" as const, operationId, simulatedSuccessRendered: false as const,
          message: `Operation "${operationId}" is not backed by an active OpenAPI contract in this release.`,
          actionableNextStep: "Use a supported workflow in Learn, Explore, or Settings.",
        };
      }
      return {
        status: "authorized_and_supported" as const, operationId: operationId as OperationId,
        simulatedSuccessRendered: false as const,
        message: `Operation "${operationId}" is backed by a verified contract.`,
        actionableNextStep: "Proceed with the explicit user action.",
      };
    },
    planController,
  };
}
export type NavigationShellController = ReturnType<typeof createNavigationShellController>;
export type NavigationShellState = ReturnType<NavigationShellController["getState"]>;
export type SignInReturnTransition = ReturnType<NavigationShellController["completeSignInReturn"]>;
export type ExternalResourceNavigationOutcome = ReturnType<NavigationShellController["openExternalResource"]>;
export type AssessmentSelectionOutcome = ReturnType<NavigationShellController["selectAssessmentOption"]>;
export type ContractSurfaceGuardResult = ReturnType<NavigationShellController["evaluateSurfaceContractSupport"]>;

export function getWebShellBootstrapSummary() {
  return {
    specSha256: CANONICAL_SPEC_SHA256,
    topLevelDestinations: TOP_LEVEL_DESTINATIONS,
    learnSubDestinations: LEARN_SUB_DESTINATIONS,
    planSynchronizedViews: PLAN_SYNCHRONIZED_VIEWS,
    operationCount: Object.keys(OPENAPI_OPERATIONS).length,
    lightCanvasColor: UI_TOKENS.colors.canvas.light,
  };
}
export type WebShellBootstrapSummary = ReturnType<typeof getWebShellBootstrapSummary>;
