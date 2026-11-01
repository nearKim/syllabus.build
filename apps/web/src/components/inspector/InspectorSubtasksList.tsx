import type { VNode } from "preact";
import {
  isSafeResourceUrl,
  renderUntrustedCatalogText,
  type CatalogResourceMetadataInput,
} from "@syllabus/ui";
import { formatMinorCurrency } from "../../billingAndSharing.ts";
import { SfIcon } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";
import {
  humanize,
  type StudyActivity,
  type StudyModule,
} from "../StudyFlowBoard.tsx";
import {
  INSPECTOR_ID,
  activityConceptCheck,
  activitySubtasks,
  type ConceptCheck,
  type PracticeState,
  type SelfCheckRubric,
  type SettableStatus,
} from "./types.ts";
import { InspectorPracticeWorkspace } from "./InspectorPracticeWorkspace.tsx";

export interface InspectorSubtasksListProps {
  readonly id: string;
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly modules: readonly StudyModule[];
  readonly syllabusId?: string | undefined;
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly rubric: SelfCheckRubric | null;
  readonly conceptCheck: ConceptCheck | null;
  readonly practice: PracticeState;
  readonly completedSubtaskIds: readonly string[];
  readonly status: SettableStatus;
}

export function InspectorSubtasksList({
  id,
  mod,
  activity,
  modules,
  syllabusId,
  catalogResources,
  rubric,
  conceptCheck,
  practice,
  completedSubtaskIds,
  status,
}: InspectorSubtasksListProps): VNode {
  const isLab = activity.type === "coding" || activity.type === "project";
  const completedSubtasks = new Set(completedSubtaskIds);
  const subtaskDone = (subtaskId: string): boolean => status === "completed" || completedSubtasks.has(subtaskId);

  const check = activityConceptCheck(activity, rubric, conceptCheck);
  const conceptCheckWorkspace = check ? (
    <InspectorPracticeWorkspace id={id} check={check} practice={practice} />
  ) : null;

  const subtasks = activitySubtasks(modules, activity, rubric, conceptCheck).map((subtask) => {
    switch (subtask.kind) {
      case "material": {
        const { card } = subtask;
        const segments = catalogResources[card.resourceVersionId]?.segments ?? [];
        const sections = card.verifiedSegments
          .flatMap((segmentId) => segments.find((segment) => segment.segment_id === segmentId)?.title ?? [])
          .map((section) => renderUntrustedCatalogText(section, { maxLength: 300 }).text);
        const provenance = [
          card.verifiedPublisher,
          humanize(card.accessModel),
          card.rightsBadge.externalLinkOnly ? "External link" : humanize(card.rightsBadge.basis),
          ...(card.optionalCertificationBadge ? [`Optional certificate ${formatMinorCurrency(4900, "USD")}`] : []),
        ];
        const url = card.canonicalUrl && isSafeResourceUrl(card.canonicalUrl) ? card.canonicalUrl : null;
        return {
          subtaskId: subtask.subtaskId,
          title: card.title,
          details: (
            <>
              {sections.map((section, secIdx) => (
                <p key={secIdx} class="source-section">
                  <MathText text={section} />
                </p>
              ))}
              <p class="subtask-meta">
                {url ? (
                  <a class="source-open-link" href={url} target="_blank" rel="noopener noreferrer">
                    {isLab ? "Open lab specification" : "Open study material"}
                    <span aria-hidden="true">↗</span>
                    <span class="st-sr"> in a new tab</span>
                  </a>
                ) : null}
                <span>{provenance.join(" · ")}</span>
              </p>
              <div class="subtask-material-actions">
                <button
                  type="button"
                  class="source-action-btn"
                  data-action="open-resource-editor"
                  data-editor-mode="edit"
                  data-resource-id={card.resourceVersionId}
                  data-syllabus-id={syllabusId}
                  data-module-id={mod.moduleId}
                >
                  Edit
                </button>
                {syllabusId ? (
                  <button
                    type="button"
                    class="source-action-btn source-action-danger"
                    data-action="unlink-syllabus-resource"
                    data-resource-id={card.resourceVersionId}
                    data-syllabus-id={syllabusId}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </>
          ),
        };
      }
      case "concept-check":
        return { subtaskId: subtask.subtaskId, title: "Answer the concept check", details: conceptCheckWorkspace };
      case "criterion":
        return { subtaskId: subtask.subtaskId, title: <MathText text={subtask.text} />, details: null };
    }
  });

  const doneSubtasks = subtasks.filter(({ subtaskId }) => subtaskDone(subtaskId)).length;

  return (
    <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-subtasks`}>
      <h3 id={`${INSPECTOR_ID}-subtasks`} class="subtasks-head">
        Subtasks {subtasks.length > 0 ? <span class="subtasks-count">{doneSubtasks}/{subtasks.length}</span> : null}
      </h3>
      {subtasks.length > 0 ? (
        <ul class="subtask-list" role="list">
          {subtasks.map(({ subtaskId, title, details }, idx) => {
            const done = subtaskDone(subtaskId);
            return (
              <li key={subtaskId} class="subtask" data-done={String(done)}>
                <button
                  type="button"
                  class="subtask-check"
                  role="checkbox"
                  aria-checked={done}
                  aria-labelledby={`${INSPECTOR_ID}-subtask-${idx}`}
                  data-action="toggle-subtask"
                  data-activity-id={id}
                  data-subtask-id={subtaskId}
                >
                  <SfIcon name="check" size={15} />
                </button>
                <div class="subtask-body">
                  <p id={`${INSPECTOR_ID}-subtask-${idx}`} class="subtask-title">
                    {title}
                  </p>
                  {details}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="meta-text">No study materials attached to this step yet.</p>
      )}
      <div class="subtask-material-actions">
        <button
          type="button"
          class="inspector-inline-action"
          data-action="open-resource-editor"
          data-editor-mode="ingest"
          data-syllabus-id={syllabusId}
          data-module-id={mod.moduleId}
          data-activity-id={id}
        >
          + Add resource
        </button>
        <button
          type="button"
          class="inspector-inline-action"
          data-action="open-syllabus-editor"
          data-syllabus-edit-mode="edit-activity"
          data-module-id={mod.moduleId}
          data-activity-id={id}
        >
          Edit step
        </button>
      </div>
    </section>
  );
}
