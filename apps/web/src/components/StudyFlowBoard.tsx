import type { VNode } from "preact";
import type { PlanMapAndOutlineModel } from "../../../../packages/ui/src/index.ts";
import { ArrowSvg, ConnectorSvg, FlowKey, StatusGlyph, UnitMarker, type GlyphTone, type SegmentStyle } from "./Icons.tsx";
import { MathText } from "./MathText.tsx";

export const FLOW_ORDERS = ["theory_first", "application_first", "balanced"] as const;
export const DEEP_DIVE_MODES = ["included", "skipped"] as const;
export const SPACED_REVIEW_MODES = ["included", "compact"] as const;
export type FlowOrder = (typeof FLOW_ORDERS)[number];
export type DeepDiveMode = (typeof DEEP_DIVE_MODES)[number];
export type SpacedReviewMode = (typeof SPACED_REVIEW_MODES)[number];

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

export type StudyModule = PlanMapAndOutlineModel["outlineModules"][number];
export type StudyActivity = StudyModule["activities"][number];
export type RightsBadge = StudyActivity["resourceProvenanceCards"][number]["rightsBadge"];
export type FlowTrackId = "lecture" | "deep_dive" | "code" | "review" | "gate";

export const TRACK_OF_TYPE: Readonly<Record<StudyActivity["type"], FlowTrackId>> = {
  theory: "lecture",
  worked_example: "deep_dive",
  reflection: "deep_dive",
  coding: "code",
  project: "code",
  review: "review",
  quiz: "gate",
};

export const TRACK_LABELS: Readonly<Record<FlowTrackId, { readonly column: string; readonly badge: string }>> = {
  lecture: { column: "Lecture", badge: "Lecture" },
  deep_dive: { column: "Deep Dive", badge: "Deep Dive" },
  code: { column: "Code", badge: "Code Lab" },
  review: { column: "Review", badge: "Spaced Review" },
  gate: { column: "Gate", badge: "Gate" },
};

export const FLOW_ORDER_OPTIONS: Readonly<Record<FlowOrder, { readonly label: string; readonly tracks: readonly FlowTrackId[] }>> = {
  theory_first: { label: "Theory", tracks: ["lecture", "deep_dive", "code"] },
  application_first: { label: "Code first", tracks: ["code", "lecture", "deep_dive"] },
  balanced: { label: "Balanced", tracks: ["lecture", "code", "deep_dive"] },
};

export interface FlowView {
  readonly order: FlowOrder;
  readonly deepDive: DeepDiveMode;
  readonly spacedReview: SpacedReviewMode;
}

export function plannedFlowOrder(syllabus: Record<string, unknown>): FlowOrder {
  const applied = syllabus["sequence_preference_applied"];
  return isOneOf(FLOW_ORDERS, applied) ? applied : "theory_first";
}

export const trackOf = (activity: StudyActivity): FlowTrackId =>
  activity.masteryGated ? "gate" : TRACK_OF_TYPE[activity.type];

export function flowColumns(view: FlowView): readonly FlowTrackId[] {
  const tracks = FLOW_ORDER_OPTIONS[view.order].tracks.filter(
    (track) => track !== "deep_dive" || view.deepDive === "included",
  );
  return [...tracks, ...(view.spacedReview === "included" ? ["review" as const] : []), "gate"];
}

export function humanize(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const fit = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export const rightsWords = (badge: RightsBadge): string =>
  `${humanize(badge.basis)}${badge.externalLinkOnly ? " (external link only)" : ""}`;

export const isClosed = (status: string): boolean =>
  status === "completed" || status === "self_reported_completed" || status === "waived";

export function executionTone(status: string): GlyphTone {
  if (isClosed(status)) return "done";
  return status === "in_progress" ? "doing" : "todo";
}

export function executionWords(status: string): string {
  if (status === "self_reported_completed") return "Self-reported completed";
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  if (status === "waived") return "Waived by reviewed evidence";
  return "Not started";
}

export const effortWords = ({ min, point, max }: { readonly min: number; readonly point: number; readonly max: number }): string =>
  min === max ? `${point} min` : `${point} min (${min}–${max} min)`;

export interface UnitProgress {
  readonly done: number;
  readonly total: number;
  readonly left: number;
  readonly started: boolean;
}

export function unitProgress(activities: readonly StudyActivity[]): UnitProgress {
  const required = activities.filter((activity) => activity.required);
  const open = required.filter((activity) => !isClosed(activity.executionStatus));
  return {
    done: required.length - open.length,
    total: required.length,
    left: open.reduce((sum, activity) => sum + activity.durationTriplet.point, 0),
    started: activities.some((activity) => activity.executionStatus !== "not_started"),
  };
}

export function unitTone(progress: UnitProgress): GlyphTone {
  if (progress.total > 0 && progress.done === progress.total) return "done";
  return progress.started ? "doing" : "todo";
}

export function progressLabel(progress: UnitProgress): string {
  if (progress.total === 0) return "Optional only";
  return progress.left > 0 ? `${progress.done}/${progress.total} · ${progress.left}m` : `${progress.done}/${progress.total}`;
}

export interface GateStatus {
  readonly passed: boolean;
  readonly demonstrated: number;
  readonly total: number;
}

export function gateStatus(statuses: readonly string[]): GateStatus {
  const demonstrated = statuses.filter((status) => status === "demonstrated").length;
  return { passed: statuses.length > 0 && demonstrated === statuses.length, demonstrated, total: statuses.length };
}

export const gateCriteria = (gate: GateStatus): string =>
  gate.total === 0
    ? "No objectives mapped"
    : `${gate.passed ? "Passed" : "Not passed"} · ${gate.demonstrated} of ${gate.total} objective${gate.total === 1 ? "" : "s"} demonstrated`;

export const gateActivities = (mod: StudyModule): readonly StudyActivity[] =>
  mod.activities.filter((activity) => trackOf(activity) === "gate");

export function unitGate(mod: StudyModule): GateStatus {
  const gates = gateActivities(mod);
  return gates.length > 0
    ? gateStatus(gates.flatMap((activity) => activity.objectiveProficiencyBadges.map((badge) => badge.status)))
    : gateStatus(mod.objectives.map((objective) => objective.proficiencyStatus));
}

export const displayUnitTitle = (title: string): string => title.replace(/^Module\s+\d+\s*:\s*/, "");

export function ActivityGlyph({ activity, size }: { readonly activity: StudyActivity; readonly size: number }): VNode {
  return trackOf(activity) === "gate" ? (
    <StatusGlyph
      type="gate"
      tone={gateStatus(activity.objectiveProficiencyBadges.map((badge) => badge.status)).passed ? "done" : "todo"}
      size={size}
    />
  ) : (
    <StatusGlyph type="module" tone={executionTone(activity.executionStatus)} size={size} />
  );
}

export function CheckButton({ activity, className }: { readonly activity: StudyActivity; readonly className: string }): VNode {
  const done = activity.executionStatus === "completed" || activity.executionStatus === "self_reported_completed";
  return (
    <button
      type="button"
      class={className}
      data-action="complete-activity"
      data-activity-id={activity.activityId}
      data-module-id={activity.moduleId}
      data-event-id={`evt-complete-${activity.activityId}`}
      aria-pressed={done}
    >
      <StatusGlyph type="module" tone={executionTone(activity.executionStatus)} size={20} />
      <span class="st-sr">
        {done ? "Self-reported completed" : "Mark self-reported completed"}: {activity.title}
      </span>
    </button>
  );
}

export function NodeCard({
  activity,
  selectedActivityId,
  nextUpActivityId,
}: {
  readonly activity: StudyActivity;
  readonly selectedActivityId: string | null;
  readonly nextUpActivityId?: string | null | undefined;
}): VNode {
  const selected = activity.activityId === selectedActivityId;
  const isNextUp = Boolean(nextUpActivityId && activity.activityId === nextUpActivityId);
  const { min, point, max } = activity.durationTriplet;
  return (
    <article
      class="node-card"
      data-activity-id={activity.activityId}
      data-execution-status={activity.executionStatus}
      data-module-id={activity.moduleId}
      data-track={trackOf(activity)}
      data-required={String(activity.required)}
      data-selected={String(selected)}
      data-open={String(selected)}
      data-proficiency-status={activity.objectiveProficiencyStatus}
      data-mastery-gated={String(activity.masteryGated)}
      data-next-up={isNextUp ? "true" : undefined}
    >
      <button
        type="button"
        class="node-open"
        data-action="select-outline-activity"
        data-activity-id={activity.activityId}
        data-module-id={activity.moduleId}
        aria-pressed={selected}
      >
        <span class="node-title">
          <MathText text={activity.title} />
        </span>
        <span class="node-foot">
          <span class="node-duration">{point}m</span>
          {activity.required ? null : <span class="node-optional">Optional</span>}
        </span>
        <span class="st-sr">
          {executionWords(activity.executionStatus)}. {activity.required ? "Required" : "Optional"}. About {point} minutes, range {min} to {max}. Objective proficiency: {humanize(activity.objectiveProficiencyStatus)}.
        </span>
      </button>
      <CheckButton activity={activity} className="node-check" />
    </article>
  );
}

export function GateDiamond({
  mod,
  gate,
  selectedActivityId,
  nextUpActivityId,
  nextUnitNumber,
}: {
  readonly mod: StudyModule;
  readonly gate: StudyActivity | null;
  readonly selectedActivityId: string | null;
  readonly nextUpActivityId?: string | null | undefined;
  readonly nextUnitNumber?: number | undefined;
}): VNode {
  const status = gate
    ? gateStatus(gate.objectiveProficiencyBadges.map((badge) => badge.status))
    : gateStatus(mod.objectives.map((objective) => objective.proficiencyStatus));
  const selected = gate !== null && gate.activityId === selectedActivityId;
  const isNextUp = Boolean(gate && nextUpActivityId && gate.activityId === nextUpActivityId);
  return (
    <button
      type="button"
      class="gate-diamond"
      data-action={gate ? "select-outline-activity" : "select-outline-module"}
      data-activity-id={gate ? gate.activityId : undefined}
      data-module-id={mod.moduleId}
      aria-pressed={gate ? selected : undefined}
      data-status={status.passed ? "passed" : "open"}
      data-next-up={isNextUp ? "true" : undefined}
    >
      <svg class="gate-shape" viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
        <rect x="14" y="14" width="56" height="56" rx="8" transform="rotate(45 42 42)" />
        {status.passed ? <path d="M31 43 39 51 54 34" /> : null}
      </svg>
      <span class="st-sr">Gate. </span>
      <span class="gate-title">
        <MathText text={gate ? gate.title : "Objective check"} />
      </span>
      <span class="gate-criteria">
        {gateCriteria(status)}
        {gate ? ` · ${gate.durationTriplet.point}m` : ""}
      </span>
      {nextUnitNumber !== undefined ? (
        <span class="gate-unlocks-badge" data-unlocked={String(status.passed)}>
          {status.passed ? `↓ Unlocks U${nextUnitNumber}` : `↓ Locks U${nextUnitNumber}`}
        </span>
      ) : null}
    </button>
  );
}

export interface UnitPlacement {
  readonly mod: StudyModule;
  readonly cells: ReadonlyMap<FlowTrackId, readonly StudyActivity[]>;
  readonly hidden: readonly StudyActivity[];
  readonly postGate: ReadonlySet<string>;
}

export function postGateIds(mod: StudyModule): ReadonlySet<string> {
  const gateIds = new Set(gateActivities(mod).map((activity) => activity.activityId));
  const postGate = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const activity of mod.activities) {
      if (gateIds.has(activity.activityId) || postGate.has(activity.activityId)) continue;
      if (activity.prerequisiteActivityIds.some((id) => gateIds.has(id) || postGate.has(id))) {
        postGate.add(activity.activityId);
        grew = true;
      }
    }
  }
  return postGate;
}

export function placeUnit(mod: StudyModule, view: FlowView): UnitPlacement {
  const postGate = postGateIds(mod);
  const cells = new Map<FlowTrackId, StudyActivity[]>();
  const hidden: StudyActivity[] = [];
  const ordered = [...mod.activities].sort((a, b) => Number(postGate.has(a.activityId)) - Number(postGate.has(b.activityId)));
  for (const activity of ordered) {
    const own = trackOf(activity);
    const skipDeepDive = own === "deep_dive" && view.deepDive === "skipped";
    if (skipDeepDive && !activity.required) {
      hidden.push(activity);
      continue;
    }
    const column: FlowTrackId = skipDeepDive ? "lecture" : own === "review" && view.spacedReview === "compact" ? "gate" : own;
    cells.set(column, [...(cells.get(column) ?? []), activity]);
  }
  return { mod, cells, hidden, postGate };
}

export function UnitRow({
  units,
  index,
  columns,
  selectedModuleId,
  selectedActivityId,
  nextUpActivityId,
}: {
  readonly units: readonly UnitPlacement[];
  readonly index: number;
  readonly columns: readonly FlowTrackId[];
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
  readonly nextUpActivityId?: string | null | undefined;
}): VNode | null {
  const unit = units[index];
  if (!unit) return null;
  const { mod, cells } = unit;
  const selected = mod.moduleId === selectedModuleId;
  const progress = unitProgress(mod.activities);
  const tone = unitTone(progress);
  const previous = units[index - 1];
  const prevGatePassed = previous ? unitGate(previous.mod).passed : true;
  const currentGatePassed = unitGate(mod).passed;
  const spineIn = previous ? (prevGatePassed || unitTone(unitProgress(previous.mod.activities)) === "done" ? "done" : "todo") : "none";
  const spineOut = index < units.length - 1 ? (currentGatePassed || tone === "done" ? "done" : "todo") : "none";
  const nextUnitNumber = index < units.length - 1 ? index + 2 : undefined;
  const onChain = (activity: StudyActivity): boolean => trackOf(activity) !== "review";

  const chain = columns.flatMap((track, column) =>
    track === "gate" || (cells.get(track) ?? []).some(onChain) ? [column] : [],
  );
  const optionalAt = (column: number): boolean => {
    const items = (cells.get(columns[column] ?? "gate") ?? []).filter(
      (activity) => onChain(activity) || trackOf(activity) === "gate",
    );
    return items.length > 0 && items.every((activity) => !activity.required);
  };
  const segments = new Map<number, VNode[]>();
  const crossed = new Set<number>();
  const addSegment = (column: number, svg: VNode) => segments.set(column, [...(segments.get(column) ?? []), svg]);
  const firstChainCol = chain[0];
  const leadStyle: SegmentStyle = firstChainCol !== undefined && optionalAt(firstChainCol) ? "dashed" : "solid";
  if (firstChainCol !== undefined) {
    for (let column = 0; column < firstChainCol; column++) {
      addSegment(column, <ConnectorSvg kind="lead-through" style={leadStyle} />);
      crossed.add(column);
    }
    addSegment(firstChainCol, <ConnectorSvg kind="lead-in" style={leadStyle} />);
  }
  chain.forEach((to, k) => {
    const from = chain[k - 1];
    if (from === undefined) return;
    const style: SegmentStyle = optionalAt(from) || optionalAt(to) ? "dashed" : "solid";
    addSegment(from, <ConnectorSvg kind="out" style={style} />);
    for (let column = from + 1; column < to; column++) {
      addSegment(column, <ConnectorSvg kind="through" style={style} />);
      crossed.add(column);
    }
    addSegment(to, <ConnectorSvg kind="in" style={style} />);
  });

  return (
    <tr
      class={`study-card outline-module-card${selected ? " is-selected" : ""}`}
      data-module-id={mod.moduleId}
      data-selected={String(selected)}
      data-opaque-surface="true"
      data-unit-status={tone}
    >
      <th class="flow-rail" scope="row" data-spine-in={spineIn} data-spine-out={spineOut}>
        {index > 0 ? (
          <svg class="spine-head" viewBox="0 0 10 8" width="10" height="8" aria-hidden="true">
            <path class="arrow-head" d="M1 0 L9 0 L5 7.5 Z" />
          </svg>
        ) : null}
        <button
          type="button"
          class="unit-hit"
          data-action="select-outline-module"
          data-module-id={mod.moduleId}
          aria-pressed={selected}
        >
          <UnitMarker tone={tone} />
          <span class="unit-head-row">
            <span class="unit-badge">U{index + 1}</span>
            {previous ? (
              <span class="unit-prereq-pill" data-met={String(prevGatePassed)}>
                {prevGatePassed ? `✓ U${index} Gate` : `Requires U${index}`}
              </span>
            ) : null}
          </span>
          <span class="unit-title">
            <MathText text={displayUnitTitle(mod.title)} />
          </span>
          <span class="unit-meta">{progressLabel(progress)}</span>
          <span class="st-sr">
            {selected ? "Selected" : "Select"} unit {index + 1}. {progress.done} of {progress.total} required activities done. {mod.required ? "Required" : "Optional"}. {mod.summary}
          </span>
        </button>
        {firstChainCol !== undefined ? <ConnectorSvg kind="unit-out" style={leadStyle} /> : null}
      </th>
      {columns.map((track, column) => {
        const items = cells.get(track) ?? [];
        const gates = items.filter((activity) => trackOf(activity) === "gate");
        const cards = items.filter((activity) => trackOf(activity) !== "gate");
        const isEmpty = track !== "gate" && items.length === 0;
        const isCrossed = track !== "gate" && !isEmpty && crossed.has(column);
        return (
          <td
            key={track}
            class="flow-cell"
            data-track={track}
            data-empty={isEmpty ? "true" : undefined}
            data-crossed={isCrossed ? "true" : undefined}
          >
            {segments.get(column) ?? null}
            {track === "gate"
              ? gates.length > 0
                ? gates.map((gate) => (
                    <GateDiamond
                      key={gate.activityId}
                      mod={mod}
                      gate={gate}
                      selectedActivityId={selectedActivityId}
                      nextUpActivityId={nextUpActivityId}
                      nextUnitNumber={nextUnitNumber}
                    />
                  ))
                : <GateDiamond mod={mod} gate={null} selectedActivityId={selectedActivityId} nextUpActivityId={nextUpActivityId} nextUnitNumber={nextUnitNumber} />
              : null}
            {cards.map((activity) => (
              <NodeCard
                key={activity.activityId}
                activity={activity}
                selectedActivityId={selectedActivityId}
                nextUpActivityId={nextUpActivityId}
              />
            ))}
          </td>
        );
      })}
    </tr>
  );
}

export function FlowToolbar({ idPrefix, view }: { readonly idPrefix: string; readonly view: FlowView }): VNode {
  const deepOn = view.deepDive === "included";
  const reviewOn = view.spacedReview === "included";
  return (
    <div class="flow-toolbar" role="group" aria-label="Flowchart layout">
      <div class="segmented" role="group" aria-label="Flow order">
        {FLOW_ORDERS.map((order) => (
          <button
            key={order}
            type="button"
            class="seg-btn"
            data-action="set-flow-order"
            data-flow-order={order}
            aria-pressed={order === view.order}
          >
            {FLOW_ORDER_OPTIONS[order].label}
          </button>
        ))}
      </div>
      <button
        type="button"
        id={`${idPrefix}-deep-dive`}
        class="flow-switch"
        role="switch"
        aria-checked={deepOn}
        data-action="set-deep-dive"
        data-deep-dive={deepOn ? "skipped" : "included"}
      >
        Deep Dive
        <span class="switch-track" aria-hidden="true" />
      </button>
      <button
        type="button"
        id={`${idPrefix}-spaced-review`}
        class="flow-switch"
        role="switch"
        aria-checked={reviewOn}
        data-action="set-spaced-review"
        data-spaced-review={reviewOn ? "compact" : "included"}
      >
        Review
        <span class="switch-track" aria-hidden="true" />
      </button>
    </div>
  );
}

export function StudyFlowBoard({
  idPrefix,
  modules,
  selectedModuleId,
  selectedActivityId,
  view,
  nextUpActivityId,
}: {
  readonly idPrefix: string;
  readonly modules: readonly StudyModule[];
  readonly selectedModuleId: string | null;
  readonly selectedActivityId: string | null;
  readonly view: FlowView;
  readonly nextUpActivityId?: string | null | undefined;
}): VNode {
  const units = modules.map((mod) => placeUnit(mod, view));
  const columns = flowColumns(view).filter(
    (track) => track === "gate" || units.some((unit) => (unit.cells.get(track) ?? []).length > 0),
  );
  const hidden = units.flatMap((unit) => unit.hidden);
  const hiddenMinutes = hidden.reduce((sum, activity) => sum + activity.durationTriplet.point, 0);
  const note =
    view.deepDive !== "skipped"
      ? ""
      : hidden.length > 0
        ? `Deep Dive off hides ${hidden.length} optional deep dive${hidden.length === 1 ? "" : "s"} (${hiddenMinutes} min). Required deep dives stay in the Lecture column.`
        : "No optional deep dives to hide. Required deep dives stay in the Lecture column.";

  return (
    <section
      class="flow-board"
      aria-labelledby={`${idPrefix}-title`}
      data-flow-order={view.order}
      data-deep-dive={view.deepDive}
      data-spaced-review={view.spacedReview}
    >
      <div class="flow-head">
        <h2 id={`${idPrefix}-title`}>Study flow</h2>
        <FlowToolbar idPrefix={idPrefix} view={view} />
      </div>
      {note ? <p class="flow-note">{note}</p> : null}
      <div class="matrix-stage">
        <table class="matrix-table" aria-labelledby={`${idPrefix}-title`} style={`--tracks: ${columns.length - 1}`}>
          <colgroup>
            <col class="col-rail" />
            {columns.map((track) => (
              <col key={track} class="col-track" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="flow-colhead">
                <span class="colhead-title">Unit</span>
                <span class="colhead-meta">{units.length} in order</span>
              </th>
              {columns.map((track) => {
                if (track === "gate") {
                  const passed = modules.filter((mod) => unitGate(mod).passed).length;
                  return (
                    <th key="gate" scope="col" class="flow-colhead" data-track="gate">
                      <span class="colhead-title">Gate</span>
                      <span class="colhead-meta">
                        {passed}/{modules.length} passed
                      </span>
                    </th>
                  );
                }
                const inColumn = units.flatMap((unit) => unit.cells.get(track) ?? []);
                return (
                  <th key={track} scope="col" class="flow-colhead" data-track={track}>
                    <span class="colhead-title">{TRACK_LABELS[track].column}</span>
                    <span class="colhead-meta">{progressLabel(unitProgress(inColumn))}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => (
              <UnitRow
                key={unit.mod.moduleId}
                units={units}
                index={index}
                columns={columns}
                selectedModuleId={selectedModuleId}
                selectedActivityId={selectedActivityId}
                nextUpActivityId={nextUpActivityId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <FlowKey />
    </section>
  );
}

export function MacroStage({
  modules,
  selectedModuleId,
}: {
  readonly modules: readonly StudyModule[];
  readonly selectedModuleId: string | null;
}): VNode {
  return (
    <ol class="macro-stage" aria-label="Units in study order">
      {modules.map((mod, index) => {
        const progress = unitProgress(mod.activities);
        const tone = unitTone(progress);
        const gate = unitGate(mod);
        const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
        return (
          <li key={mod.moduleId} class="macro-step">
            <button
              type="button"
              class="macro-node"
              data-action="select-outline-module"
              data-module-id={mod.moduleId}
              data-status={tone}
              aria-pressed={mod.moduleId === selectedModuleId}
            >
              <span class="macro-top">
                <UnitMarker tone={tone} size={20} />
                <span class="unit-badge">U{index + 1}</span>
                <span class="macro-meta">{progressLabel(progress)}</span>
              </span>
              <span class="macro-title">{displayUnitTitle(mod.title)}</span>
              <span class="macro-bar" aria-hidden="true">
                <span style={`width: ${percent}%`} />
              </span>
              <span class="st-sr">
                {progress.done} of {progress.total} required activities done. Gate {gate.passed ? "passed" : "not passed"}.
              </span>
            </button>
            <ArrowSvg className="macro-link" />
            <span class="macro-gate" data-status={gate.passed ? "passed" : "open"} aria-hidden="true">
              <StatusGlyph type="gate" tone={gate.passed ? "done" : "todo"} size={24} />
            </span>
            {index < modules.length - 1 ? <ArrowSvg className="macro-link" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function StepRow({
  activity,
  selectedActivityId,
  note,
  reviewSeparationValid,
}: {
  readonly activity: StudyActivity;
  readonly selectedActivityId: string | null;
  readonly note: string;
  readonly reviewSeparationValid?: boolean | undefined;
}): VNode {
  const selected = activity.activityId === selectedActivityId;
  const track = trackOf(activity);
  return (
    <li
      class="today-activity-item step-row"
      data-activity-id={activity.activityId}
      data-execution-status={activity.executionStatus}
      data-proficiency-status={activity.objectiveProficiencyStatus}
      data-selected={String(selected)}
      data-review-separation-valid={reviewSeparationValid !== undefined ? String(reviewSeparationValid) : undefined}
    >
      {track === "gate" ? (
        <span class="step-check">
          <StatusGlyph
            type="gate"
            tone={gateStatus(activity.objectiveProficiencyBadges.map((badge) => badge.status)).passed ? "done" : "todo"}
            size={20}
          />
        </span>
      ) : (
        <CheckButton activity={activity} className="step-check" />
      )}
      <button
        type="button"
        class="step-open"
        data-action="select-outline-activity"
        data-activity-id={activity.activityId}
        data-module-id={activity.moduleId}
        aria-pressed={selected}
      >
        <span class="step-title">
          <MathText text={activity.title} />
        </span>
        <span class="step-meta">
          {TRACK_LABELS[track].badge} · {activity.durationTriplet.point}m{activity.required ? "" : " · Optional"}
        </span>
      </button>
      <span class="st-sr">{note}</span>
    </li>
  );
}
