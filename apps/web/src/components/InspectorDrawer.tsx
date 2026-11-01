import type { VNode } from "preact";
import {
  renderAccessibleMathFormula,
  renderUntrustedCatalogText,
  type CatalogResourceMetadataInput,
} from "../../../../packages/ui/src/index.ts";
import { formatMinorCurrency } from "../billingAndSharing.ts";
import { SfIcon, StatusGlyph, UnitMarker, type SfIconName } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";
import {
  ActivityGlyph,
  TRACK_LABELS,
  displayUnitTitle,
  effortWords,
  executionTone,
  humanize,
  isClosed,
  postGateIds,
  trackOf,
  unitGate,
  unitProgress,
  unitTone,
  type StudyActivity,
  type StudyModule,
} from "./StudyFlowBoard.tsx";

declare module "preact" {
  namespace JSX {
    interface HTMLAttributes<RefType extends EventTarget = EventTarget> {
      closedby?: "any" | "closerequest" | "none";
      autofocus?: boolean;
    }
  }
}

export const INSPECTOR_ID = "learn-detail-inspector";

export const SETTABLE_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];
export const STATUS_LABELS: Readonly<Record<SettableStatus, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Done",
};

export interface SelfCheckRubric {
  readonly prompt: string;
  readonly criteria: readonly string[];
}

// One practice question per syllabus or activity, with its formula in TeX. A choice value is what Submit records.
export interface ConceptCheck {
  readonly formula: string;
  readonly question: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly correctValue?: string | undefined;
  readonly hint: string;
  readonly solution: string;
  readonly generatedBy?: "curated" | "ai" | "deterministic" | undefined;
}

export interface PracticeState {
  readonly hintRequested: boolean;
  readonly workedSolutionRevealed: boolean;
  readonly submitted: boolean;
  readonly choice: string | null;
}

// A worked example, quiz, or review ends with the syllabus's concept check, unless a rubric checks it instead.
const CONCEPT_CHECK_TYPES: ReadonlySet<string> = new Set(["worked_example", "quiz", "review"]);

export type SourceCardView = StudyActivity["resourceProvenanceCards"][number];

export function activityConceptCheck(
  activity: StudyActivity,
  rubric: SelfCheckRubric | null,
  conceptCheck: ConceptCheck | null,
): ConceptCheck | null {
  return conceptCheck && !rubric && CONCEPT_CHECK_TYPES.has(activity.type) ? conceptCheck : null;
}

// One checkable row under the activity: a material, the concept check, or a lab or rubric criterion.
export type SubtaskSpec =
  | { readonly kind: "material"; readonly subtaskId: string; readonly card: SourceCardView }
  | { readonly kind: "concept-check"; readonly subtaskId: string }
  | { readonly kind: "criterion"; readonly subtaskId: string; readonly text: string };

// The activity's subtasks in working order: each material, the concept check, then each lab or rubric criterion.
// The drawer renders this list and the controller counts it to set the activity status.
export function activitySubtasks(
  modules: readonly StudyModule[],
  activity: StudyActivity,
  rubric: SelfCheckRubric | null,
  conceptCheck: ConceptCheck | null,
): readonly SubtaskSpec[] {
  const id = activity.activityId;
  const isLab = activity.type === "coding" || activity.type === "project";
  const objectives = new Map(modules.flatMap((unit) => unit.objectives).map((objective) => [objective.objectiveId, objective]));
  const labCriteria = isLab
    ? activity.objectiveIds.flatMap((objectiveId) => {
        const criterion = objectives.get(objectiveId)?.successCriterion;
        return criterion ? [{ kind: "criterion" as const, subtaskId: `${id}:verify:${objectiveId}`, text: criterion }] : [];
      })
    : [];
  return [
    ...activity.resourceProvenanceCards.map((card) => ({
      kind: "material" as const,
      subtaskId: `${id}:material:${card.resourceVersionId}`,
      card,
    })),
    ...(activityConceptCheck(activity, rubric, conceptCheck) ? [{ kind: "concept-check" as const, subtaskId: conceptCheckSubtaskId(id) }] : []),
    ...labCriteria,
    ...(rubric?.criteria ?? []).map((text, idx) => ({ kind: "criterion" as const, subtaskId: `${id}:rubric:${idx}`, text })),
  ];
}

// A valid Submit answer checks this subtask off, so the controller builds the same id.
export function conceptCheckSubtaskId(activityId: string): string {
  return `${activityId}:concept-check`;
}

export function displayLocation(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  return hostname.endsWith(".invalid") ? path.replace(/^\/+/, "") || "catalog" : `${hostname.replace(/^www\./, "")}${path}`;
}

export type InspectorMode = "unit" | "activity";

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
  const unitIdx = modules.indexOf(mod);
  const unitNumber = unitIdx + 1;

  if (mode === "unit") {
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
                const url = card.canonicalUrl;
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

  const id = activity.activityId;
  const track = trackOf(activity);
  const isGate = track === "gate";
  const isLab = activity.type === "coding" || activity.type === "project";
  const tone = executionTone(activity.executionStatus);
  const status: SettableStatus = tone === "done" ? "completed" : tone === "doing" ? "in_progress" : "not_started";
  const uProg = unitProgress(mod.activities);
  const stepIndexInUnit = Math.max(0, mod.activities.findIndex((a) => a.activityId === activity.activityId)) + 1;

  const steps = modules.flatMap((unit) => unit.activities);
  const at = steps.findIndex((step) => step.activityId === activity.activityId);
  const prev = steps[at - 1];
  const next = steps[at + 1];

  const unmet = activity.prerequisiteActivityIds
    .flatMap((prereqId) => steps.find((step) => step.activityId === prereqId) ?? [])
    .filter((step) => !isClosed(step.executionStatus));

  const objectives = new Map(
    modules.flatMap((unit) => unit.objectives).map((objective) => [objective.objectiveId, objective]),
  );
  const mine = activity.objectiveIds.flatMap((objectiveId) => objectives.get(objectiveId) ?? []);

  const check = activityConceptCheck(activity, rubric, conceptCheck);
  const chosen = check?.choices.find((choice) => choice.value === practice.choice);

  const specs: readonly (readonly [SfIconName, string])[] = [
    ["clock", effortWords(activity.durationTriplet)],
    ["rigor", rigor],
    ["pin", activity.required ? "Required" : "Optional"],
    ["code", "Local or external IDE"],
  ];

  const hasPrompt = !isLab && Boolean(activity.promptSummary && activity.promptSummary !== activity.title);

  // The activity is the parent task. A Done activity shows every subtask as checked, even one completed elsewhere.
  const completedSubtasks = new Set(completedSubtaskIds);
  const subtaskDone = (subtaskId: string): boolean => status === "completed" || completedSubtasks.has(subtaskId);

  const conceptCheckWorkspace = check ? (
    <>
      <p class="subtask-meta">Practice only. Your answer does not change the objective's proficiency status.</p>
      <section id="study-workspace" class="study-workspace" aria-label="Concept check" data-opaque-surface="true">
        <div
          class="math-formula-surface"
          data-opaque-surface="true"
          dangerouslySetInnerHTML={{ __html: renderAccessibleMathFormula(check.formula, { displayMode: "block" }).mathml }}
        />
        <fieldset class="choice-group">
          <legend>
            <MathText text={check.question} />
          </legend>
          {check.choices.map(({ value, label }, idx) => (
            <label key={value} class="choice-option" for={`practice-choice-${value}`}>
              <input
                type="radio"
                class="st-sr"
                id={`practice-choice-${value}`}
                name="practice-choice"
                value={value}
                checked={value === practice.choice}
              />
              <span class="choice-letter" aria-hidden="true">
                {String.fromCharCode(65 + idx)}
              </span>
              <span>
                <MathText text={label} />
              </span>
            </label>
          ))}
        </fieldset>
        <div class="practice-actions">
          <button type="button" class="btn-secondary" data-action="submit-practice">
            Submit answer
          </button>
          {practice.hintRequested ? null : (
            <button type="button" class="practice-aid" data-action="request-hint">
              Show hint
            </button>
          )}
          {practice.workedSolutionRevealed ? null : (
            <button type="button" class="practice-aid" data-action="study-worked-solution">
              Show worked solution
            </button>
          )}
        </div>
        <div class="practice-refresh-row">
          <button
            type="button"
            class="practice-aid"
            data-action="generate-activity-check"
            data-activity-id={id}
          >
            Generate fresh check
          </button>
          {check.generatedBy === "ai" ? <span class="meta-text">Generated with your AI key</span> : null}
        </div>
        {practice.submitted ? (
          <p class="meta-text practice-feedback" role="status">
            {chosen ? (
              <>
                Answer submitted: <MathText text={chosen.label} />.
                {check.correctValue ? (
                  chosen.value === check.correctValue ? (
                    <>
                      {" "}
                      <strong>{practice.workedSolutionRevealed ? "Correct (solution-assisted)." : "Correct."}</strong>
                    </>
                  ) : (
                    <>
                      {" "}
                      <span>Not quite — review the hint or worked solution and try again.</span>
                    </>
                  )
                ) : null}
              </>
            ) : (
              "Choose an answer, then select Submit answer."
            )}
          </p>
        ) : null}
        {practice.hintRequested ? (
          <p class="practice-note" role="status">
            <strong>Hint.</strong> <MathText text={check.hint} /> Hints carry no penalty.
          </p>
        ) : null}
        {practice.workedSolutionRevealed ? (
          <p class="practice-note" role="status">
            <strong>Worked solution.</strong> <MathText text={check.solution} /> This counts as solution-assisted study, not an
            independent attempt.
          </p>
        ) : null}
      </section>
    </>
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
        const url = card.canonicalUrl;
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
        <div class="inspector-context-row">
          <p class="inspector-context">
            Unit {unitNumber} · Step {stepIndexInUnit} of {mod.activities.length} · {TRACK_LABELS[track].badge} · {effortWords(activity.durationTriplet)}
          </p>
          <ol class="step-pager" aria-hidden="true">
            {mod.activities.map((unitAct) => (
              <li
                key={unitAct.activityId}
                data-done={String(isClosed(unitAct.executionStatus))}
                data-current={String(unitAct.activityId === activity.activityId)}
              />
            ))}
          </ol>
        </div>
        <h2 id={`${INSPECTOR_ID}-title`} tabIndex={-1} autofocus>
          <MathText text={activity.title} />
        </h2>
        <button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">
          <SfIcon name="close" />
        </button>
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

        {unmet.length > 0 ? (
          <div class="first-steps">
            <p class="first-steps-label">
              {activity.prerequisiteBridgeRecommendation?.blocking ? "Required first:" : "Recommended first:"}
            </p>
            {unmet.map((step) => (
              <button
                key={step.activityId}
                type="button"
                class="first-step"
                data-action="select-outline-activity"
                data-activity-id={step.activityId}
                data-module-id={step.moduleId}
              >
                <ActivityGlyph activity={step} size={16} />
                <span>
                  <MathText text={step.title} />
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        ) : null}

        {hasPrompt ? (
          <section class="inspector-section study-guide-prompt" aria-labelledby={`${INSPECTOR_ID}-prompt`}>
            <h3 id={`${INSPECTOR_ID}-prompt`}>Study focus</h3>
            <p class="prose">
              <MathText text={activity.promptSummary} />
            </p>
          </section>
        ) : null}

        {isLab ? (
          <>
            <section class="inspector-section lab-brief" aria-labelledby={`${INSPECTOR_ID}-brief`}>
              <h3 id={`${INSPECTOR_ID}-brief`}>Deliverable brief</h3>
              <p>
                <MathText text={activity.promptSummary} />
              </p>
              {deliverables.length > 0 ? (
                <ul class="lab-deliverables">
                  {deliverables.map((item, idx) => (
                    <li key={idx}>
                      <MathText text={item} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-specs`}>
              <h3 id={`${INSPECTOR_ID}-specs`}>Environment and lab specs</h3>
              <ul class="spec-chips">
                {specs.map(([icon, text], idx) => (
                  <li key={idx}>
                    <SfIcon name={icon} size={15} />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {rubric ? (
          <section class="inspector-section rubric-block" aria-labelledby={`${INSPECTOR_ID}-rubric`}>
            <h3 id={`${INSPECTOR_ID}-rubric`}>Synthesis &amp; Self-Check Rubric</h3>
            <p class="rubric-mode">Self-Evaluated Rubric · No public quiz bank for this topic</p>
            <p class="rubric-label">Guiding synthesis prompt</p>
            <p class="rubric-prompt">
              <MathText text={rubric.prompt} />
            </p>
            <p class="meta-text">
              Check off each criterion under Subtasks when your synthesis meets it. Your self-check does not change the
              objective's proficiency status.
            </p>
          </section>
        ) : null}

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

        <div class="inspector-reference-group">
          <section class="inspector-section conceptual-focus" aria-labelledby={`${INSPECTOR_ID}-focus`}>
            <h3 id={`${INSPECTOR_ID}-focus`}>{isGate ? "What this checks" : "What this builds"}</h3>
            <ul class="focus-list">
              {mine.length > 0 ? (
                mine.map((objective) => (
                  <li key={objective.objectiveId}>
                    <MathText text={objective.title} />
                  </li>
                ))
              ) : (
                <li>No objective is mapped to this activity.</li>
              )}
            </ul>
            {isGate || postGateIds(mod).has(activity.activityId) ? null : (
              <p class="focus-next">
                <StatusGlyph type="gate" tone={unitGate(mod).passed ? "done" : "todo"} size={16} />
                <span>Prepares for: Unit {unitNumber} Gate</span>
              </p>
            )}
          </section>

          {isLab ? null : (
            <section class="inspector-section inspector-time-section" aria-labelledby={`${INSPECTOR_ID}-time`}>
              <h3 id={`${INSPECTOR_ID}-time`}>Time &amp; duration</h3>
              <table class="meta-table">
                <caption class="st-sr">Activity details</caption>
                <tbody>
                  <tr>
                    <th scope="row">
                      <span class="meta-key">
                        <SfIcon name="clock" />
                        Duration
                      </span>
                    </th>
                    <td>{effortWords(activity.durationTriplet)}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <span class="meta-key">
                        <SfIcon name="learn" />
                        Unit total
                      </span>
                    </th>
                    <td>
                      {effortWords(mod.durationTriplet)}
                      {uProg.left > 0 ? ` (${uProg.left}m remaining)` : " (complete)"}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <span class="meta-key">
                        <SfIcon name="rigor" />
                        Rigor
                      </span>
                    </th>
                    <td>{rigor}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <span class="meta-key">
                        <SfIcon name="pin" />
                        Type
                      </span>
                    </th>
                    <td>{activity.required ? "Required" : "Optional"}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section class="inspector-section inspector-order-section" aria-labelledby={`${INSPECTOR_ID}-order`}>
            <h3 id={`${INSPECTOR_ID}-order`}>
              Unit {unitNumber} learning order ({uProg.done}/{uProg.total} done)
            </h3>
            <ol class="inspector-order-list">
              {mod.activities.map((step, idx) => {
                const stepTrack = trackOf(step);
                const isCurrent = step.activityId === activity.activityId;
                const stepDone = isClosed(step.executionStatus);
                return (
                  <li
                    key={step.activityId}
                    class="inspector-order-item"
                    data-current={String(isCurrent)}
                    data-done={String(stepDone)}
                  >
                    <button
                      type="button"
                      class="inspector-order-btn"
                      data-action="select-outline-activity"
                      data-activity-id={step.activityId}
                      data-module-id={mod.moduleId}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <span class="inspector-order-num">{idx + 1}.</span>
                      <span class="inspector-order-title">
                        <MathText text={step.title} />
                      </span>
                      <span class="inspector-order-meta">
                        {TRACK_LABELS[stepTrack].badge} · {step.durationTriplet.point}m
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

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
