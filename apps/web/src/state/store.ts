import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals";
import type { MapKeyboardKey, PlanMapAndOutlineModel, ThemePreference } from "@syllabus/ui";
import {
  createSyllabusWebAppController,
  type SyllabusWebAppController,
  type SyllabusWebAppResolvedState,
} from "../browserAppController.ts";
import type { SyllabusWebAppStateInput } from "../renderWebAppHtml.ts";
import type { Account, AuthStatus } from "../auth.ts";
import type { SettableStatus } from "../components/InspectorDrawer.tsx";
import type { LearnSubDestination, MapNonDraggingControl, PlanSynchronizedView, TopLevelDestination } from "../navigationShell.ts";
import type { RecordedProgressEventReceipt } from "../tracerBulletViews.ts";

export interface SyllabusSignalStore {
  readonly controller: SyllabusWebAppController;
  readonly state: Signal<SyllabusWebAppResolvedState>;
  readonly topLevel: ReadonlySignal<TopLevelDestination>;
  readonly learnSubDestination: ReadonlySignal<LearnSubDestination>;
  readonly planView: ReadonlySignal<PlanSynchronizedView>;
  readonly authStatus: ReadonlySignal<AuthStatus>;
  readonly account: ReadonlySignal<Account>;
  readonly selectedSyllabusId: ReadonlySignal<string>;
  readonly selectedModuleId: ReadonlySignal<string | null>;
  readonly selectedActivityId: ReadonlySignal<string | null>;
  readonly studyDetailOpen: ReadonlySignal<boolean>;
  readonly openDialogId: ReadonlySignal<string | null>;
  readonly totalStudyMinutes: ReadonlySignal<number>;
  readonly selfReportedCompletedCount: ReadonlySignal<number>;
  readonly renderedHtml: ReadonlySignal<string>;
  getState(): SyllabusWebAppResolvedState;
  renderHtml(): string;
  navigateTopLevel(destination: TopLevelDestination): SyllabusWebAppResolvedState;
  navigateLearnSubDestination(subDestination: LearnSubDestination): SyllabusWebAppResolvedState;
  switchPlanView(view: PlanSynchronizedView): SyllabusWebAppResolvedState;
  selectPlanModule(moduleId: string, sourceView?: PlanSynchronizedView): SyllabusWebAppResolvedState;
  selectPlanActivity(
    activityId: string,
    explicitModuleId?: string,
    sourceView?: PlanSynchronizedView,
  ): SyllabusWebAppResolvedState;
  applyMapControl(control: MapNonDraggingControl): SyllabusWebAppResolvedState;
  navigateMapKeyboard(key: MapKeyboardKey): SyllabusWebAppResolvedState;
  recordTodayActivityCompletion(activityId: string, explicitEventId?: string): RecordedProgressEventReceipt | null;
  setActivityStatus(activityId: string, status: SettableStatus): SyllabusWebAppResolvedState;
  setThemePreference(theme: ThemePreference): SyllabusWebAppResolvedState;
  toggleUpvote(publicationRevisionId?: string): SyllabusWebAppResolvedState;
  openDialog(dialogId: string): SyllabusWebAppResolvedState;
  closeDialog(): SyllabusWebAppResolvedState;
  applyUiAction(
    action: string,
    data?: Readonly<Record<string, string | undefined>>,
    submittedChoice?: string | null,
  ): { handled: boolean; state: SyllabusWebAppResolvedState };
}

export function createSyllabusSignalStore(initialState: SyllabusWebAppStateInput = {}): SyllabusSignalStore {
  const controller = createSyllabusWebAppController(initialState);
  const state = signal<SyllabusWebAppResolvedState>(controller.getState());
  const revision = signal(0);

  const sync = <T>(fn: () => T): T => {
    let result!: T;
    batch(() => {
      result = fn();
      state.value = controller.getState();
      revision.value += 1;
    });
    return result;
  };

  return {
    controller,
    state,
    topLevel: computed(() => state.value.topLevel),
    learnSubDestination: computed(() => state.value.learnSubDestination),
    planView: computed(() => state.value.planView),
    authStatus: computed(() => state.value.authStatus),
    account: computed(() => state.value.account),
    selectedSyllabusId: computed(() => state.value.selectedSyllabusId),
    selectedModuleId: computed(() => state.value.selectedModuleId),
    selectedActivityId: computed(() => state.value.selectedActivityId),
    studyDetailOpen: computed(() => state.value.studyDetailOpen),
    openDialogId: computed(() => state.value.openDialogId),
    totalStudyMinutes: computed(() => state.value.totalStudyMinutes),
    selfReportedCompletedCount: computed(() => state.value.selfReportedCompletedCount),
    renderedHtml: computed(() => {
      void revision.value;
      return controller.renderHtml();
    }),
    getState: () => state.value,
    renderHtml: () => controller.renderHtml(),
    navigateTopLevel: (destination) => sync(() => controller.navigateTopLevel(destination)),
    navigateLearnSubDestination: (subDestination) => sync(() => controller.navigateLearnSubDestination(subDestination)),
    switchPlanView: (view) => sync(() => controller.switchPlanView(view)),
    selectPlanModule: (moduleId, sourceView) => sync(() => controller.selectPlanModule(moduleId, sourceView)),
    selectPlanActivity: (activityId, explicitModuleId, sourceView) =>
      sync(() => controller.selectPlanActivity(activityId, explicitModuleId, sourceView)),
    applyMapControl: (control) => sync(() => controller.applyMapControl(control)),
    navigateMapKeyboard: (key) => sync(() => controller.navigateMapKeyboard(key)),
    recordTodayActivityCompletion: (activityId, explicitEventId) =>
      sync(() => controller.recordTodayActivityCompletion(activityId, explicitEventId)),
    setActivityStatus: (activityId, status) => sync(() => controller.setActivityStatus(activityId, status)),
    setThemePreference: (theme) => sync(() => controller.setThemePreference(theme)),
    toggleUpvote: (publicationRevisionId) => sync(() => controller.toggleUpvote(publicationRevisionId)),
    openDialog: (dialogId) => sync(() => controller.openDialog(dialogId)),
    closeDialog: () => sync(() => controller.closeDialog()),
    applyUiAction: (action, data, submittedChoice) =>
      sync(() => controller.applyUiAction(action, data, submittedChoice)),
  };
}
