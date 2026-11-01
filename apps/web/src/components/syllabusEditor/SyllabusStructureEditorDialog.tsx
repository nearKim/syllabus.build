import type { VNode } from "preact";
import { asRecord, normalizeStringList, rawListOf } from "../../shared.ts";
import { goalTitleOf } from "../ExploreMarketplace.tsx";
import { SfIcon } from "../Icons.tsx";
import { displayUnitTitle, humanize } from "../StudyFlowBoard.tsx";
import {
  ACTIVITY_TYPE_LABELS,
  EDITABLE_ACTIVITY_TYPES,
  type SyllabusEditMode,
  activityMinutesOfRaw,
  activityPromptOfRaw,
} from "./astMutations.ts";

export interface SyllabusStructureEditorDialogProps {
  readonly open: boolean;
  readonly mode: SyllabusEditMode;
  readonly syllabusId: string;
  readonly syllabus: Record<string, unknown>;
  readonly editingModuleId: string | null;
  readonly editingActivityId: string | null;
  readonly editorError: string | null;
  readonly editorNotice: string | null;
}

export function SyllabusStructureEditorDialog({
  open,
  mode,
  syllabusId,
  syllabus,
  editingModuleId,
  editingActivityId,
  editorError,
  editorNotice,
}: SyllabusStructureEditorDialogProps): VNode {
  const goal = asRecord(syllabus["goal"]);
  const title = goalTitleOf(syllabus);
  const summary = typeof goal["summary"] === "string" ? goal["summary"] : "";
  const rawModules = rawListOf(syllabus, "modules");
  const rawActivities = rawListOf(syllabus, "activities");
  const actById = new Map(rawActivities.map((a) => [String(a["activity_id"] ?? ""), a]));

  const activeMod =
    rawModules.find((m) => m["module_id"] === editingModuleId) ??
    rawModules[0];
  const activeModId = typeof activeMod?.["module_id"] === "string" ? activeMod["module_id"] : "";
  const activeAct = editingActivityId ? actById.get(editingActivityId) : undefined;

  return (
    <dialog
      id="dialog-syllabus-editor"
      class="modal-dialog"
      closedby="any"
      aria-labelledby="dialog-syllabus-editor-title"
      data-open={String(open)}
      data-edit-mode={mode}
      data-syllabus-id={syllabusId}
      data-opaque-surface="true"
    >
      <div class="dialog-surface">
        <header class="dialog-header">
          <div>
            <h2 id="dialog-syllabus-editor-title">Edit syllabus structure</h2>
            <p class="row-meta">{title}</p>
          </div>
          <form method="dialog">
            <button type="submit" class="dialog-close-btn" data-action="close-dialog" aria-label="Close">
              <SfIcon name="close" />
            </button>
          </form>
        </header>

        <div class="segmented syllabus-editor-tabs" role="group" aria-label="Structure editor view">
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="syllabus"
            aria-pressed={mode === "syllabus"}
          >
            Overview &amp; order
          </button>
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="add-module"
            aria-pressed={mode === "add-module" || mode === "edit-module"}
          >
            {mode === "edit-module" ? "Edit unit" : "+ Add unit"}
          </button>
          <button
            type="button"
            class="seg-btn"
            data-action="open-syllabus-editor"
            data-syllabus-edit-mode="add-activity"
            data-module-id={activeModId}
            aria-pressed={mode === "add-activity" || mode === "edit-activity"}
          >
            {mode === "edit-activity" ? "Edit step" : "+ Add step"}
          </button>
        </div>

        {editorError ? (
          <p class="field-error" role="alert">
            {editorError}
          </p>
        ) : null}
        {editorNotice ? (
          <p class="section-lede" role="status">
            {editorNotice}
          </p>
        ) : null}

        {mode === "syllabus" ? (
          <div class="syllabus-editor-stack">
            <form class="syllabus-editor-form" data-action="save-syllabus-meta" novalidate>
              <label class="field" for="syllabus-edit-title">
                <span>Syllabus title</span>
                <span class="field-hint">Shown in Today, Plan, and exported study schedules.</span>
                <input
                  id="syllabus-edit-title"
                  type="text"
                  name="title"
                  value={title}
                  maxLength={140}
                  required
                />
              </label>
              <label class="field" for="syllabus-edit-summary">
                <span>Goal summary</span>
                <textarea
                  id="syllabus-edit-summary"
                  name="summary"
                  rows={2}
                  value={summary}
                />
              </label>
              <div class="action-row">
                <button type="submit" class="btn-primary">
                  Save title &amp; goal
                </button>
                <button
                  type="button"
                  class="btn-danger"
                  data-action="open-dialog"
                  data-dialog-id="dialog-delete-syllabus"
                >
                  Delete syllabus
                </button>
              </div>
            </form>

            <section class="syllabus-structure-tree" aria-label="Units and steps">
              <div class="inspector-section-head">
                <h3>Units ({rawModules.length})</h3>
                <button
                  type="button"
                  class="btn-secondary"
                  data-action="open-syllabus-editor"
                  data-syllabus-edit-mode="add-module"
                >
                  + Add unit
                </button>
              </div>
              <ol class="structure-unit-list">
                {rawModules.map((mod, mIdx) => {
                  const modId = String(mod["module_id"] ?? "");
                  const modTitle = displayUnitTitle(String(mod["title"] ?? `Unit ${mIdx + 1}`));
                  const actIds = normalizeStringList(mod["activity_ids"]);
                  return (
                    <li key={modId} class="structure-unit-card" data-structure-module-id={modId}>
                      <div class="structure-unit-head">
                        <div>
                          <strong>
                            U{mIdx + 1} · {modTitle}
                          </strong>
                          <span class="row-meta"> · {actIds.length} {actIds.length === 1 ? "step" : "steps"}</span>
                        </div>
                        <div class="row-actions">
                          {mIdx > 0 ? (
                            <button
                              type="button"
                              class="source-action-btn"
                              data-action="move-syllabus-module"
                              data-module-id={modId}
                              data-direction="up"
                              aria-label={`Move ${modTitle} up`}
                            >
                              ↑
                            </button>
                          ) : null}
                          {mIdx < rawModules.length - 1 ? (
                            <button
                              type="button"
                              class="source-action-btn"
                              data-action="move-syllabus-module"
                              data-module-id={modId}
                              data-direction="down"
                              aria-label={`Move ${modTitle} down`}
                            >
                              ↓
                            </button>
                          ) : null}
                          <button
                            type="button"
                            class="source-action-btn"
                            data-action="open-syllabus-editor"
                            data-syllabus-edit-mode="edit-module"
                            data-module-id={modId}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="source-action-btn"
                            data-action="open-syllabus-editor"
                            data-syllabus-edit-mode="add-activity"
                            data-module-id={modId}
                          >
                            + Step
                          </button>
                          {rawModules.length > 1 ? (
                            <button
                              type="button"
                              class="source-action-btn source-action-danger"
                              data-action="delete-syllabus-module"
                              data-module-id={modId}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <ol class="structure-step-list">
                        {actIds.map((actId, aIdx) => {
                          const rawAct = actById.get(actId);
                          if (!rawAct) return null;
                          const actTitle = String(rawAct["title"] ?? actId);
                          const actType = String(rawAct["type"] ?? "theory");
                          const actMins = activityMinutesOfRaw(rawAct);
                          return (
                            <li key={actId} class="structure-step-row" data-structure-activity-id={actId}>
                              <span class="structure-step-label">
                                {actTitle} <span class="row-meta">({humanize(actType)} · {actMins}m)</span>
                              </span>
                              <div class="row-actions">
                                {aIdx > 0 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn"
                                    data-action="move-syllabus-activity"
                                    data-module-id={modId}
                                    data-activity-id={actId}
                                    data-direction="up"
                                    aria-label={`Move ${actTitle} up`}
                                  >
                                    ↑
                                  </button>
                                ) : null}
                                {aIdx < actIds.length - 1 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn"
                                    data-action="move-syllabus-activity"
                                    data-module-id={modId}
                                    data-activity-id={actId}
                                    data-direction="down"
                                    aria-label={`Move ${actTitle} down`}
                                  >
                                    ↓
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  class="source-action-btn"
                                  data-action="open-syllabus-editor"
                                  data-syllabus-edit-mode="edit-activity"
                                  data-module-id={modId}
                                  data-activity-id={actId}
                                >
                                  Edit
                                </button>
                                {actIds.length > 1 ? (
                                  <button
                                    type="button"
                                    class="source-action-btn source-action-danger"
                                    data-action="delete-syllabus-activity"
                                    data-activity-id={actId}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        ) : null}

        {mode === "add-module" || mode === "edit-module" ? (
          <form class="syllabus-editor-form" data-action="save-syllabus-module" novalidate>
            <input
              type="hidden"
              name="moduleId"
              value={mode === "edit-module" ? activeModId : ""}
            />
            <label class="field" for="syllabus-module-title">
              <span>Unit title</span>
              <span class="field-hint">Clear capability milestone for this unit.</span>
              <input
                id="syllabus-module-title"
                type="text"
                name="title"
                value={mode === "edit-module" && activeMod ? String(activeMod["title"] ?? "") : ""}
                placeholder="e.g., Retrieval Indexing & Hybrid Reranking"
                required
              />
            </label>
            <label class="field" for="syllabus-module-summary">
              <span>Unit summary</span>
              <textarea
                id="syllabus-module-summary"
                name="summary"
                rows={2}
                value={mode === "edit-module" && activeMod ? String(activeMod["summary"] ?? "") : ""}
                placeholder="What this unit covers and how mastery is verified."
              />
            </label>
            <label class="field" for="syllabus-module-req">
              <span>Requirement level</span>
              <select id="syllabus-module-req" name="requirementLevel">
                <option
                  value="required"
                  selected={mode !== "edit-module" || activeMod?.["requirement_level"] !== "optional"}
                >
                  Required core unit
                </option>
                <option
                  value="optional"
                  selected={mode === "edit-module" && activeMod?.["requirement_level"] === "optional"}
                >
                  Optional enrichment unit
                </option>
              </select>
            </label>
            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-syllabus-editor"
                data-syllabus-edit-mode="syllabus"
              >
                Back to overview
              </button>
              <button type="submit" class="btn-primary">
                {mode === "edit-module" ? "Save unit" : "Add unit"}
              </button>
            </footer>
          </form>
        ) : null}

        {mode === "add-activity" || mode === "edit-activity" ? (
          <form class="syllabus-editor-form" data-action="save-syllabus-activity" novalidate>
            <input
              type="hidden"
              name="activityId"
              value={mode === "edit-activity" && activeAct ? String(activeAct["activity_id"] ?? "") : ""}
            />
            <label class="field" for="syllabus-activity-module">
              <span>Target unit</span>
              <select id="syllabus-activity-module" name="moduleId">
                {rawModules.map((mod, idx) => {
                  const mId = String(mod["module_id"] ?? "");
                  return (
                    <option key={mId} value={mId} selected={mId === activeModId}>
                      U{idx + 1} · {displayUnitTitle(String(mod["title"] ?? mId))}
                    </option>
                  );
                })}
              </select>
            </label>
            <label class="field" for="syllabus-activity-title">
              <span>Step title</span>
              <span class="field-hint">Actionable study task, lab, or checkpoint title.</span>
              <input
                id="syllabus-activity-title"
                type="text"
                name="title"
                value={mode === "edit-activity" && activeAct ? String(activeAct["title"] ?? "") : ""}
                placeholder="e.g., Worked Example: Hybrid BM25 + Dense Reciprocal Rank Fusion"
                required
              />
            </label>
            <div class="syllabus-editor-row-grid">
              <label class="field" for="syllabus-activity-type">
                <span>Step type</span>
                <select id="syllabus-activity-type" name="activityType">
                  {EDITABLE_ACTIVITY_TYPES.map((t) => (
                    <option
                      key={t}
                      value={t}
                      selected={
                        mode === "edit-activity" && activeAct
                          ? activeAct["type"] === t
                          : t === "worked_example"
                      }
                    >
                      {ACTIVITY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field" for="syllabus-activity-minutes">
                <span>Estimated minutes</span>
                <input
                  id="syllabus-activity-minutes"
                  type="number"
                  name="durationMinutes"
                  min={5}
                  max={240}
                  value={String(mode === "edit-activity" && activeAct ? activityMinutesOfRaw(activeAct) : 25)}
                  required
                />
              </label>
              <label class="field" for="syllabus-activity-req">
                <span>Requirement</span>
                <select id="syllabus-activity-req" name="requirementLevel">
                  <option
                    value="required"
                    selected={mode !== "edit-activity" || activeAct?.["requirement_level"] !== "optional"}
                  >
                    Required
                  </option>
                  <option
                    value="optional"
                    selected={mode === "edit-activity" && activeAct?.["requirement_level"] === "optional"}
                  >
                    Optional enrichment
                  </option>
                </select>
              </label>
            </div>
            <label class="field" for="syllabus-activity-prompt">
              <span>Study focus or verification prompt</span>
              <textarea
                id="syllabus-activity-prompt"
                name="prompt"
                rows={2}
                value={mode === "edit-activity" && activeAct ? activityPromptOfRaw(activeAct) : ""}
                placeholder="What to derive, implement, or verify during this step."
              />
            </label>
            <footer class="dialog-footer">
              <button
                type="button"
                class="btn-secondary"
                data-action="open-syllabus-editor"
                data-syllabus-edit-mode="syllabus"
              >
                Back to overview
              </button>
              <button type="submit" class="btn-primary">
                {mode === "edit-activity" ? "Save step" : "Add step"}
              </button>
            </footer>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
