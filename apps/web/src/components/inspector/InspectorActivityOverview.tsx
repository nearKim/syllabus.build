import type { ComponentChildren, VNode } from "preact";
import { SfIcon, StatusGlyph, type SfIconName } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";
import {
  TRACK_LABELS,
  effortWords,
  isClosed,
  postGateIds,
  trackOf,
  unitGate,
  type StudyActivity,
  type StudyModule,
} from "../StudyFlowBoard.tsx";
import { INSPECTOR_ID, type SelfCheckRubric } from "./types.ts";

export interface InspectorActivityOverviewProps {
  readonly mod: StudyModule;
  readonly activity: StudyActivity;
  readonly unitNumber: number;
  readonly rigor: string;
  readonly deliverables: readonly string[];
  readonly rubric: SelfCheckRubric | null;
  readonly mine: readonly { readonly objectiveId: string; readonly title: string }[];
  readonly isGate: boolean;
  readonly isLab: boolean;
  readonly uProg: { readonly done: number; readonly total: number; readonly left: number };
  readonly children?: ComponentChildren;
}

export function InspectorActivityOverview({
  mod,
  activity,
  unitNumber,
  rigor,
  deliverables,
  rubric,
  mine,
  isGate,
  isLab,
  uProg,
  children,
}: InspectorActivityOverviewProps): VNode {
  const hasPrompt = !isLab && Boolean(activity.promptSummary && activity.promptSummary !== activity.title);

  const specs: readonly (readonly [SfIconName, string])[] = [
    ["clock", effortWords(activity.durationTriplet)],
    ["rigor", rigor],
    ["pin", activity.required ? "Required" : "Optional"],
    ["code", "Local or external IDE"],
  ];

  return (
    <>
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

      {children}

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
    </>
  );
}
