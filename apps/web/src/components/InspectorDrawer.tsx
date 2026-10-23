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

// One practice question per curriculum, with its formula in TeX. A choice value is what Submit records.
export interface ConceptCheck {
  readonly formula: string;
  readonly question: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly hint: string;
  readonly solution: string;
}

export interface PracticeState {
  readonly hintRequested: boolean;
  readonly workedSolutionRevealed: boolean;
  readonly submitted: boolean;
  readonly choice: string | null;
}

// A worked example, quiz, or review ends with the curriculum's concept check, unless a rubric checks it instead.
const CONCEPT_CHECK_TYPES: ReadonlySet<string> = new Set(["worked_example", "quiz", "review"]);

export type SourceCardView = StudyActivity["resourceProvenanceCards"][number];

export function displayLocation(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  return hostname.endsWith(".invalid") ? path.replace(/^\/+/, "") || "catalog" : `${hostname.replace(/^www\./, "")}${path}`;
}

export type InspectorMode = "unit" | "activity";

export interface InspectorDrawerProps {
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
}

export function InspectorDrawer({
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
    const prereqText = prereqLabels.length > 0 ? `Requires ${prereqLabels.join(", ")}` : "Entry unit (no prior unit prerequisite)";
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
      ["pin", `${mod.activities.length} activities (${reqCount} required${optCount > 0 ? `, ${optCount} optional` : ""})`],
      ["learn", prereqText],
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
            Unit {unitNumber} of {modules.length} · Row Accumulation Summary
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
                {uProg.done}/{uProg.total} required completed
              </span>
            </span>
            <span class="proficiency-pill" data-proficiency-status={gate.passed ? "demonstrated" : "unassessed"}>
              <StatusGlyph type="gate" tone={gate.passed ? "done" : "todo"} size={16} />
              <span>Gate: {gate.passed ? "Passed" : `${gate.demonstrated}/${gate.total} demonstrated`}</span>
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
            <h3 id={`${INSPECTOR_ID}-unit-overview`}>Unit overview</h3>
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
            <h3 id={`${INSPECTOR_ID}-unit-activities`}>All activities in this row ({mod.activities.length})</h3>
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
            <h3 id={`${INSPECTOR_ID}-unit-objectives`}>Learning objectives &amp; gate criteria ({mod.objectives.length})</h3>
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

          {unitResources.length > 0 ? (
            <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-unit-resources`}>
              <h3 id={`${INSPECTOR_ID}-unit-resources`}>Accumulated study materials ({unitResources.length})</h3>
              {unitResources.map((card, index) => {
                const url = card.canonicalUrl;
                return (
                  <article
                    key={`${card.resourceVersionId}-${index}`}
                    class="source-card"
                    data-resource-version-id={card.resourceVersionId}
                  >
                    <h4 class="source-title">{card.title}</h4>
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
              })}
            </section>
          ) : null}
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
                {isClosed(nextUnitActivity.executionStatus) ? "Inspect activity" : "Open next in unit"}: <MathText text={nextUnitActivity.title} />
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
  const criteriaObjectives = mine.filter((objective) => objective.successCriterion);

  const check = conceptCheck && !rubric && CONCEPT_CHECK_TYPES.has(activity.type) ? conceptCheck : null;
  const chosen = check?.choices.find((choice) => choice.value === practice.choice);

  const specs: readonly (readonly [SfIconName, string])[] = [
    ["clock", effortWords(activity.durationTriplet)],
    ["rigor", rigor],
    ["pin", activity.required ? "Required" : "Optional"],
    ["code", "Local or external IDE"],
  ];

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
        <p class="inspector-context">
          Unit {unitNumber} · {TRACK_LABELS[track].badge}
        </p>
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

        {!isLab && activity.promptSummary && activity.promptSummary !== activity.title ? (
          <section class="inspector-section study-guide-prompt" aria-labelledby={`${INSPECTOR_ID}-prompt`}>
            <h3 id={`${INSPECTOR_ID}-prompt`}>Study focus</h3>
            <p class="prose">
              <MathText text={activity.promptSummary} />
            </p>
          </section>
        ) : null}

        {rubric ? (
          <section class="inspector-section rubric-block" aria-labelledby={`${INSPECTOR_ID}-rubric`}>
            <h3 id={`${INSPECTOR_ID}-rubric`}>Synthesis &amp; Self-Check Rubric</h3>
            <p class="rubric-mode">Self-Evaluated Rubric · No public quiz bank for this topic</p>
            <p class="rubric-label">Guiding synthesis prompt</p>
            <p class="rubric-prompt">
              <MathText text={rubric.prompt} />
            </p>
            <p class="rubric-label">Check your synthesis against each criterion before you mark this Done</p>
            <ul class="lab-checklist">
              {rubric.criteria.map((criterion, idx) => (
                <li key={idx}>
                  <StatusGlyph type="module" tone="todo" size={16} />
                  <span>
                    <MathText text={criterion} />
                  </span>
                </li>
              ))}
            </ul>
            <p class="meta-text">Your self-check does not change the objective's proficiency status.</p>
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
            <section class="inspector-section" aria-labelledby={`${INSPECTOR_ID}-checks`}>
              <h3 id={`${INSPECTOR_ID}-checks`}>Verification checklist</h3>
              <ul class="lab-checklist">
                {criteriaObjectives.length > 0 ? (
                  criteriaObjectives.map((objective) => (
                    <li key={objective.objectiveId}>
                      <StatusGlyph type="module" tone="todo" size={16} />
                      <span>
                        <MathText text={objective.successCriterion} />
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No acceptance criteria are stated.</li>
                )}
              </ul>
            </section>
          </>
        ) : null}

        {activity.resourceProvenanceCards.map((card, index) => {
          const segments = catalogResources[card.resourceVersionId]?.segments ?? [];
          const sections = card.verifiedSegments
            .flatMap((segmentId) => segments.find((segment) => segment.segment_id === segmentId)?.title ?? [])
            .map((section) => renderUntrustedCatalogText(section, { maxLength: 300 }).text);
          const tags = [
            humanize(card.accessModel),
            card.rightsBadge.externalLinkOnly ? "External link" : humanize(card.rightsBadge.basis),
            ...(card.optionalCertificationBadge ? [`Optional certificate ${formatMinorCurrency(4900, "USD")}`] : []),
          ];
          const url = card.canonicalUrl;
          return (
            <section
              key={`${card.resourceVersionId}-${index}`}
              class="source-card"
              data-resource-version-id={card.resourceVersionId}
              aria-labelledby={`${INSPECTOR_ID}-source-${index}`}
            >
              <h3 id={`${INSPECTOR_ID}-source-${index}`} class="source-title">
                {card.title}
              </h3>
              <p class="source-publisher">{card.verifiedPublisher}</p>
              {url ? (
                <p class="source-location">
                  <SfIcon name="resources" size={15} />
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {displayLocation(url)}
                  </a>
                </p>
              ) : null}
              {sections.map((section, secIdx) => (
                <p key={secIdx} class="source-section">
                  <MathText text={section} />
                </p>
              ))}
              <ul class="source-tags">
                {tags.map((tag, tagIdx) => (
                  <li key={tagIdx}>{tag}</li>
                ))}
              </ul>
              {url ? (
                <a class="btn-primary source-open" href={url} target="_blank" rel="noopener noreferrer">
                  {isLab ? "Open Lab Specification" : "Open Study Material"}
                  <span aria-hidden="true">↗</span>
                  <span class="st-sr"> in a new tab</span>
                </a>
              ) : null}
            </section>
          );
        })}

        {check ? (
          <section
            id="study-workspace"
            class="inspector-section study-workspace"
            aria-labelledby={`${INSPECTOR_ID}-check`}
            data-opaque-surface="true"
          >
            <h3 id={`${INSPECTOR_ID}-check`}>Concept check</h3>
            <div
              class="math-formula-surface"
              data-opaque-surface="true"
              dangerouslySetInnerHTML={{ __html: renderAccessibleMathFormula(check.formula, { displayMode: "block" }).mathml }}
            />
            <fieldset class="choice-group">
              <legend>
                <MathText text={check.question} />
              </legend>
              {check.choices.map(({ value, label }) => (
                <label key={value} class="choice-option" for={`practice-choice-${value}`}>
                  <input
                    type="radio"
                    id={`practice-choice-${value}`}
                    name="practice-choice"
                    value={value}
                    checked={value === practice.choice}
                  />
                  <span>
                    <MathText text={label} />
                  </span>
                </label>
              ))}
            </fieldset>
            <div class="action-row">
              <button type="button" class="btn-secondary" data-action="request-hint">
                Request hint
              </button>
              <button type="button" class="btn-secondary" data-action="study-worked-solution">
                Study worked solution
              </button>
              <button type="button" class="btn-primary" data-action="submit-practice">
                Submit
              </button>
            </div>
            {practice.submitted ? (
              <p class="meta-text practice-feedback" role="status">
                {chosen ? (
                  <>
                    Answer submitted: <MathText text={chosen.label} />. Practice answers do not change the objective's proficiency status.
                  </>
                ) : (
                  "Choose an answer, then select Submit."
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
        ) : null}

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
        )}

        {skipRecorded ? (
          <p class="prose" role="status">
            {`Skip recorded for ${activity.title} only. Prerequisite evidence was not created.`}
          </p>
        ) : null}
      </div>
      <div class="inspector-actions">
        {status !== "completed" ? (
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
        <button type="button" class="btn-secondary" data-action="skip-activity" data-activity-id={id}>
          Skip this activity
        </button>
      </div>
    </dialog>
  );
}
