import type { VNode } from "preact";
import type { CatalogResourceMetadataInput } from "@syllabus/ui";
import { SfIcon, StatusGlyph } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";
import {
  displayUnitTitle,
  executionTone,
  humanize,
  trackOf,
  unitProgress,
  type StudyActivity,
  type StudyModule,
} from "./StudyFlowBoard.tsx";
import {
  INSPECTOR_ID,
  SETTABLE_STATUSES,
  STATUS_LABELS,
  type ConceptCheck,
  type InspectorMode,
  type PracticeState,
  type SelfCheckRubric,
  type SettableStatus,
  type SourceCardView,
  type SubtaskSpec,
  activityConceptCheck,
  activitySubtasks,
  conceptCheckSubtaskId,
  displayLocation,
} from "./inspector/types.ts";
import { InspectorUnitView } from "./inspector/InspectorUnitView.tsx";
import { InspectorSubtasksList } from "./inspector/InspectorSubtasksList.tsx";
import { InspectorActivityOverview } from "./inspector/InspectorActivityOverview.tsx";

export {
  INSPECTOR_ID,
  SETTABLE_STATUSES,
  STATUS_LABELS,
  type SettableStatus,
  type SelfCheckRubric,
  type ConceptCheck,
  type PracticeState,
  type SourceCardView,
  activityConceptCheck,
  type SubtaskSpec,
  activitySubtasks,
  conceptCheckSubtaskId,
  displayLocation,
  type InspectorMode,
} from "./inspector/types.ts";

export {
  InspectorUnitView,
  type InspectorUnitViewProps,
} from "./inspector/InspectorUnitView.tsx";

export {
  InspectorPracticeWorkspace,
  type InspectorPracticeWorkspaceProps,
} from "./inspector/InspectorPracticeWorkspace.tsx";

export {
  InspectorSubtasksList,
  type InspectorSubtasksListProps,
} from "./inspector/InspectorSubtasksList.tsx";

export {
  InspectorActivityOverview,
  type InspectorActivityOverviewProps,
} from "./inspector/InspectorActivityOverview.tsx";

export interface InspectorDrawerProps {
  readonly syllabusId?: string | undefined;
  readonly modules: readonly StudyModule[];
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly open: boolean;
  readonly mode?: InspectorMode | undefined;
  readonly rigor: string;
  readonly deliverables: readonly string[];
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly rubric: SelfCheckRubric | null;
  readonly conceptCheck: ConceptCheck | null;
  readonly practice: PracticeState;
  readonly skipRecorded: boolean;
  readonly completedSubtaskIds: readonly string[];
}

export function InspectorDrawer({
  syllabusId,
  modules,
  mod,
  activity,
  open,
  mode = "activity",
  rigor,
  deliverables,
  catalogResources,
  rubric,
  conceptCheck,
  practice,
  skipRecorded,
  completedSubtaskIds,
}: InspectorDrawerProps): VNode {
  if (mode === "unit") {
    return (
      <InspectorUnitView
        syllabusId={syllabusId}
        modules={modules}
        mod={mod}
        activity={activity}
        open={open}
        rigor={rigor}
      />
    );
  }

  const id = activity.activityId;
  const track = trackOf(activity);
  const isGate = track === "gate";
  const isLab = activity.type === "coding" || activity.type === "project";
  const tone = executionTone(activity.executionStatus);
  const status: SettableStatus = tone === "done" ? "completed" : tone === "doing" ? "in_progress" : "not_started";
  const uProg = unitProgress(mod.activities);
  const unitIdx = modules.indexOf(mod);
  const unitNumber = unitIdx + 1;

  const steps = modules.flatMap((unit) => unit.activities);
  const at = steps.findIndex((step) => step.activityId === activity.activityId);
  const prev = steps[at - 1];
  const next = steps[at + 1];

  const objectives = new Map(
    modules.flatMap((unit) => unit.objectives).map((objective) => [objective.objectiveId, objective]),
  );
  const mine = activity.objectiveIds.flatMap((objectiveId) => objectives.get(objectiveId) ?? []);

  return (
    <dialog
      id={INSPECTOR_ID}
      class="inspector"
      closedby="any"
      aria-labelledby={`${INSPECTOR_ID}-title`}
      data-open={String(open)}
      data-inspector-mode="activity"
      data-activity-id={id}
      data-opaque-surface="true"
    >
      <header class="inspector-head">
        <button
          type="button"
          class="inspector-unit-link"
          data-action="select-outline-module"
          data-module-id={mod.moduleId}
          aria-label={`Back to unit: ${displayUnitTitle(mod.title)}`}
          title={displayUnitTitle(mod.title)}
        >
          <SfIcon name="chevron-left" />
          <span><MathText text={displayUnitTitle(mod.title)} /></span>
        </button>
        <h2 id={`${INSPECTOR_ID}-title`} tabIndex={-1} autofocus>
          <MathText text={activity.title} />
        </h2>
        <div class="inspector-header-actions">
          <details class="inspector-edit-menu">
            <summary aria-label="Edit step actions" title="Edit step actions">
              <SfIcon name="edit" />
            </summary>
            <div class="inspector-edit-options">
              <button
                type="button"
                data-action="open-syllabus-editor"
                data-syllabus-edit-mode="edit-activity"
                data-module-id={mod.moduleId}
                data-activity-id={id}
              >
                <SfIcon name="edit" />
                Edit step
              </button>
              <button
                type="button"
                data-action="open-resource-editor"
                data-editor-mode="ingest"
                data-syllabus-id={syllabusId}
                data-module-id={mod.moduleId}
                data-activity-id={id}
              >
                <SfIcon name="plus" />
                Add resource
              </button>
            </div>
          </details>
          <button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">
            <SfIcon name="close" />
          </button>
        </div>
        <div class="inspector-pills">
          <div class="segmented status-control" role="group" aria-label="Activity status">
            {SETTABLE_STATUSES.map((choice) => (
              <button
                key={choice}
                type="button"
                class={`seg-btn${choice === "completed" && status === "completed" ? " status-celebration" : ""}`}
                data-action="set-activity-status"
                data-activity-id={id}
                data-status={choice}
                aria-pressed={choice === status}
              >
                {STATUS_LABELS[choice]}
              </button>
            ))}
          </div>
          {isGate ? (
            <span class="proficiency-pill" data-proficiency-status={activity.objectiveProficiencyStatus}>
              <StatusGlyph
                type="gate"
                tone={activity.objectiveProficiencyStatus === "demonstrated" ? "done" : "todo"}
                size={16}
              />
              <span>
                <span class="st-sr">Objective proficiency: </span>
                {humanize(activity.objectiveProficiencyStatus)}
              </span>
            </span>
          ) : null}
        </div>
      </header>
      <div class="inspector-scroll" data-scroll-region>
        {prev || next ? (
          <nav class="mobile-step-nav" aria-label="Previous and next step">
            {prev ? (
              <button
                type="button"
                class="btn-secondary step-nav-btn"
                data-action="select-outline-activity"
                data-activity-id={prev.activityId}
                data-module-id={prev.moduleId}
              >
                <span aria-hidden="true">←</span>
                <span class="step-nav-text">
                  Prev: <MathText text={prev.title} />
                </span>
              </button>
            ) : null}
            {next ? (
              <button
                type="button"
                class="btn-secondary step-nav-btn step-nav-next"
                data-action="select-outline-activity"
                data-activity-id={next.activityId}
                data-module-id={next.moduleId}
              >
                <span class="step-nav-text">
                  Next: <MathText text={next.title} />
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </nav>
        ) : null}

        <InspectorActivityOverview
          mod={mod}
          activity={activity}
          unitNumber={unitNumber}
          rigor={rigor}
          deliverables={deliverables}
          rubric={rubric}
          mine={mine}
          isGate={isGate}
          isLab={isLab}
          uProg={uProg}
        >
          <InspectorSubtasksList
            id={id}
            mod={mod}
            activity={activity}
            modules={modules}
            syllabusId={syllabusId}
            catalogResources={catalogResources}
            rubric={rubric}
            conceptCheck={conceptCheck}
            practice={practice}
            completedSubtaskIds={completedSubtaskIds}
            status={status}
          />
        </InspectorActivityOverview>

        {skipRecorded ? (
          <p class="prose" role="status">
            {`Skip recorded for ${activity.title} only. Prerequisite evidence was not created.`}
          </p>
        ) : null}
      </div>
      <div class="inspector-actions">
        {status !== "completed" ? (
          <>
            <button
              type="button"
              class="btn-primary"
              data-action="complete-activity"
              data-activity-id={id}
              data-module-id={activity.moduleId}
              data-event-id={`evt-complete-${id}`}
            >
              Mark as Done
              <span aria-hidden="true">✓</span>
            </button>
            <button type="button" class="inspector-skip-btn" data-action="skip-activity" data-activity-id={id}>
              Skip this activity
            </button>
          </>
        ) : next ? (
          <button
            type="button"
            class="btn-primary next-step"
            data-action="select-outline-activity"
            data-activity-id={next.activityId}
            data-module-id={next.moduleId}
          >
            <span class="next-step-text">
              Go to next step: <MathText text={next.title} />
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
