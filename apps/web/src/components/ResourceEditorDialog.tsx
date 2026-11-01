import type { VNode } from "preact";
import type { CatalogResourceMetadataInput } from "../../../../packages/ui/src/index.ts";
import {
  findResourceBindingInSyllabus,
  type ManualResourceAccessModel,
  type ManualResourceCategory,
} from "../resourceAnalyzer.ts";
import { asRecord, goalTitleOf, rawListOf, type ActiveSyllabus } from "./ExploreMarketplace.tsx";
import { SfIcon } from "./Icons.tsx";
import { displayUnitTitle } from "./StudyFlowBoard.tsx";

export const RESOURCE_EDITOR_MODES = ["ingest", "link", "edit"] as const;
export type ResourceEditorMode = (typeof RESOURCE_EDITOR_MODES)[number];

export const MANUAL_RESOURCE_CATEGORIES: readonly ManualResourceCategory[] = [
  "Course",
  "Book",
  "YouTube",
  "Code Lab",
  "Problem Set",
];

export const MANUAL_RESOURCE_ACCESS_CHOICES: readonly {
  readonly value: ManualResourceAccessModel;
  readonly label: string;
}[] = [
  { value: "free", label: "Free / Open access" },
  { value: "freemium_optional_certificate", label: "Freemium (free audit, optional certificate)" },
  { value: "paid", label: "Paid course or book" },
  { value: "library_loan", label: "Institutional / Library loan" },
];

export interface ResourceEditorDialogProps {
  readonly open: boolean;
  readonly mode: ResourceEditorMode;
  readonly selectedPlan: ActiveSyllabus;
  readonly allPlans: readonly ActiveSyllabus[];
  readonly catalogResources: Readonly<Record<string, CatalogResourceMetadataInput>>;
  readonly userLibraryResourceIds: readonly string[];
  readonly removedResourceIds: readonly string[];
  readonly editingResourceId: string | null;
  readonly targetSyllabusId: string | null;
  readonly targetModuleId: string | null;
  readonly targetActivityId: string | null;
  readonly rawDraft: string;
  readonly editorError: string | null;
}

interface UnitOption {
  readonly moduleId: string;
  readonly label: string;
}

function unitsOfSyllabus(syllabus: Record<string, unknown>): readonly UnitOption[] {
  return rawListOf(syllabus, "modules").map((rawMod, idx) => {
    const rec = asRecord(rawMod);
    const moduleId = typeof rec["module_id"] === "string" ? rec["module_id"] : `module-${idx + 1}`;
    const rawTitle = typeof rec["title"] === "string" ? rec["title"] : `Unit ${idx + 1}`;
    return {
      moduleId,
      label: `U${idx + 1} · ${displayUnitTitle(rawTitle)}`,
    };
  });
}

export function ResourceEditorDialog({
  open,
  mode,
  selectedPlan,
  allPlans,
  catalogResources,
  userLibraryResourceIds,
  removedResourceIds,
  editingResourceId,
  targetSyllabusId,
  targetModuleId,
  targetActivityId,
  rawDraft,
  editorError,
}: ResourceEditorDialogProps): VNode {
  const removedSet = new Set(removedResourceIds);
  const userLibSet = new Set(userLibraryResourceIds);

  const libraryOptions = Object.entries(catalogResources)
    .filter(([id, entry]) => !removedSet.has(id) && Boolean(entry?.title))
    .map(([id, entry]) => ({
      id,
      title: entry.title ?? id,
      publisher: entry.provider?.display_name ?? "Indexed source",
      category: entry.category ?? "Book",
      isUserAdded: userLibSet.has(id) || id.startsWith("manual-"),
    }))
    .sort((a, b) => {
      if (a.isUserAdded !== b.isUserAdded) return a.isUserAdded ? -1 : 1;
      return a.title.localeCompare(b.title);
    });

  const activeSyllabusValue =
    targetSyllabusId === "__library_only__"
      ? "__library_only__"
      : allPlans.some((p) => p.syllabusId === targetSyllabusId)
        ? (targetSyllabusId as string)
        : selectedPlan.syllabusId;

  const targetPlan =
    activeSyllabusValue === "__library_only__"
      ? null
      : (allPlans.find((p) => p.syllabusId === activeSyllabusValue) ?? selectedPlan);

  const linkPlan =
    allPlans.find((p) => p.syllabusId === targetSyllabusId) ?? selectedPlan;
  const targetUnits = targetPlan ? unitsOfSyllabus(targetPlan.syllabus) : [];
  const linkUnits = unitsOfSyllabus(linkPlan.syllabus);

  const activeEditId = editingResourceId ?? libraryOptions[0]?.id ?? "";
  const rawEditEntry = activeEditId ? catalogResources[activeEditId] : undefined;

  // Locate existing syllabus binding when editing so unit, role, and rationale pre-populate accurately.
  const existingBinding =
    activeEditId && targetPlan
      ? findResourceBindingInSyllabus(targetPlan.syllabus, activeEditId)
      : null;

  const chosenModuleId =
    targetModuleId && targetUnits.some((u) => u.moduleId === targetModuleId)
      ? targetModuleId
      : (existingBinding?.moduleId ?? targetUnits[0]?.moduleId ?? "");

  const chosenLinkModuleId =
    targetModuleId && linkUnits.some((u) => u.moduleId === targetModuleId)
      ? targetModuleId
      : (linkUnits[0]?.moduleId ?? "");

  const dialogTitle =
    mode === "edit"
      ? "Edit learning resource"
      : mode === "link"
        ? "Add resource from library"
        : "Add learning resource";

  const editTitle = rawEditEntry?.title ?? "";
  const editUrl = rawEditEntry?.canonical_url ?? "";
  const editPublisher = rawEditEntry?.provider?.display_name ?? "";
  const editCategory: ManualResourceCategory =
    MANUAL_RESOURCE_CATEGORIES.includes(rawEditEntry?.category as ManualResourceCategory)
      ? (rawEditEntry?.category as ManualResourceCategory)
      : "Course";
  const editAccess: ManualResourceAccessModel =
    rawEditEntry?.access?.model === "freemium_optional_certificate" ||
    rawEditEntry?.access?.model === "paid" ||
    rawEditEntry?.access?.model === "library_loan"
      ? rawEditEntry.access.model
      : "free";
  const editTopics = (rawEditEntry?.topics ?? []).join(", ");
  const editSegments = (rawEditEntry?.segments ?? [])
    .map((s) => s.title ?? "")
    .filter(Boolean)
    .join("\n");
  const editRationale = existingBinding?.selectionRationale || rawEditEntry?.description || "";
  const editRole = existingBinding?.role ?? "primary";

  const editSyllabusValue =
    targetSyllabusId === "__library_only__"
      ? "__library_only__"
      : existingBinding && targetPlan
        ? targetPlan.syllabusId
        : targetSyllabusId && allPlans.some((p) => p.syllabusId === targetSyllabusId) &&
            findResourceBindingInSyllabus(
              (allPlans.find((p) => p.syllabusId === targetSyllabusId) ?? selectedPlan).syllabus,
              activeEditId,
            )
          ? targetSyllabusId
          : existingBinding
            ? selectedPlan.syllabusId
            : "__library_only__";

  const editBoundPlan =
    editSyllabusValue === "__library_only__"
      ? null
      : (allPlans.find((p) => p.syllabusId === editSyllabusValue) ?? null);
  const editBoundUnits = editBoundPlan ? unitsOfSyllabus(editBoundPlan.syllabus) : [];
  const editChosenUnit =
    targetModuleId && editBoundUnits.some((u) => u.moduleId === targetModuleId)
      ? targetModuleId
      : (existingBinding?.moduleId ?? editBoundUnits[0]?.moduleId ?? "");

  return (
    <dialog
      id="dialog-resource-editor"
      class="modal-dialog resource-editor-dialog"
      closedby="any"
      aria-labelledby="dialog-resource-editor-title"
      data-open={String(open)}
      data-editor-mode={mode}
      data-opaque-surface="true"
    >
      <div class="dialog-surface resource-editor-surface">
        <header class="dialog-header">
          <h2 id="dialog-resource-editor-title">{dialogTitle}</h2>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>

        {mode !== "edit" ? (
          <div class="segmented resource-editor-tabs" role="group" aria-label="Resource source">
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-editor-mode"
              data-editor-mode="ingest"
              aria-pressed={mode === "ingest"}
            >
              Paste URL &amp; notes
            </button>
            <button
              type="button"
              class="seg-btn"
              data-action="set-resource-editor-mode"
              data-editor-mode="link"
              aria-pressed={mode === "link"}
            >
              From your library ({libraryOptions.length})
            </button>
          </div>
        ) : null}

        {editorError ? (
          <p class="resource-editor-error" role="alert">
            {editorError}
          </p>
        ) : null}

        {mode === "ingest" ? (
          <form class="resource-editor-form" data-action="ingest-manual-resource">
            {targetActivityId ? <input type="hidden" name="targetActivityId" value={targetActivityId} /> : null}
            <div class="field resource-editor-field">
              <label for="resource-raw-input">Resource URL and notes</label>
              <span id="resource-raw-hint" class="resource-field-hint">
                Paste a URL (even without https://) alongside free-form notes. AI inspects the page internals, extracts topics and syllabus sections, and updates your search index.
              </span>
              <textarea
                id="resource-raw-input"
                name="rawText"
                rows={3}
                required
                aria-describedby="resource-raw-hint"
                aria-errormessage="resource-raw-error"
                placeholder="udemy.com/course/ckad-kubernetes this is the CKAD course covering pods, deployments, Helm, and network policies"
                defaultValue={rawDraft}
              />
              <span id="resource-raw-error" class="resource-val-error">
                Paste a resource URL with optional study notes.
              </span>
            </div>

            <div class="field resource-editor-field">
              <label for="resource-target-syllabus">Destination</label>
              <select
                id="resource-target-syllabus"
                name="targetSyllabusId"
                data-action="set-resource-editor-syllabus"
              >
                <option value="__library_only__" selected={activeSyllabusValue === "__library_only__"}>
                  Save to library only (link later)
                </option>
                {allPlans.map((plan) => (
                  <option
                    key={plan.syllabusId}
                    value={plan.syllabusId}
                    selected={activeSyllabusValue === plan.syllabusId}
                  >
                    Link to: {goalTitleOf(plan.syllabus)}
                  </option>
                ))}
              </select>
            </div>

            {targetPlan ? (
              <div class="resource-editor-grid resource-editor-grid-two">
                <div class="field resource-editor-field">
                  <label for="resource-target-module">Unit</label>
                  <select id="resource-target-module" name="targetModuleId">
                    {targetUnits.map((unit) => (
                      <option key={unit.moduleId} value={unit.moduleId} selected={unit.moduleId === chosenModuleId}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field resource-editor-field">
                  <label for="resource-target-role">Role</label>
                  <select id="resource-target-role" name="role">
                    <option value="primary" selected>
                      Core study material
                    </option>
                    <option value="supplemental">Optional / supplemental</option>
                  </select>
                </div>
              </div>
            ) : null}

            <label class="switch-field resource-open-catalog-toggle" for="resource-ingest-open-catalog">
              <input
                id="resource-ingest-open-catalog"
                type="checkbox"
                name="saveToOpenCatalog"
                value="true"
              />
              <span>Also write JSON file to <code>catalog/resources/</code> for Git contribution</span>
            </label>

            <footer class="dialog-footer resource-editor-footer">
              <div class="resource-editor-submit-actions">
                <button type="button" class="btn-secondary" data-action="close-dialog">
                  Cancel
                </button>
                <button type="submit" class="btn-primary" id="resource-ingest-submit">
                  <span>Analyze &amp; add resource</span>
                </button>
              </div>
            </footer>
          </form>
        ) : mode === "link" ? (
          <form class="resource-editor-form" data-action="link-library-resource">
            {targetActivityId ? <input type="hidden" name="targetActivityId" value={targetActivityId} /> : null}
            <div class="field resource-editor-field">
              <label for="resource-link-id">Indexed library resource</label>
              <span id="resource-link-hint" class="resource-field-hint">
                Choose any resource already indexed in your library to attach it to a syllabus unit.
              </span>
              <select
                id="resource-link-id"
                name="resourceVersionId"
                aria-describedby="resource-link-hint"
                required
              >
                {libraryOptions.map((opt) => (
                  <option key={opt.id} value={opt.id} selected={opt.id === activeEditId}>
                    {opt.isUserAdded ? "Saved · " : ""}
                    {opt.title} ({opt.category} · {opt.publisher})
                  </option>
                ))}
              </select>
            </div>

            <div class="field resource-editor-field">
              <label for="resource-link-syllabus">Syllabus</label>
              <select
                id="resource-link-syllabus"
                name="targetSyllabusId"
                data-action="set-resource-editor-syllabus"
              >
                {allPlans.map((plan) => (
                  <option
                    key={plan.syllabusId}
                    value={plan.syllabusId}
                    selected={linkPlan.syllabusId === plan.syllabusId}
                  >
                    {goalTitleOf(plan.syllabus)}
                  </option>
                ))}
              </select>
            </div>

            <div class="resource-editor-grid resource-editor-grid-two">
              <div class="field resource-editor-field">
                <label for="resource-link-module">Unit</label>
                <select id="resource-link-module" name="targetModuleId">
                  {linkUnits.map((unit) => (
                    <option key={unit.moduleId} value={unit.moduleId} selected={unit.moduleId === chosenLinkModuleId}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </div>

              <div class="field resource-editor-field">
                <label for="resource-link-role">Role</label>
                <select id="resource-link-role" name="role">
                  <option value="primary" selected>
                    Core study material
                  </option>
                  <option value="supplemental">Optional / supplemental</option>
                </select>
              </div>
            </div>

            <div class="field resource-editor-field">
              <label for="resource-link-rationale">Study note for this syllabus (optional)</label>
              <span id="resource-link-rationale-hint" class="resource-field-hint">
                Explain which chapters, labs, or lectures to focus on in this unit.
              </span>
              <textarea
                id="resource-link-rationale"
                name="selectionRationale"
                rows={2}
                aria-describedby="resource-link-rationale-hint"
                placeholder="Focus on deployments, configmaps, and multi-container pod labs."
                defaultValue={rawEditEntry?.description ?? ""}
              />
            </div>

            <footer class="dialog-footer resource-editor-footer">
              <div class="resource-editor-submit-actions">
                <button type="button" class="btn-secondary" data-action="close-dialog">
                  Cancel
                </button>
                <button type="submit" class="btn-primary">
                  Add to syllabus
                </button>
              </div>
            </footer>
          </form>
        ) : (
          <form class="resource-editor-form" data-action="save-resource-edit">
            <input type="hidden" id="resource-edit-id" name="resourceVersionId" value={activeEditId} />

            <div class="field resource-editor-field">
              <label for="resource-edit-title">Title</label>
              <input
                id="resource-edit-title"
                type="text"
                name="title"
                required
                aria-errormessage="resource-edit-title-error"
                value={editTitle}
              />
              <span id="resource-edit-title-error" class="resource-val-error">
                Enter a clear resource title.
              </span>
            </div>

            <div class="field resource-editor-field">
              <label for="resource-edit-url">URL</label>
              <span id="resource-edit-url-hint" class="resource-field-hint">
                Public HTTPS address (for example https://udemy.com/course/...).
              </span>
              <input
                id="resource-edit-url"
                type="url"
                name="canonicalUrl"
                required
                aria-describedby="resource-edit-url-hint"
                aria-errormessage="resource-edit-url-error"
                value={editUrl}
              />
              <span id="resource-edit-url-error" class="resource-val-error">
                Enter a valid https:// URL.
              </span>
            </div>

            <div class="resource-editor-grid">
              <div class="field resource-editor-field">
                <label for="resource-edit-category">Type</label>
                <select id="resource-edit-category" name="category">
                  {MANUAL_RESOURCE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat} selected={cat === editCategory}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div class="field resource-editor-field">
                <label for="resource-edit-publisher">Publisher</label>
                <input
                  id="resource-edit-publisher"
                  type="text"
                  name="publisher"
                  value={editPublisher}
                />
              </div>

              <div class="field resource-editor-field">
                <label for="resource-edit-access">Access</label>
                <select id="resource-edit-access" name="accessModel">
                  {MANUAL_RESOURCE_ACCESS_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value} selected={choice.value === editAccess}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div class="field resource-editor-field">
              <label for="resource-edit-topics">Topics</label>
              <span id="resource-edit-topics-hint" class="resource-field-hint">
                Comma-separated keywords indexed into search so future syllabi discover this resource automatically.
              </span>
              <input
                id="resource-edit-topics"
                type="text"
                name="topics"
                aria-describedby="resource-edit-topics-hint"
                value={editTopics}
              />
            </div>

            <div class="field resource-editor-field">
              <label for="resource-edit-segments">Syllabus sections or chapters</label>
              <span id="resource-edit-segments-hint" class="resource-field-hint">
                One section, chapter, or module heading per line.
              </span>
              <textarea
                id="resource-edit-segments"
                name="segments"
                rows={3}
                aria-describedby="resource-edit-segments-hint"
                defaultValue={editSegments}
              />
            </div>

            <div class="field resource-editor-field">
              <label for="resource-edit-syllabus">Syllabus link</label>
              <select
                id="resource-edit-syllabus"
                name="targetSyllabusId"
                data-action="set-resource-editor-syllabus"
              >
                <option value="__library_only__" selected={editSyllabusValue === "__library_only__"}>
                  Library only (not linked to selected syllabus)
                </option>
                {allPlans.map((plan) => (
                  <option
                    key={plan.syllabusId}
                    value={plan.syllabusId}
                    selected={editSyllabusValue === plan.syllabusId}
                  >
                    {goalTitleOf(plan.syllabus)}
                  </option>
                ))}
              </select>
            </div>

            {editBoundPlan ? (
              <div class="resource-editor-grid resource-editor-grid-two">
                <div class="field resource-editor-field">
                  <label for="resource-edit-module">Unit</label>
                  <select id="resource-edit-module" name="targetModuleId">
                    {editBoundUnits.map((unit) => (
                      <option key={unit.moduleId} value={unit.moduleId} selected={unit.moduleId === editChosenUnit}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field resource-editor-field">
                  <label for="resource-edit-role">Role</label>
                  <select id="resource-edit-role" name="role">
                    <option value="primary" selected={editRole === "primary"}>
                      Core study material
                    </option>
                    <option value="supplemental" selected={editRole === "supplemental"}>
                      Optional / supplemental
                    </option>
                  </select>
                </div>
              </div>
            ) : null}

            <div class="field resource-editor-field">
              <label for="resource-edit-rationale">Notes &amp; selection rationale</label>
              <textarea
                id="resource-edit-rationale"
                name="selectionRationale"
                rows={2}
                defaultValue={editRationale}
              />
            </div>

            <label class="switch-field resource-open-catalog-toggle" for="resource-edit-open-catalog">
              <input
                id="resource-edit-open-catalog"
                type="checkbox"
                name="saveToOpenCatalog"
                value="true"
              />
              <span>Also write JSON file to <code>catalog/resources/</code> for Git contribution</span>
            </label>

            <footer class="dialog-footer resource-editor-footer">
              <div class="resource-editor-danger-actions">
                {existingBinding && targetPlan ? (
                  <button
                    type="button"
                    class="source-action-btn source-action-danger"
                    data-action="unlink-syllabus-resource"
                    data-resource-id={activeEditId}
                    data-syllabus-id={targetPlan.syllabusId}
                  >
                    Remove from plan
                  </button>
                ) : null}
                <button
                  type="button"
                  class="source-action-btn source-action-danger"
                  data-action="delete-library-resource"
                  data-resource-id={activeEditId}
                >
                  Delete from library
                </button>
              </div>
              <div class="resource-editor-submit-actions">
                <button type="button" class="btn-secondary" data-action="close-dialog">
                  Cancel
                </button>
                <button type="submit" class="btn-primary">
                  Save changes
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </dialog>
  );
}
