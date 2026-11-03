import type { MapKeyboardKey, ThemePreference } from "@syllabus/ui";
import {
  createSyllabusWebAppController,
  type SyllabusWebAppController,
} from "./browserAppController.ts";
import {
  PRACTICE_ACTIONS,
  type SyllabusWebAppStateInput,
} from "./renderWebAppHtml.ts";
import { INSPECTOR_ID } from "./components/InspectorDrawer.tsx";
import type {
  LearnSubDestination,
  MapNonDraggingControl,
  PlanSynchronizedView,
  TopLevelDestination,
} from "./navigationShell.ts";

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

export function mountSyllabusWebApp(
  rootElement: MountableRootElement,
  initialState: SyllabusWebAppStateInput = {},
): SyllabusWebAppController {
  const controller = createSyllabusWebAppController(initialState);

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
  const getRail = (): ScrollableRail => rootElement.querySelector?.(".today-syllabi-grid") as ScrollableRail;

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
  function syncDom(action?: string): void {
    const railLeft = getRail()?.scrollLeft ?? 0;
    const settingsSection = (rootElement.querySelector?.('input[name="settings-section"]:checked') as { value?: string } | null | undefined)?.value;
    const shown = rootElement.querySelector?.("dialog[open]") as MountedDialog | null | undefined;
    const shownTop = shown?.scrollTop ?? 0;
    const expanded = new Set(
      (Array.from(rootElement.querySelectorAll?.('details[data-preserve-open][open]') ?? []) as HTMLDetailsElement[]).map((detail) => detail.id),
    );
    const focused = focusedControlSelector();
    rootElement.innerHTML = controller.renderHtml();
    const nextSettingsSection = action === "open-ai-settings" ? "ai" : settingsSection;
    const settingsChoices = Array.from(rootElement.querySelectorAll?.('input[name="settings-section"]') ?? []) as Array<{ value?: string; checked: boolean }>;
    const settingsChoice = settingsChoices.find((input) => input.value === nextSettingsSection);
    if (settingsChoice) settingsChoice.checked = true;
    const nextRail = getRail();
    if (nextRail) nextRail.scrollLeft = railLeft;
    bindDialogs();
    const marked = rootElement.querySelector?.('dialog[data-open="true"]') as MountedDialog | null | undefined;
    if (marked && typeof marked.showModal === "function" && !marked.open) marked.showModal();
    if (marked && shown && marked.id === shown.id) {
      if (marked.getAttribute?.("data-activity-id") === shown.getAttribute?.("data-activity-id")) {
        for (const detail of Array.from(rootElement.querySelectorAll?.('details[data-preserve-open]') ?? []) as HTMLDetailsElement[]) {
          detail.open = expanded.has(detail.id);
        }
      }
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
    else if (action === "open-dialog" && ds["dialogId"]) {
      const pubId = ds["publicationId"] ?? ev.target?.closest?.("[data-publication-id]")?.dataset?.["publicationId"];
      controller.openDialog(ds["dialogId"], pubId);
    }
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
      if (action === "submit-diagnostic-answer" && typeof rootElement.querySelector === "function") {
        const checked = rootElement.querySelector('input[name="diagnostic-choice"]:checked') as { value?: string } | null;
        data["diagnosticChoice"] = checked?.value;
      }
      if (action === "reschedule-session" && ds["sessionId"] && typeof rootElement.querySelector === "function") {
        const input = rootElement.querySelector(`[data-reschedule-for="${ds["sessionId"]}"]`) as { value?: string } | null;
        data["rescheduleValue"] = input?.value ?? "";
      }
      if (typeof rootElement.querySelector === "function") {
        const goalInput = rootElement.querySelector("#intake-goal") as { value?: string } | null;
        if (typeof goalInput?.value === "string") data["intakeGoalTitle"] = goalInput.value;
        if (action === "set-resource-editor-mode") {
          const rawInput = rootElement.querySelector("#resource-raw-input") as { value?: string } | null;
          if (typeof rawInput?.value === "string") data["rawText"] = rawInput.value;
        }
      }
      if (action === "replace-key" && typeof rootElement.querySelector === "function") {
        const providerId = ds["providerId"] ?? "openai";
        const keySelector = providerId === "openai" ? "#byok-key" : `#byok-key-${providerId}`;
        const keyInput = rootElement.querySelector(keySelector) as { value?: string } | null;
        if (typeof keyInput?.value === "string") data["keyValue"] = keyInput.value;
      }
      if ((action === "generate-syllabus-ai" || action === "review-generate") && typeof rootElement.querySelector === "function") {
        const minsInput = rootElement.querySelector("#weekly-minutes") as { value?: string } | null;
        if (minsInput?.value) data["weeklyMinutes"] = minsInput.value;
      }
      const submittedChoice = data["practiceChoice"] ?? null;
      if (!action || !controller.applyUiAction(action, data, submittedChoice).handled) return;
    }
    syncDom(action);
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

  // A select or time input reports its choice on change. A click on it only opens the list.
  rootElement.addEventListener?.("change", (rawEvent: unknown) => {
    const ev = rawEvent as { target?: { closest?: (s: string) => { value?: string; dataset?: Record<string, string | undefined> } | null } | null };
    const select = ev.target?.closest?.("select[data-action], input[data-action]");
    if (!select?.value) return;
    const action = select.dataset?.["action"] ?? "select-syllabus";
    const goalInput =
      typeof rootElement.querySelector === "function"
        ? (rootElement.querySelector("#intake-goal") as { value?: string } | null)
        : null;
    const intakeGoalTitle = typeof goalInput?.value === "string" ? goalInput.value : undefined;
    const rawResourceInput =
      typeof rootElement.querySelector === "function"
        ? (rootElement.querySelector("#resource-raw-input") as { value?: string } | null)
        : null;
    const rawText = typeof rawResourceInput?.value === "string" ? rawResourceInput.value : undefined;
    const payload: Record<string, string | undefined> =
      action === "select-syllabus"
        ? { syllabusId: select.value }
        : action === "set-intake-subject"
          ? { intakeSubject: select.value, intakeGoalTitle }
          : action === "toggle-intake-topic"
            ? { intakeTopic: select.value, intakeGoalTitle }
            : action === "set-resource-editor-syllabus"
              ? { targetSyllabusId: select.value, rawText }
              : { ...select.dataset, value: select.value };
    if (controller.applyUiAction(action, payload).handled) syncDom();
  });

  // The Marketplace search, resource editor, and topic finder submit through their own data-action.
  rootElement.addEventListener?.("submit", (rawEvent: unknown) => {
    const ev = rawEvent as {
      target?: { closest?: (s: string) => { dataset?: Record<string, string | undefined> } | null } | null;
      preventDefault?: () => void;
    };
    const action = ev.target?.closest?.("form[data-action]")?.dataset?.["action"];
    if (!action) return;
    ev.preventDefault?.();
    const valueOf = (selector: string): string => (rootElement.querySelector?.(selector) as { value?: string } | null | undefined)?.value ?? "";
    const data: Record<string, string | undefined> =
      action === "update-profile"
                ? { username: valueOf("#profile-handle-input"), email: valueOf("#profile-email-input") }
                : action === "save-syllabus-meta"
                  ? {
                      title: valueOf("#syllabus-edit-title"),
                      summary: valueOf("#syllabus-edit-summary"),
                    }
                  : action === "save-syllabus-module"
                    ? {
                        moduleId: valueOf('#dialog-syllabus-editor input[name="moduleId"]') || undefined,
                        title: valueOf("#syllabus-module-title"),
                        summary: valueOf("#syllabus-module-summary"),
                        requirementLevel: valueOf("#syllabus-module-req") || undefined,
                      }
                    : action === "save-syllabus-activity"
                      ? {
                          activityId: valueOf('#dialog-syllabus-editor input[name="activityId"]') || undefined,
                          moduleId: valueOf("#syllabus-activity-module") || undefined,
                          title: valueOf("#syllabus-activity-title"),
                          activityType: valueOf("#syllabus-activity-type") || undefined,
                          durationMinutes: valueOf("#syllabus-activity-minutes") || undefined,
                          requirementLevel: valueOf("#syllabus-activity-req") || undefined,
                          prompt: valueOf("#syllabus-activity-prompt"),
                        }
                      : action === "ingest-manual-resource"
            ? {
                rawText: valueOf("#resource-raw-input"),
                targetSyllabusId: valueOf("#resource-target-syllabus") || undefined,
                targetModuleId: valueOf("#resource-target-module") || undefined,
                role: valueOf("#resource-target-role") || undefined,
                targetActivityId: valueOf('#dialog-resource-editor input[name="targetActivityId"]') || undefined,
              }
            : action === "link-library-resource"
              ? {
                  resourceVersionId: valueOf("#resource-link-id"),
                  targetSyllabusId: valueOf("#resource-link-syllabus") || undefined,
                  targetModuleId: valueOf("#resource-link-module") || undefined,
                  role: valueOf("#resource-link-role") || undefined,
                  selectionRationale: valueOf("#resource-link-rationale"),
                  targetActivityId: valueOf('#dialog-resource-editor input[name="targetActivityId"]') || undefined,
                }
              : action === "save-resource-edit"
                ? {
                    resourceVersionId: valueOf("#resource-edit-id"),
                    title: valueOf("#resource-edit-title"),
                    canonicalUrl: valueOf("#resource-edit-url"),
                    category: valueOf("#resource-edit-category") || undefined,
                    publisher: valueOf("#resource-edit-publisher"),
                    accessModel: valueOf("#resource-edit-access") || undefined,
                    topics: valueOf("#resource-edit-topics"),
                    segments: valueOf("#resource-edit-segments"),
                    targetSyllabusId: valueOf("#resource-edit-syllabus") || undefined,
                    targetModuleId: valueOf("#resource-edit-module") || undefined,
                    role: valueOf("#resource-edit-role") || undefined,
                    selectionRationale: valueOf("#resource-edit-rationale"),
                  }
                : action === "set-marketplace-filter" ? { facet: "topic", value: valueOf("#marketplace-topic") }
                : action === "set-admin-resource-query" ? { query: valueOf("#admin-resource-search") }
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
    liveGenerationRequest: withSync(controller.liveGenerationRequest),
    addCatalogResources: withSync(controller.addCatalogResources),
    syncCatalogResources: withSync(controller.syncCatalogResources),
    designatedAiModel: () => controller.designatedAiModel(),
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
    completeExternalAuth: withSync(controller.completeExternalAuth),
    failExternalAuth: withSync(controller.failExternalAuth),
    setPasskeys: withSync(controller.setPasskeys),
    setByokCredentials: withSync(controller.setByokCredentials),
    liveConceptCheckRequest: controller.liveConceptCheckRequest,
    setActivityConceptCheck: withSync(controller.setActivityConceptCheck),
    setWallet: withSync(controller.setWallet),
    exportScheduleIcs: () => controller.exportScheduleIcs(),
    applyUiAction: withSync(controller.applyUiAction),
  };
}
