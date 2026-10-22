import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals";
import type { MapKeyboardKey, PlanMapAndOutlineModel, ThemePreference } from "../../../../packages/ui/src/index.ts";
import {
  createCurriculumWebAppController,
  type CurriculumWebAppController,
  type CurriculumWebAppResolvedState,
  type CurriculumWebAppStateInput,
} from "../browserApp.ts";
import type { Account, AuthStatus } from "../components/HeaderBar.tsx";
import type { SettableStatus } from "../components/InspectorDrawer.tsx";
import type { LearnSubDestination, MapNonDraggingControl, PlanSynchronizedView, TopLevelDestination } from "../index.ts";
import type { RecordedProgressEventReceipt } from "../tracerBulletViews.ts";

export interface CurriculumSignalStore {
  readonly controller: CurriculumWebAppController;
  readonly state: Signal<CurriculumWebAppResolvedState>;
  readonly topLevel: ReadonlySignal<TopLevelDestination>;
  readonly learnSubDestination: ReadonlySignal<LearnSubDestination>;
  readonly planView: ReadonlySignal<PlanSynchronizedView>;
  readonly authStatus: ReadonlySignal<AuthStatus>;
  readonly account: ReadonlySignal<Account>;
  readonly selectedCurriculumId: ReadonlySignal<string>;
  readonly selectedModuleId: ReadonlySignal<string | null>;
  readonly selectedActivityId: ReadonlySignal<string | null>;
  readonly studyDetailOpen: ReadonlySignal<boolean>;
  readonly openDialogId: ReadonlySignal<string | null>;
  readonly totalStudyMinutes: ReadonlySignal<number>;
  readonly selfReportedCompletedCount: ReadonlySignal<number>;
  readonly renderedHtml: ReadonlySignal<string>;
  getState(): CurriculumWebAppResolvedState;
  renderHtml(): string;
  navigateTopLevel(destination: TopLevelDestination): CurriculumWebAppResolvedState;
  navigateLearnSubDestination(subDestination: LearnSubDestination): CurriculumWebAppResolvedState;
  switchPlanView(view: PlanSynchronizedView): CurriculumWebAppResolvedState;
  selectPlanModule(moduleId: string, sourceView?: PlanSynchronizedView): CurriculumWebAppResolvedState;
  selectPlanActivity(
    activityId: string,
    explicitModuleId?: string,
    sourceView?: PlanSynchronizedView,
  ): CurriculumWebAppResolvedState;
  applyMapControl(control: MapNonDraggingControl): CurriculumWebAppResolvedState;
  navigateMapKeyboard(key: MapKeyboardKey): CurriculumWebAppResolvedState;
  recordTodayActivityCompletion(activityId: string, explicitEventId?: string): RecordedProgressEventReceipt | null;
  setActivityStatus(activityId: string, status: SettableStatus): CurriculumWebAppResolvedState;
  setThemePreference(theme: ThemePreference): CurriculumWebAppResolvedState;
  toggleUpvote(publicationRevisionId?: string): CurriculumWebAppResolvedState;
  openDialog(dialogId: string): CurriculumWebAppResolvedState;
  closeDialog(): CurriculumWebAppResolvedState;
  applyUiAction(
    action: string,
    data?: Readonly<Record<string, string | undefined>>,
    submittedChoice?: string | null,
  ): { handled: boolean; state: CurriculumWebAppResolvedState };
}

export function createCurriculumSignalStore(initialState: CurriculumWebAppStateInput = {}): CurriculumSignalStore {
  const controller = createCurriculumWebAppController(initialState);
  const state = signal<CurriculumWebAppResolvedState>(controller.getState());
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
    selectedCurriculumId: computed(() => state.value.selectedCurriculumId),
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
