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
        const url = card.canonicalUrl && isSafeResourceUrl(card.canonicalUrl) ? card.canonicalUrl : null;
        return {
          subtaskId: subtask.subtaskId,
          collapsible: false,
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
          action: (
            <button
              type="button"
              class="subtask-resource-edit"
              aria-label={`Edit resource: ${card.title}`}
              title="Edit resource"
              data-action="open-resource-editor"
              data-editor-mode="edit"
              data-resource-id={card.resourceVersionId}
              data-syllabus-id={syllabusId}
              data-module-id={mod.moduleId}
            >
              <SfIcon name="edit" />
            </button>
          ),
        };
      }
      case "concept-check":
        return { subtaskId: subtask.subtaskId, collapsible: true, kindLabel: "Practice quiz", icon: "quiz" as const, title: "Concept check", details: conceptCheckWorkspace, action: null };
      case "criterion":
        return { subtaskId: subtask.subtaskId, collapsible: false, kindLabel: "Criterion", icon: "resources" as const, title: <MathText text={subtask.text} />, details: null, action: null };
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
          {subtasks.map(({ subtaskId, collapsible, kindLabel, icon, title, details, action }, idx) => {
            const done = subtaskDone(subtaskId);
            const label = (
              <>
                <span class="subtask-kind" data-kind={icon} title={kindLabel}>
                  <SfIcon name={icon} />
                  <span class="st-sr">{kindLabel}: </span>
                </span>
                <span>{title}</span>
              </>
            );
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
                  {collapsible ? (
                    <details id={`${INSPECTOR_ID}-practice`} class="inspector-disclosure subtask-practice" data-preserve-open="">
                      <summary id={`${INSPECTOR_ID}-subtask-${idx}`} class="subtask-title">
                        {label}
                        <SfIcon name="chevron-down" />
                      </summary>
                      <div class="subtask-practice-content">{details}</div>
                    </details>
                  ) : (
                    <>
                      <div class="subtask-heading">
                        <p id={`${INSPECTOR_ID}-subtask-${idx}`} class="subtask-title">{label}</p>
                        {action}
                      </div>
                      {details}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="meta-text">No study materials attached to this step yet.</p>
      )}
    </section>
  );
}
