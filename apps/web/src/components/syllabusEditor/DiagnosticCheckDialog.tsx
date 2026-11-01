import type { VNode } from "preact";
import { renderAccessibleMathFormula } from "@syllabus/ui";
import type { DiagnosticQuestion } from "../../liveTutor.ts";
import { SfIcon } from "../Icons.tsx";
import { MathText } from "../MathText.tsx";

export interface DiagnosticCheckDialogProps {
  readonly open: boolean;
  readonly question: DiagnosticQuestion | null;
  readonly selectedChoice: string | null;
  readonly feedback: { readonly passed: boolean; readonly message: string } | null;
  readonly isDemonstrated: boolean;
  readonly assessedCount: number;
  readonly totalCount: number;
  readonly nextObjectiveId: string | null;
}

export function DiagnosticCheckDialog({
  open,
  question,
  selectedChoice,
  feedback,
  isDemonstrated,
  assessedCount,
  totalCount,
  nextObjectiveId,
}: DiagnosticCheckDialogProps): VNode {
  return (
    <dialog
      id="dialog-diagnostic-check"
      class="modal-dialog"
      closedby="any"
      aria-labelledby="dialog-diagnostic-check-title"
      data-open={String(open)}
      data-objective-id={question?.objectiveId ?? ""}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <div>
            <h2 id="dialog-diagnostic-check-title">Understanding check</h2>
            <p class="row-meta">
              {assessedCount} of {totalCount} capabilities verified · Unassisted checkpoint
            </p>
          </div>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>

        {question ? (
          <div class="diagnostic-dialog-body">
            <div class="diagnostic-capability-bar">
              <div>
                <p class="row-meta">Target capability</p>
                <strong class="capability-title">
                  <MathText text={question.objectiveTitle} />
                </strong>
              </div>
              <span class="badge badge-proficiency-status" data-proficiency-status={isDemonstrated ? "demonstrated" : "unassessed"}>
                {isDemonstrated ? "Demonstrated" : "Unassessed"}
              </span>
            </div>

            <div
              class="math-formula-surface"
              data-opaque-surface="true"
              dangerouslySetInnerHTML={{
                __html: renderAccessibleMathFormula(question.formula, { displayMode: "block" }).mathml,
              }}
            />

            <fieldset class="choice-group">
              <legend>
                <MathText text={question.question} />
              </legend>
              {question.choices.map(({ value, label }, idx) => (
                <label key={value} class="choice-option" for={`diagnostic-choice-${value}`}>
                  <input
                    type="radio"
                    class="st-sr"
                    id={`diagnostic-choice-${value}`}
                    name="diagnostic-choice"
                    value={value}
                    checked={value === selectedChoice}
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

            <p class="row-meta">
              No hints or worked solutions are shown during an understanding check so a correct answer independently corroborates this objective.
            </p>

            {feedback ? (
              <div class="practice-note diagnostic-feedback-box" data-passed={String(feedback.passed)} role="status">
                <p>
                  <strong>{feedback.passed ? "Capability demonstrated." : "Not yet corroborated."}</strong>{" "}
                  {feedback.message}
                </p>
                <p class="row-meta">
                  <MathText text={question.explanation} />
                </p>
              </div>
            ) : null}

            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-dialog"
                data-dialog-id="dialog-adaptation-diff"
              >
                Preview plan adaptation
              </button>
              {nextObjectiveId && nextObjectiveId !== question.objectiveId ? (
                <button
                  type="button"
                  class="btn-secondary"
                  data-action="diagnostic-continue"
                  data-objective-id={nextObjectiveId}
                >
                  Next capability
                </button>
              ) : null}
              <button
                type="button"
                class="btn-primary"
                data-action="submit-diagnostic-answer"
                data-objective-id={question.objectiveId}
              >
                Verify answer
              </button>
            </footer>
          </div>
        ) : (
          <p class="prose">No objectives are configured for this syllabus yet.</p>
        )}
      </div>
    </dialog>
  );
}
