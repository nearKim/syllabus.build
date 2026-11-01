import type { VNode } from "preact";
import type { Account } from "../../auth.ts";
import { handleOf } from "../AuthDialog.tsx";
import { SfIcon, StatusGlyph } from "../Icons.tsx";
import { displayUnitTitle } from "../StudyFlowBoard.tsx";
import {
  PRIVATE_FIELDS_REMOVED,
  type ActiveSyllabus,
  type MarketplaceListing,
} from "./types.ts";
import { publicProjectionOf } from "./filterEngine.ts";

export interface PublicationPreviewDialogProps {
  readonly open: boolean;
  readonly account: Account;
  readonly selectedPlan: ActiveSyllabus;
  readonly publishedFromHere: boolean;
  readonly originListing: MarketplaceListing | undefined;
}

export function PublicationPreviewDialog({
  open,
  account,
  selectedPlan,
  publishedFromHere,
  originListing,
}: PublicationPreviewDialogProps): VNode {
  const publicProjection = publicProjectionOf(selectedPlan.syllabus);
  return (
    <dialog
      id="dialog-publication-preview"
      closedby="any"
      aria-labelledby="dialog-publication-preview-title"
      data-open={String(open)}
      data-opaque-surface="true"
    >
      <form method="dialog" class="dialog-surface">
        <header class="dialog-header">
          <h2 id="dialog-publication-preview-title">Share with Community</h2>
          <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
            <SfIcon name="close" />
          </button>
        </header>
        <p class="meta-text">This preview is exactly what becomes public.</p>
        <section class="publish-preview" aria-labelledby="publish-preview-title">
          <h3 id="publish-preview-title">{publicProjection.title}</h3>
          <p class="prose">{publicProjection.summary}</p>
          <p class="meta-text">
            {handleOf(account)} · {publicProjection.modules.length} units · {`${selectedPlan.domain} · ${selectedPlan.assessmentMode}`} · CC BY 4.0
          </p>
          <ol class="publish-units">
            {publicProjection.modules.map((mod) => (
              <li key={mod.module_id}>{displayUnitTitle(mod.title)}</li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="publish-private-title">
          <h3 id="publish-private-title">Removed before publishing</h3>
          <ul class="lab-checklist privacy-checklist">
            {PRIVATE_FIELDS_REMOVED.map((item) => (
              <li key={item}>
                <StatusGlyph type="module" tone="done" size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <p class="prose meta-text">
          Visibility: Public. The listing appears in Explore, and anyone can read it. Linked materials stay links, and their content is not relicensed.
        </p>
        {originListing ? (
          <p class="prose meta-text">
            Based on {originListing.handle}'s template. Their attribution stays on your listing.
          </p>
        ) : null}
        {publishedFromHere ? (
          <p class="prose" role="status">
            This plan is already shared with the Community as revision 1.
          </p>
        ) : (
          <footer class="dialog-footer">
            <button type="button" class="btn-primary" data-action="confirm-publish-syllabus">
              Publish to Community
              <span aria-hidden="true">→</span>
            </button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
