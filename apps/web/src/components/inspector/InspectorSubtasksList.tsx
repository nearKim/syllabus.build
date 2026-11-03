import type { VNode } from "preact";
import {
  isSafeResourceUrl,
  renderUntrustedCatalogText,
  type CatalogResourceMetadataInput,
} from "@syllabus/ui";
import { formatMinorCurrency } from "../../billingAndSharing.ts";
import { SfIcon } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";
import { categoryIcon, classifyResourceCategory } from "../ResourcesView.tsx";
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
        const resource = catalogResources[card.resourceVersionId];
        const category = classifyResourceCategory(card.resourceVersionId, card.title, card.verifiedPublisher, resource?.category);
        const title = category === "YouTube" ? card.title.replace(/^YouTube(?: lecture| video)?:\s*(?=\S)/i, "") : card.title;
        const segments = resource?.segments ?? [];
        const sections = card.verifiedSegments
          .flatMap((segmentId) => segments.find((segment) => segment.segment_id === segmentId)?.title ?? [])
          .map((section) => renderUntrustedCatalogText(section, { maxLength: 300 }).text);
        const certificateNote = card.optionalCertificationBadge ? `Optional certificate ${formatMinorCurrency(4900, "USD")}` : null;
        const accessNotes = [
          ...(card.accessModel !== "free" ? [humanize(card.accessModel)] : []),
          ...(certificateNote ? [certificateNote] : []),
        ];
        const provenance = [
          card.verifiedPublisher,
          humanize(card.accessModel),
          card.rightsBadge.externalLinkOnly ? "External link" : humanize(card.rightsBadge.basis),
          ...(certificateNote ? [certificateNote] : []),
        ];
        const url = card.canonicalUrl && isSafeResourceUrl(card.canonicalUrl) ? card.canonicalUrl : null;
        return {
          subtaskId: subtask.subtaskId,
          kindLabel: category,
          icon: category === "YouTube" ? "youtube" as const : categoryIcon(category),
          title: url ? (
            <a class="subtask-material-link" href={url} target="_blank" rel="noopener noreferrer">
              {title} <span aria-hidden="true">↗</span>
              <span class="st-sr"> in a new tab</span>
            </a>
          ) : title,
          details: (
            <>
              {sections.map((section, secIdx) => (
                <p key={secIdx} class="source-section">
                  <MathText text={section} />
                </p>
              ))}
              {accessNotes.length > 0 ? <p class="subtask-meta">{accessNotes.join(" · ")}</p> : null}
              {!url ? <p class="subtask-meta">Study link unavailable</p> : null}
            </>
          ),
          management: (
            <div key={subtask.subtaskId} class="subtask-resource-management">
              <p class="subtask-title">{card.title}</p>
              <p class="subtask-meta">{provenance.join(" · ")}</p>
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
            </div>
          ),
        };
      }
      case "concept-check":
        return { subtaskId: subtask.subtaskId, kindLabel: "Practice quiz", icon: "quiz" as const, title: "Concept check", details: conceptCheckWorkspace, management: null };
      case "criterion":
        return { subtaskId: subtask.subtaskId, kindLabel: "Criterion", icon: "resources" as const, title: <MathText text={subtask.text} />, details: null, management: null };
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
          {subtasks.map(({ subtaskId, kindLabel, icon, title, details }, idx) => {
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
                    <span class="subtask-kind" data-kind={icon} title={kindLabel}>
                      <SfIcon name={icon} />
                      <span class="st-sr">{kindLabel}: </span>
                    </span>
                    <span>{title}</span>
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
      <details class="subtask-management">
        <summary>Manage</summary>
        <div class="subtask-management-content">
          {subtasks.map(({ management }) => management)}
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
              Add resource
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
        </div>
      </details>
    </section>
  );
}
