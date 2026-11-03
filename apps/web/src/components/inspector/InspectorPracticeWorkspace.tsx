import type { VNode } from "preact";
import { renderAccessibleMathFormula } from "@syllabus/ui";
import { MathText } from "../MathText.tsx";
import type { ConceptCheck, PracticeState } from "./types.ts";

export interface InspectorPracticeWorkspaceProps {
  readonly id: string;
  readonly check: ConceptCheck;
  readonly practice: PracticeState;
}

export function InspectorPracticeWorkspace({
  id,
  check,
  practice,
}: InspectorPracticeWorkspaceProps): VNode {
  const chosen = check.choices.find((choice) => choice.value === practice.choice);

  return (
    <>
      <p class="subtask-meta">Practice only. Does not change mastery.</p>
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
  );
}
