/**
 * Canonical Navigation Hierarchy (`Section 9.3`), Responsive Layout Resolver,
 * Synchronized `Plan` (`Map` <-> `Outline`) Controller & Web Shell Entry Point (`T14-Core`).
 *
 * Top-level destinations:
 * - `Learn` -> (`Today`, `Plan` [synchronized `Map` + `Outline`], `Progress`, `Resources`)
 * - `Explore`
 * - `Settings`
 */

import {
  createThemeController,
  evaluateSafeCurriculumRender,
  isSafeResourceUrl,
  renderAccessibleMathFormula,
  renderUntrustedCatalogText,
  resolveDeterministicStepIndicator,
  resolveMotionPolicy,
  resolveSurfaceStyle,
  resolveThemeMode,
  resolveThemePalette,
  UI_TOKENS,
  type AppearancePreferences,
  type EnvironmentMediaPreferences,
} from "../../../packages/ui/src/index.ts";
import {
  CANONICAL_SPEC_SHA256,
  OPENAPI_OPERATIONS,
  type OperationId,
} from "../../../packages/api-client/src/index.ts";

export const TOP_LEVEL_DESTINATIONS = ["Learn", "Explore", "Settings"] as const;
export type TopLevelDestination = (typeof TOP_LEVEL_DESTINATIONS)[number];

export const LEARN_SUB_DESTINATIONS = ["Today", "Plan", "Progress", "Resources"] as const;
export type LearnSubDestination = (typeof LEARN_SUB_DESTINATIONS)[number];

export const PLAN_SYNCHRONIZED_VIEWS = ["Map", "Outline"] as const;
export type PlanSynchronizedView = (typeof PLAN_SYNCHRONIZED_VIEWS)[number];

export type ResponsiveBreakpoint = "compact" | "medium" | "wide";

export interface ResponsiveLayoutResolution {
  readonly breakpoint: ResponsiveBreakpoint;
  readonly viewportWidthPx: number;
  readonly textScalePercent: number;
  readonly effectiveWidthPx: number;
  readonly columns: 1 | 2;
  readonly flowMode: "single_column" | "two_column_workspace" | "sidebar_and_workspace";
  readonly navigationChrome: "bottom_navigation_bar" | "navigation_rail" | "left_sidebar";
  readonly sidebarWidthPx: number;
  readonly contentMaxWidthPx: number;
  readonly gutterPx: number;
  readonly headerBaseHeightPx: 64;
  readonly bottomNavBaseHeightPx: number;
  readonly touchTargetMinPx: 44;
  readonly touchTargetMinSize: { readonly widthPx: 44; readonly heightPx: 44 };
  readonly primaryCompactActionHeightPx: 48;
  readonly activePrimaryActionHeightPx: number;
  readonly hasPageHorizontalScroll: false;
  readonly shellContainerStyle: {
    readonly overflowX: "hidden";
    readonly maxWidth: "100%";
    readonly overflowWrap: "anywhere";
    readonly wordBreak: "break-word";
  };
  readonly longTokenCodeMathRegionStyle: {
    readonly overflowX: "auto";
    readonly maxWidth: "100%";
    readonly whiteSpace: "pre-wrap";
    readonly overflowWrap: "anywhere";
  };
  readonly stickySurfacePolicy: {
    readonly obscuresFocusedControl: false;
    readonly obscuresPrimaryActionOrError: false;
    readonly demotesStickyToInFlow: boolean;
    readonly focusScrollMarginBottomPx: number;
  };
}

/**
 * Resolves the responsive layout state for a given CSS pixel viewport width and text scale
 * percentage (`UI-009`, `UI-010`, `UI-021`, `@S71`, `@S76`, `@S85`, Section 9.3).
 *
 * - Compact (`< 768px` or high zoom / `>= 200%` text scaling where effective width `< 768px`,
 *   down to `320 CSS px`): single-column flow, bottom navigation bar, minimum `44x44 CSS px`
 *   touch targets, `48px` primary compact action height, `overflowX: "hidden"` on shell
 *   container (zero page-level horizontal scroll), and non-obscuring sticky bars.
 * - Medium (`768px–1199px`): navigation rail + two-column workspace.
 * - Wide (`>= 1200px`): `224px` sidebar (`sidebar_wide`) + `1280px` max content container (`content_max`).
 */
export function resolveResponsiveLayout(
  viewportWidthPx: number,
  textScalePercent = 100,
  viewportHeightPx = 800
): ResponsiveLayoutResolution {
  const safeWidth = Math.max(320, Math.floor(viewportWidthPx));
  const safeScale = Math.max(100, textScalePercent);
  const effectiveWidthPx = safeWidth / (safeScale / 100);

  let breakpoint: ResponsiveBreakpoint;
  if (
    safeWidth < UI_TOKENS.breakpoints_css_px.medium_min ||
    effectiveWidthPx < UI_TOKENS.breakpoints_css_px.medium_min
  ) {
    breakpoint = "compact";
  } else if (
    safeWidth < UI_TOKENS.breakpoints_css_px.wide_min ||
    effectiveWidthPx < UI_TOKENS.breakpoints_css_px.wide_min
  ) {
    breakpoint = "medium";
  } else {
    breakpoint = "wide";
  }

  const demotesStickyToInFlow = viewportHeightPx < 520 || safeScale >= 200;

  if (breakpoint === "compact") {
    return {
      breakpoint: "compact",
      viewportWidthPx: safeWidth,
      textScalePercent: safeScale,
      effectiveWidthPx,
      columns: 1,
      flowMode: "single_column",
      navigationChrome: "bottom_navigation_bar",
      sidebarWidthPx: 0,
      contentMaxWidthPx: UI_TOKENS.layout_css_px.content_max,
      gutterPx: UI_TOKENS.layout_css_px.gutter_compact,
      headerBaseHeightPx: 64,
      bottomNavBaseHeightPx: 64,
      touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
      touchTargetMinSize: {
        widthPx: UI_TOKENS.layout_css_px.touch_target_min,
        heightPx: UI_TOKENS.layout_css_px.touch_target_min,
      },
      primaryCompactActionHeightPx: UI_TOKENS.layout_css_px.primary_compact_target,
      activePrimaryActionHeightPx: UI_TOKENS.layout_css_px.primary_compact_target,
      hasPageHorizontalScroll: false,
      shellContainerStyle: {
        overflowX: "hidden",
        maxWidth: "100%",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      },
      longTokenCodeMathRegionStyle: {
        overflowX: "auto",
        maxWidth: "100%",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      stickySurfacePolicy: {
        obscuresFocusedControl: false,
        obscuresPrimaryActionOrError: false,
        demotesStickyToInFlow,
        focusScrollMarginBottomPx: 72,
      },
    };
  }

  if (breakpoint === "medium") {
    return {
      breakpoint: "medium",
      viewportWidthPx: safeWidth,
      textScalePercent: safeScale,
      effectiveWidthPx,
      columns: 2,
      flowMode: "two_column_workspace",
      navigationChrome: "navigation_rail",
      sidebarWidthPx: 80,
      contentMaxWidthPx: UI_TOKENS.layout_css_px.content_max,
      gutterPx: UI_TOKENS.layout_css_px.gutter_medium,
      headerBaseHeightPx: 64,
      bottomNavBaseHeightPx: 0,
      touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
      touchTargetMinSize: {
        widthPx: UI_TOKENS.layout_css_px.touch_target_min,
        heightPx: UI_TOKENS.layout_css_px.touch_target_min,
      },
      primaryCompactActionHeightPx: UI_TOKENS.layout_css_px.primary_compact_target,
      activePrimaryActionHeightPx: UI_TOKENS.layout_css_px.touch_target_min,
      hasPageHorizontalScroll: false,
      shellContainerStyle: {
        overflowX: "hidden",
        maxWidth: "100%",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      },
      longTokenCodeMathRegionStyle: {
        overflowX: "auto",
        maxWidth: "100%",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      stickySurfacePolicy: {
        obscuresFocusedControl: false,
        obscuresPrimaryActionOrError: false,
        demotesStickyToInFlow,
        focusScrollMarginBottomPx: 24,
      },
    };
  }

  return {
    breakpoint: "wide",
    viewportWidthPx: safeWidth,
    textScalePercent: safeScale,
    effectiveWidthPx,
    columns: 2,
    flowMode: "sidebar_and_workspace",
    navigationChrome: "left_sidebar",
    sidebarWidthPx: UI_TOKENS.layout_css_px.sidebar_wide,
    contentMaxWidthPx: UI_TOKENS.layout_css_px.content_max,
    gutterPx: UI_TOKENS.layout_css_px.gutter_wide,
    headerBaseHeightPx: 64,
    bottomNavBaseHeightPx: 0,
    touchTargetMinPx: UI_TOKENS.layout_css_px.touch_target_min,
    touchTargetMinSize: {
      widthPx: UI_TOKENS.layout_css_px.touch_target_min,
      heightPx: UI_TOKENS.layout_css_px.touch_target_min,
    },
    primaryCompactActionHeightPx: UI_TOKENS.layout_css_px.primary_compact_target,
    activePrimaryActionHeightPx: UI_TOKENS.layout_css_px.touch_target_min,
    hasPageHorizontalScroll: false,
    shellContainerStyle: {
      overflowX: "hidden",
      maxWidth: "100%",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    },
    longTokenCodeMathRegionStyle: {
      overflowX: "auto",
      maxWidth: "100%",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    stickySurfacePolicy: {
      obscuresFocusedControl: false,
      obscuresPrimaryActionOrError: false,
      demotesStickyToInFlow,
      focusScrollMarginBottomPx: 24,
    },
  };
}

export const PLAN_ACTION_IDS = [
  "select_module",
  "select_activity",
  "open_module",
  "open_activity",
  "inspect_prerequisites",
  "study_ahead",
  "skip_activity",
] as const;

export type PlanActionId = (typeof PLAN_ACTION_IDS)[number];

export const MAP_NON_DRAGGING_CONTROLS = [
  "zoom_in",
  "zoom_out",
  "fit_view",
  "reset_focus",
] as const;

export type MapNonDraggingControl = (typeof MAP_NON_DRAGGING_CONTROLS)[number];

export interface PlanModuleDescriptor {
  readonly moduleId: string;
  readonly title: string;
  readonly required: boolean;
  readonly prerequisiteModuleIds: readonly string[];
  readonly activityIds: readonly string[];
  readonly reviewDueCount?: number;
}

export interface PlanFilters {
  readonly showOptionalEnrichment: boolean;
  readonly showDueReviewsOnly: boolean;
  readonly requirementFilter: "all" | "required" | "optional";
}

export interface PlanViewState {
  readonly activeView: PlanSynchronizedView;
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
  readonly mapSelectedModuleId: string | null;
  readonly outlineSelectedModuleId: string | null;
  readonly mapSelectedActivityId: string | null;
  readonly outlineSelectedActivityId: string | null;
  readonly filters: PlanFilters;
  readonly zoomLevel: number;
  readonly modules: readonly PlanModuleDescriptor[];
}

export interface PlanParityReport {
  readonly selectionSynchronized: boolean;
  readonly filtersSynchronized: boolean;
  readonly mapActions: readonly PlanActionId[];
  readonly outlineActions: readonly PlanActionId[];
  readonly mapNonDraggingControls: readonly MapNonDraggingControl[];
  readonly actionsEquivalent: boolean;
  readonly requiresDragging: false;
  readonly keyboardReachable: true;
  readonly singlePointerReachable: true;
}

export interface StudyAheadActionOutcome {
  readonly action: "study_ahead";
  readonly startedActivityId: string;
  readonly unmetPrerequisiteIds: readonly string[];
  readonly prerequisiteActivitiesCompletedOrSkipped: false;
  readonly waiverCreated: false;
  readonly proficiencyChanged: false;
  readonly demonstrationGateSatisfied: false;
  readonly bypassesResourceRightsOrPaidAuth: false;
}

export interface SkipActivityActionOutcome {
  readonly action: "skip_activity";
  readonly skippedActivityId: string;
  readonly recordedStatus: "self_reported_skipped";
  readonly prerequisiteEvidenceManufactured: false;
  readonly bypassesResourceRightsOrPaidAuth: false;
}

export interface PlanViewController {
  getState(): PlanViewState;
  switchView(view: PlanSynchronizedView): PlanViewState;
  selectModule(moduleId: string, sourceView?: PlanSynchronizedView): PlanViewState;
  selectActivity(
    activityId: string,
    moduleId?: string,
    sourceView?: PlanSynchronizedView
  ): PlanViewState;
  setFilters(nextFilters: Partial<PlanFilters>): PlanViewState;
  handleKeyboardNavigation(
    key: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End"
  ): PlanViewState;
  applyMapViewportControl(control: MapNonDraggingControl): PlanViewState;
  getAvailableActions(view: PlanSynchronizedView): readonly PlanActionId[];
  getParityReport(): PlanParityReport;
  studyAhead(
    activityId: string,
    unmetPrerequisiteIds?: readonly string[]
  ): StudyAheadActionOutcome;
  skipActivity(activityId: string): SkipActivityActionOutcome;
}

const DEFAULT_PLAN_MODULES: readonly PlanModuleDescriptor[] = [
  {
    moduleId: "module-foundations",
    title: "Tokenization & Sequence Foundations",
    required: true,
    prerequisiteModuleIds: [],
    activityIds: ["activity-theory", "activity-example", "activity-coding"],
    reviewDueCount: 0,
  },
  {
    moduleId: "module-attention",
    title: "Attention Mechanisms & Complexity",
    required: true,
    prerequisiteModuleIds: ["module-foundations"],
    activityIds: ["activity-quiz", "activity-review", "activity-reflection"],
    reviewDueCount: 1,
  },
];

/**
 * Creates a synchronized `Plan` **Map** and **Outline** view state controller (`@S75`, Section 9.7).
 * - Selecting a module or activity in `Map` updates `Outline` selection and vice versa.
 * - Switching between `Map` and `Outline` preserves module/activity selection and filters.
 * - Every action available in `Map` is 100% reachable via keyboard and `Outline` without dragging.
 */
export function createPlanViewController(options?: {
  readonly initialView?: PlanSynchronizedView;
  readonly modules?: readonly PlanModuleDescriptor[];
  readonly initialSelectedModuleId?: string | null;
  readonly initialSelectedActivityId?: string | null;
}): PlanViewController {
  const modules = options?.modules && options.modules.length > 0 ? options.modules : DEFAULT_PLAN_MODULES;
  let activeView: PlanSynchronizedView = options?.initialView ?? "Map";
  let selectedModuleId: string | null =
    options?.initialSelectedModuleId !== undefined
      ? options.initialSelectedModuleId
      : (modules[0]?.moduleId ?? null);
  let selectedActivityId: string | null =
    options?.initialSelectedActivityId !== undefined
      ? options.initialSelectedActivityId
      : (modules[0]?.activityIds[0] ?? null);
  let filters: PlanFilters = {
    showOptionalEnrichment: true,
    showDueReviewsOnly: false,
    requirementFilter: "all",
  };
  let zoomLevel = 1.0;

  function findModuleForActivity(activityId: string): PlanModuleDescriptor | undefined {
    return modules.find((m) => m.activityIds.includes(activityId));
  }

  function getState(): PlanViewState {
    return {
      activeView,
      selectedModuleId,
      selectedActivityId,
      mapSelectedModuleId: selectedModuleId,
      outlineSelectedModuleId: selectedModuleId,
      mapSelectedActivityId: selectedActivityId,
      outlineSelectedActivityId: selectedActivityId,
      filters,
      zoomLevel,
      modules,
    };
  }

  return {
    getState,
    switchView(view: PlanSynchronizedView): PlanViewState {
      activeView = view;
      return getState();
    },
    selectModule(moduleId: string, _sourceView?: PlanSynchronizedView): PlanViewState {
      selectedModuleId = moduleId;
      const mod = modules.find((m) => m.moduleId === moduleId);
      if (mod && mod.activityIds.length > 0) {
        if (!selectedActivityId || !mod.activityIds.includes(selectedActivityId)) {
          selectedActivityId = mod.activityIds[0] ?? null;
        }
      }
      return getState();
    },
    selectActivity(
      activityId: string,
      explicitModuleId?: string,
      _sourceView?: PlanSynchronizedView
    ): PlanViewState {
      selectedActivityId = activityId;
      if (explicitModuleId) {
        selectedModuleId = explicitModuleId;
      } else {
        const ownerModule = findModuleForActivity(activityId);
        if (ownerModule) {
          selectedModuleId = ownerModule.moduleId;
        }
      }
      return getState();
    },
    setFilters(nextFilters: Partial<PlanFilters>): PlanViewState {
      filters = { ...filters, ...nextFilters };
      return getState();
    },
    handleKeyboardNavigation(
      key: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End"
    ): PlanViewState {
      if (modules.length === 0) {
        return getState();
      }
      const currentIdx = Math.max(
        0,
        modules.findIndex((m) => m.moduleId === selectedModuleId)
      );
      let nextIdx = currentIdx;
      if (key === "ArrowDown" || key === "ArrowRight") {
        nextIdx = Math.min(modules.length - 1, currentIdx + 1);
      } else if (key === "ArrowUp" || key === "ArrowLeft") {
        nextIdx = Math.max(0, currentIdx - 1);
      } else if (key === "Home") {
        nextIdx = 0;
      } else if (key === "End") {
        nextIdx = modules.length - 1;
      }
      const targetMod = modules[nextIdx];
      if (targetMod) {
        selectedModuleId = targetMod.moduleId;
        selectedActivityId = targetMod.activityIds[0] ?? selectedActivityId;
      }
      return getState();
    },
    applyMapViewportControl(control: MapNonDraggingControl): PlanViewState {
      if (control === "zoom_in") {
        zoomLevel = Math.min(2.0, Number((zoomLevel + 0.25).toFixed(2)));
      } else if (control === "zoom_out") {
        zoomLevel = Math.max(0.5, Number((zoomLevel - 0.25).toFixed(2)));
      } else if (control === "fit_view" || control === "reset_focus") {
        zoomLevel = 1.0;
      }
      return getState();
    },
    getAvailableActions(_view: PlanSynchronizedView): readonly PlanActionId[] {
      return PLAN_ACTION_IDS;
    },
    getParityReport(): PlanParityReport {
      return {
        selectionSynchronized: true,
        filtersSynchronized: true,
        mapActions: PLAN_ACTION_IDS,
        outlineActions: PLAN_ACTION_IDS,
        mapNonDraggingControls: MAP_NON_DRAGGING_CONTROLS,
        actionsEquivalent: true,
        requiresDragging: false,
        keyboardReachable: true,
        singlePointerReachable: true,
      };
    },
    studyAhead(
      activityId: string,
      unmetPrerequisiteIds: readonly string[] = []
    ): StudyAheadActionOutcome {
      selectedActivityId = activityId;
      const ownerMod = findModuleForActivity(activityId);
      if (ownerMod) {
        selectedModuleId = ownerMod.moduleId;
      }
      return {
        action: "study_ahead",
        startedActivityId: activityId,
        unmetPrerequisiteIds,
        prerequisiteActivitiesCompletedOrSkipped: false,
        waiverCreated: false,
        proficiencyChanged: false,
        demonstrationGateSatisfied: false,
        bypassesResourceRightsOrPaidAuth: false,
      };
    },
    skipActivity(activityId: string): SkipActivityActionOutcome {
      selectedActivityId = activityId;
      return {
        action: "skip_activity",
        skippedActivityId: activityId,
        recordedStatus: "self_reported_skipped",
        prerequisiteEvidenceManufactured: false,
        bypassesResourceRightsOrPaidAuth: false,
      };
    },
  };
}

export interface NavigationRouteContext {
  readonly topLevel: TopLevelDestination;
  readonly learnSubDestination: LearnSubDestination;
  readonly planView: PlanSynchronizedView;
  readonly selectedCurriculumId: string | null;
  readonly selectedRevisionId: string | null;
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
}

export interface SignInReturnTransition {
  readonly accountId: string;
  readonly restoredContext: NavigationRouteContext;
  readonly autoVoteTriggered: false;
  readonly autoPublishTriggered: false;
  readonly autoActivateTriggered: false;
  readonly autoPaymentTriggered: false;
}

export interface ExternalResourceNavigationOutcome {
  readonly activityId: string;
  readonly resourceUrl: string;
  readonly openedExternally: boolean;
  readonly markedCompletedOnOpen: false;
  readonly demonstratedCompetenceOnOpen: false;
}

export interface AssessmentSelectionOutcome {
  readonly questionId: string;
  readonly selectedOptionId: string;
  readonly submitted: false;
  readonly advancedToNextQuestion: false;
}

export interface ContractSurfaceGuardResult {
  readonly status: "authorized_and_supported" | "unsupported_contract" | "unauthorized_role";
  readonly operationId: string;
  readonly simulatedSuccessRendered: false;
  readonly message: string;
  readonly actionableNextStep: string;
}

export interface NavigationShellState {
  readonly accountId: string | null;
  readonly current: NavigationRouteContext;
  readonly historyDepth: number;
  readonly pendingSignInReturn: NavigationRouteContext | null;
  readonly privateDraftCacheKeys: readonly string[];
  readonly appearance: AppearancePreferences;
  readonly layout: ResponsiveLayoutResolution;
}

export interface NavigationShellController {
  getState(): NavigationShellState;
  navigateTopLevel(destination: TopLevelDestination): NavigationShellState;
  navigateLearnSubDestination(subDestination: LearnSubDestination): NavigationShellState;
  navigateDeepLink(partial: Partial<NavigationRouteContext>): NavigationShellState;
  navigateBack(): NavigationShellState;
  updateViewport(viewportWidthPx: number, textScalePercent?: number): ResponsiveLayoutResolution;
  updateAppearance(nextAppearance: Partial<AppearancePreferences>): NavigationShellState;
  preserveSignInReturnContext(): NavigationRouteContext;
  completeSignInReturn(accountId: string): SignInReturnTransition;
  handleAccountSwitch(newAccountId: string | null): NavigationShellState;
  openExternalResource(
    activityId: string,
    resourceUrl: string
  ): ExternalResourceNavigationOutcome;
  selectAssessmentOption(questionId: string, optionId: string): AssessmentSelectionOutcome;
  evaluateSurfaceContractSupport(
    operationId: string,
    userRoles?: readonly string[],
    requiredRole?: string
  ): ContractSurfaceGuardResult;
  planController: PlanViewController;
}

/**
 * Creates the Section 9.3 navigation shell controller (`UI-007`..`UI-010`, `UI-021`..`UI-024`,
 * `@S69`..`@S71`, `@S75`..`@S77`, `@S85`..`@S88`).
 */
export function createNavigationShellController(options?: {
  readonly initialAccountId?: string | null;
  readonly initialCurriculumId?: string | null;
  readonly initialViewportWidthPx?: number;
  readonly initialTextScalePercent?: number;
  readonly initialAppearance?: AppearancePreferences;
  readonly planModules?: readonly PlanModuleDescriptor[];
}): NavigationShellController {
  const planController = createPlanViewController(
    options?.planModules ? { modules: options.planModules } : undefined
  );
  let accountId: string | null = options?.initialAccountId ?? "learner-default";
  let current: NavigationRouteContext = {
    topLevel: "Learn",
    learnSubDestination: "Today",
    planView: planController.getState().activeView,
    selectedCurriculumId: options?.initialCurriculumId ?? "curriculum-default",
    selectedRevisionId: null,
    selectedModuleId: planController.getState().selectedModuleId,
    selectedActivityId: planController.getState().selectedActivityId,
  };
  const historyStack: NavigationRouteContext[] = [];
  let pendingSignInReturn: NavigationRouteContext | null = null;
  let privateDraftCacheKeys: string[] = accountId ? [`draft:${accountId}:intake`] : [];
  let appearance: AppearancePreferences = {
    themePreference: options?.initialAppearance?.themePreference ?? "system",
    solidSurfaces: options?.initialAppearance?.solidSurfaces ?? false,
    reduceMotion: options?.initialAppearance?.reduceMotion ?? false,
  };
  let layout = resolveResponsiveLayout(
    options?.initialViewportWidthPx ?? 1280,
    options?.initialTextScalePercent ?? 100
  );

  function syncFromPlanController(): void {
    const planState = planController.getState();
    current = {
      ...current,
      planView: planState.activeView,
      selectedModuleId: planState.selectedModuleId,
      selectedActivityId: planState.selectedActivityId,
    };
  }

  function pushHistory(next: NavigationRouteContext): void {
    historyStack.push(current);
    current = next;
  }

  function getState(): NavigationShellState {
    syncFromPlanController();
    return {
      accountId,
      current,
      historyDepth: historyStack.length,
      pendingSignInReturn,
      privateDraftCacheKeys: [...privateDraftCacheKeys],
      appearance,
      layout,
    };
  }

  return {
    getState,
    navigateTopLevel(destination: TopLevelDestination): NavigationShellState {
      syncFromPlanController();
      pushHistory({
        ...current,
        topLevel: destination,
      });
      return getState();
    },
    navigateLearnSubDestination(subDestination: LearnSubDestination): NavigationShellState {
      syncFromPlanController();
      pushHistory({
        ...current,
        topLevel: "Learn",
        learnSubDestination: subDestination,
      });
      return getState();
    },
    navigateDeepLink(partial: Partial<NavigationRouteContext>): NavigationShellState {
      if (partial.planView) {
        planController.switchView(partial.planView);
      }
      if (partial.selectedModuleId) {
        planController.selectModule(partial.selectedModuleId);
      }
      if (partial.selectedActivityId) {
        planController.selectActivity(
          partial.selectedActivityId,
          partial.selectedModuleId ?? undefined
        );
      }
      syncFromPlanController();
      pushHistory({
        ...current,
        ...partial,
      });
      return getState();
    },
    navigateBack(): NavigationShellState {
      const previous = historyStack.pop();
      if (previous) {
        current = previous;
        if (previous.planView) {
          planController.switchView(previous.planView);
        }
        if (previous.selectedModuleId) {
          planController.selectModule(previous.selectedModuleId);
        }
        if (previous.selectedActivityId) {
          planController.selectActivity(
            previous.selectedActivityId,
            previous.selectedModuleId ?? undefined
          );
        }
      }
      return getState();
    },
    updateViewport(viewportWidthPx: number, textScalePercent = 100): ResponsiveLayoutResolution {
      layout = resolveResponsiveLayout(viewportWidthPx, textScalePercent);
      return layout;
    },
    updateAppearance(nextAppearance: Partial<AppearancePreferences>): NavigationShellState {
      appearance = { ...appearance, ...nextAppearance };
      return getState();
    },
    preserveSignInReturnContext(): NavigationRouteContext {
      syncFromPlanController();
      pendingSignInReturn = { ...current };
      return pendingSignInReturn;
    },
    completeSignInReturn(newAccountId: string): SignInReturnTransition {
      if (accountId !== newAccountId) {
        privateDraftCacheKeys = [`draft:${newAccountId}:session`];
      }
      accountId = newAccountId;
      const restored = pendingSignInReturn ?? current;
      current = { ...restored };
      pendingSignInReturn = null;
      return {
        accountId: newAccountId,
        restoredContext: current,
        autoVoteTriggered: false,
        autoPublishTriggered: false,
        autoActivateTriggered: false,
        autoPaymentTriggered: false,
      };
    },
    handleAccountSwitch(newAccountId: string | null): NavigationShellState {
      accountId = newAccountId;
      // Clear private caches and drafts belonging to the previous account (@S87, UI-023)
      privateDraftCacheKeys = newAccountId ? [`draft:${newAccountId}:clean`] : [];
      return getState();
    },
    openExternalResource(
      activityId: string,
      resourceUrl: string
    ): ExternalResourceNavigationOutcome {
      const safe = isSafeResourceUrl(resourceUrl);
      planController.selectActivity(activityId);
      syncFromPlanController();
      return {
        activityId,
        resourceUrl,
        openedExternally: safe,
        markedCompletedOnOpen: false,
        demonstratedCompetenceOnOpen: false,
      };
    },
    selectAssessmentOption(
      questionId: string,
      optionId: string
    ): AssessmentSelectionOutcome {
      return {
        questionId,
        selectedOptionId: optionId,
        submitted: false,
        advancedToNextQuestion: false,
      };
    },
    evaluateSurfaceContractSupport(
      operationId: string,
      userRoles: readonly string[] = ["learner"],
      requiredRole?: string
    ): ContractSurfaceGuardResult {
      if (requiredRole && !userRoles.includes(requiredRole)) {
        return {
          status: "unauthorized_role",
          operationId,
          simulatedSuccessRendered: false,
          message: `Role "${requiredRole}" is required to operate surface "${operationId}".`,
          actionableNextStep: "Return to Learn or sign in with an authorized curator/moderator account.",
        };
      }
      if (!(operationId in OPENAPI_OPERATIONS)) {
        return {
          status: "unsupported_contract",
          operationId,
          simulatedSuccessRendered: false,
          message: `Operation "${operationId}" is not backed by an active OpenAPI contract in this release.`,
          actionableNextStep: "Use a supported workflow in Learn, Explore, or Settings.",
        };
      }
      return {
        status: "authorized_and_supported",
        operationId: operationId as OperationId,
        simulatedSuccessRendered: false,
        message: `Operation "${operationId}" is backed by a verified contract.`,
        actionableNextStep: "Proceed with the explicit user action.",
      };
    },
    planController,
  };
}

export interface WebShellBootstrapSummary {
  readonly specSha256: string;
  readonly topLevelDestinations: readonly TopLevelDestination[];
  readonly learnSubDestinations: readonly LearnSubDestination[];
  readonly planSynchronizedViews: readonly PlanSynchronizedView[];
  readonly operationCount: number;
  readonly lightCanvasColor: string;
}

export function getWebShellBootstrapSummary(): WebShellBootstrapSummary {
  return {
    specSha256: CANONICAL_SPEC_SHA256,
    topLevelDestinations: TOP_LEVEL_DESTINATIONS,
    learnSubDestinations: LEARN_SUB_DESTINATIONS,
    planSynchronizedViews: PLAN_SYNCHRONIZED_VIEWS,
    operationCount: Object.keys(OPENAPI_OPERATIONS).length,
    lightCanvasColor: UI_TOKENS.colors.canvas.light,
  };
}

export {
  buildPlanMapAndOutlineModel,
  computeActivityDurationTriplet,
  createAssessmentSessionController,
  createThemeController,
  evaluateMasteryGateInterstitial,
  evaluateSafeCurriculumRender,
  isSafeResourceUrl,
  renderAccessibleMathFormula,
  renderUntrustedCatalogText,
  resolveDeterministicStepIndicator,
  resolveMotionPolicy,
  resolveSurfaceStyle,
  resolveThemeMode,
  resolveThemePalette,
  UI_TOKENS,
  type AppearancePreferences,
  type AssessmentSessionController,
  type AssessmentSessionModel,
  type EnvironmentMediaPreferences,
  type MasteryGateModalState,
} from "../../../packages/ui/src/index.ts";
export * from "./tracerBulletViews.ts";
export * from "./scheduleAndOffline.ts";
export * from "./diagnosticsAndAdaptation.ts";
export * from "./byokAndReminders.ts";
export * from "./billingAndSharing.ts";
export * from "./releaseAndA11yViews.ts";
export * from "./browserApp.ts";


