import type { VNode } from "preact";
import { SfIcon } from "../Icons.tsx";

export interface DeleteSyllabusDialogProps {
  readonly open: boolean;
  readonly syllabusId: string;
  readonly syllabusTitle: string;
}

export function DeleteSyllabusDialog({
  open,
  syllabusId,
  syllabusTitle,
}: DeleteSyllabusDialogProps): VNode {
  return (
    <dialog
      id="dialog-delete-syllabus"
      class="modal-dialog modal-dialog-sm"
      closedby="any"
      aria-labelledby="dialog-delete-syllabus-title"
      data-open={String(open)}
      data-syllabus-id={syllabusId}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-delete-syllabus-title">Delete syllabus</h2>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>
        <p class="prose warning-copy">
          Remove <strong>{syllabusTitle}</strong> from your private study workspace? Your local schedule overrides and structure edits for this plan will be deleted. Shared public templates in Explore remain unchanged unless you unpublish them separately.
        </p>
        <footer class="dialog-footer">
          <form method="dialog">
            <button type="submit" class="btn-secondary" data-action="close-dialog" autofocus>
              Cancel
            </button>
          </form>
          <button
            type="button"
            class="btn-danger"
            data-action="confirm-delete-syllabus"
            data-syllabus-id={syllabusId}
          >
            Delete syllabus
          </button>
        </footer>
      </div>
    </dialog>
  );
}
