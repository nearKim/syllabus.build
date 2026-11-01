import type { VNode } from "preact";
import { isSafeResourceUrl } from "@syllabus/ui";
import { SfIcon, StatusGlyph, UnitMarker, type SfIconName } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";
import {
  ActivityGlyph,
  TRACK_LABELS,
  displayUnitTitle,
  effortWords,
  humanize,
  isClosed,
  trackOf,
  unitGate,
  unitProgress,
  unitTone,
  type StudyActivity,
  type StudyModule,
} from "../StudyFlowBoard.tsx";
import {
  displayLocation,
  INSPECTOR_ID,
  type SourceCardView,
} from "./types.ts";

export interface InspectorUnitViewProps {
  readonly syllabusId?: string | undefined;
  readonly modules: readonly StudyModule[];
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly open: boolean;
  readonly rigor: string;
}

export function InspectorUnitView({
  syllabusId,
  modules,
  mod,
  activity,
  open,
  rigor,
}: InspectorUnitViewProps): VNode {
  const unitIdx = modules.indexOf(mod);
  const unitNumber = unitIdx + 1;

  const uProg = unitProgress(mod.activities);
  const uTone = unitTone(uProg);
  const gate = unitGate(mod);
  const prevMod = modules[unitIdx - 1];
  const nextMod = modules[unitIdx + 1];
  const unitIndexById = new Map(modules.map((m, i) => [m.moduleId, i + 1]));
  const prereqLabels = mod.prerequisiteModuleIds.map((pid) => `Unit ${unitIndexById.get(pid) ?? "?"}`);
  const reqCount = mod.activities.filter((act) => act.required).length;
  const optCount = mod.activities.length - reqCount;
  const nextUnitActivity = mod.activities.find((act) => !isClosed(act.executionStatus)) ?? mod.activities[0];

  const seenResources = new Set<string>();
  const unitResources: SourceCardView[] = [];
  for (const act of mod.activities) {
    for (const card of act.resourceProvenanceCards) {
      if (!seenResources.has(card.resourceVersionId)) {
        seenResources.add(card.resourceVersionId);
        unitResources.push(card);
      }
    }
  }

  const unitSpecs: readonly (readonly [SfIconName, string])[] = [
    ["clock", `${effortWords(mod.durationTriplet)}${uProg.left > 0 ? ` · ${uProg.left}m left` : ""}`],
    ["rigor", rigor],
    ["pin", `${reqCount} required${optCount > 0 ? ` · ${optCount} optional` : ""}`],
    ...(prereqLabels.length > 0 ? ([["learn", `Requires ${prereqLabels.join(", ")}`]] as const) : []),
  ];

  return (
    <dialog
      id={INSPECTOR_ID}
      class="inspector"
      closedby="any"
      aria-labelledby={`${INSPECTOR_ID}-title`}
      data-open={String(open)}
      data-inspector-mode="unit"
      data-module-id={mod.moduleId}
      data-activity-id={activity.activityId}
      data-opaque-surface="true"
    >
      <header class="inspector-head">
        <p class="inspector-context">
          Unit {unitNumber} of {modules.length}
        </p>
        <h2 id={`${INSPECTOR_ID}-title`} tabIndex={-1} autofocus>
          <MathText text={displayUnitTitle(mod.title)} />
        </h2>
        <button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">
          <SfIcon name="close" />
        </button>
        <div class="inspector-pills unit-summary-pills">
          <span class="proficiency-pill" data-unit-status={uTone}>
            <UnitMarker tone={uTone} size={16} />
            <span>
              {uProg.done}/{uProg.total}
            </span>
          </span>
          <span class="proficiency-pill" data-proficiency-status={gate.passed ? "demonstrated" : "unassessed"}>
            <StatusGlyph type="gate" tone={gate.passed ? "done" : "todo"} size={16} />
            <span>{gate.passed ? "Gate passed" : `${gate.demonstrated}/${gate.total} demonstrated`}</span>
          </span>
        </div>
      </header>
      <div class="inspector-scroll" data-scroll-region>
        {prevMod || nextMod ? (
          <nav class="mobile-step-nav" aria-label="Previous and next unit">
            {prevMod ? (
              <button
                type="button"
                class="btn-secondary step-nav-btn"
                data-action="select-outline-module"
                data-module-id={prevMod.moduleId}
              >
                <span aria-hidden="true">←</span>
                <span class="step-nav-text">Prev: U{unitIdx} · {displayUnitTitle(prevMod.title)}</span>
              </button>
            ) : null}
            {nextMod ? (
              <button
                type="button"
                class="btn-secondary step-nav-btn step-nav-next"
                data-action="select-outline-module"
                data-module-id={nextMod.moduleId}
              >
                <span class="step-nav-text">Next: U{unitIdx + 2} · {displayUnitTitle(nextMod.title)}</span>
                <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </nav>
        ) : null}

        <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-unit-overview`}>
          <div class="inspector-section-head">
            <h3 id={`${INSPECTOR_ID}-unit-overview`}>Overview</h3>
            <button
              type="button"
              class="inspector-inline-action"
              data-action="open-syllabus-editor"
              data-syllabus-edit-mode="edit-module"
              data-module-id={mod.moduleId}
            >
              Edit unit
            </button>
          </div>
          <p class="prose">
            <MathText text={mod.summary} />
          </p>
          <ul class="spec-chips">
            {unitSpecs.map(([icon, text], idx) => (
              <li key={idx}>
                <SfIcon name={icon} size={15} />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-unit-activities`}>
          <h3 id={`${INSPECTOR_ID}-unit-activities`}>Activities ({mod.activities.length})</h3>
          <ol class="unit-row-activity-list">
            {mod.activities.map((act) => {
              const actTrack = trackOf(act);
              return (
                <li key={act.activityId} class="unit-row-activity-item" data-activity-id={act.activityId} data-track={actTrack}>
                  <button
                    type="button"
                    class="unit-row-activity-btn"
                    data-action="select-outline-activity"
                    data-activity-id={act.activityId}
                    data-module-id={mod.moduleId}
                  >
                    <span class="unit-row-activity-head">
                      <ActivityGlyph activity={act} size={16} />
                      <span class="badge">{TRACK_LABELS[actTrack].badge}</span>
                      <span class="unit-row-activity-time">{effortWords(act.durationTriplet)}</span>
                      {act.required ? null : <span class="node-optional">Optional</span>}
                    </span>
                    <strong class="unit-row-activity-title">
                      <MathText text={act.title} />
                    </strong>
                    <span class="unit-row-activity-summary">
                      <MathText text={act.promptSummary} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section class="inspector-section conceptual-focus" aria-labelledby={`${INSPECTOR_ID}-unit-objectives`}>
          <h3 id={`${INSPECTOR_ID}-unit-objectives`}>Objectives ({mod.objectives.length})</h3>
          <ul class="lab-checklist">
            {mod.objectives.map((obj) => (
              <li key={obj.objectiveId}>
                <StatusGlyph
                  type="gate"
                  tone={obj.proficiencyStatus === "demonstrated" ? "done" : "todo"}
                  size={16}
                />
                <div>
                  <strong>
                    <MathText text={obj.title} />
                  </strong>
                  <span class="meta-text" style="display:block">
                    {humanize(obj.proficiencyStatus)}
                    {obj.successCriterion ? (
                      <>
                        {" · "}
                        <MathText text={obj.successCriterion} />
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-unit-resources`}>
          <div class="inspector-section-head">
            <h3 id={`${INSPECTOR_ID}-unit-resources`}>Materials ({unitResources.length})</h3>
            <button
              type="button"
              class="inspector-inline-action"
              data-action="open-resource-editor"
              data-editor-mode="ingest"
              data-syllabus-id={syllabusId}
              data-module-id={mod.moduleId}
            >
              + Add resource
            </button>
          </div>
          {unitResources.length === 0 ? (
            <p class="meta-text">No materials linked to this unit yet.</p>
          ) : (
            unitResources.map((card, index) => {
              const url = card.canonicalUrl && isSafeResourceUrl(card.canonicalUrl) ? card.canonicalUrl : null;
              return (
                <article
                  key={`${card.resourceVersionId}-${index}`}
                  class="source-card"
                  data-resource-version-id={card.resourceVersionId}
                >
                  <div class="source-card-top">
                    <h4 class="source-title">{card.title}</h4>
                    <div class="source-card-actions">
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
                  <p class="source-publisher">{card.verifiedPublisher}</p>
                  {url ? (
                    <p class="source-location">
                      <SfIcon name="resources" size={15} />
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {displayLocation(url)}
                      </a>
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </div>
      {nextUnitActivity ? (
        <div class="inspector-actions">
          <button
            type="button"
            class="btn-primary next-step"
            data-action="select-outline-activity"
            data-activity-id={nextUnitActivity.activityId}
            data-module-id={mod.moduleId}
          >
            <span class="next-step-text">
              {isClosed(nextUnitActivity.executionStatus) ? "Open" : "Start"}: <MathText text={nextUnitActivity.title} />
            </span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
