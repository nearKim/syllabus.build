import type { VNode } from "preact";
import { renderUntrustedCatalogText, type CatalogResourceMetadataInput } from "../../../../packages/ui/src/index.ts";
import { formatMinorCurrency } from "../billingAndSharing.ts";
import { SfIcon, StatusGlyph, type SfIconName } from "./Icons.tsx";
import {
  ActivityGlyph,
  TRACK_LABELS,
  effortWords,
  executionTone,
  humanize,
  isClosed,
  postGateIds,
  trackOf,
  unitGate,
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

export type SourceCardView = StudyActivity["resourceProvenanceCards"][number];

export function displayLocation(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  return hostname.endsWith(".invalid") ? path.replace(/^\/+/, "") || "catalog" : `${hostname.replace(/^www\./, "")}${path}`;
}

export interface InspectorDrawerProps {
  readonly modules: readonly StudyModule[];
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly open: boolean;
  readonly rigor: string;
  readonly deliverables: readonly string[];
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly rubric: SelfCheckRubric | null;
  readonly skipRecorded: boolean;
}

export function InspectorDrawer({
  modules,
  mod,
  activity,
  open,
  rigor,
  deliverables,
  catalogResources,
  rubric,
  skipRecorded,
}: InspectorDrawerProps): VNode {
  const id = activity.activityId;
  const track = trackOf(activity);
  const isGate = track === "gate";
  const isLab = activity.type === "coding" || activity.type === "project";
  const unitNumber = modules.indexOf(mod) + 1;
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
      data-activity-id={id}
      data-opaque-surface="true"
    >
      <header class="inspector-head">
        <p class="inspector-context">
          Unit {unitNumber} · {TRACK_LABELS[track].badge}
        </p>
        <h2 id={`${INSPECTOR_ID}-title`} tabIndex={-1} autofocus>
          {activity.title}
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
                <span class="step-nav-text">Prev: {prev.title}</span>
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
                <span class="step-nav-text">Next: {next.title}</span>
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
                <span>{step.title}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        ) : null}

        {rubric ? (
          <section class="inspector-section rubric-block" aria-labelledby={`${INSPECTOR_ID}-rubric`}>
            <h3 id={`${INSPECTOR_ID}-rubric`}>Synthesis &amp; Self-Check Rubric</h3>
            <p class="rubric-mode">Self-Evaluated Rubric · No public quiz bank for this topic</p>
            <p class="rubric-label">Guiding synthesis prompt</p>
            <p class="rubric-prompt">{rubric.prompt}</p>
            <p class="rubric-label">Check your synthesis against each criterion before you mark this Done</p>
            <ul class="lab-checklist">
              {rubric.criteria.map((criterion, idx) => (
                <li key={idx}>
                  <StatusGlyph type="module" tone="todo" size={16} />
                  <span>{criterion}</span>
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
              <p>{activity.promptSummary}</p>
              {deliverables.length > 0 ? (
                <ul class="lab-deliverables">
                  {deliverables.map((item, idx) => (
                    <li key={idx}>{item}</li>
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
                      <span>{objective.successCriterion}</span>
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
                  {section}
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

        <section class="inspector-section conceptual-focus" aria-labelledby={`${INSPECTOR_ID}-focus`}>
          <h3 id={`${INSPECTOR_ID}-focus`}>{isGate ? "What this checks" : "What this builds"}</h3>
          <ul class="focus-list">
            {mine.length > 0 ? (
              mine.map((objective) => <li key={objective.objectiveId}>{objective.title}</li>)
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
            <span class="next-step-text">Go to next step: {next.title}</span>
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
