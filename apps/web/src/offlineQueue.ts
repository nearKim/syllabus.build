import { buildOperationHeaders } from "@syllabus/api-client";
import { renderUntrustedCatalogText } from "@syllabus/ui";
import { sanitizeId } from "./shared.ts";

export type OfflineProgressEventType =
  | "started" | "viewed" | "self_reported_completed" | "self_reported_reopened"
  | "self_reported_skipped" | "time_reported" | "note_added"
  | "prerequisite_override_recorded" | "unverified_prerequisite_acknowledged";

export interface OfflineProgressEventPayload {
  readonly event_id: string; readonly syllabus_revision_id: string; readonly activity_id: string;
  readonly type: OfflineProgressEventType; readonly occurred_at: string; readonly client_timezone: string;
  readonly note: string | null; readonly time_spent_minutes: number | null;
}

export interface OfflineEnqueueResult {
  readonly accepted: boolean; readonly deduplicated: boolean;
  readonly rejectedReason:
    | null | "missing_event_id" | "queue_capacity_exceeded"
    | "forbidden_byok_credential" | "forbidden_assessment_answer_key" | "forbidden_unapproved_full_text";
  readonly eventId: string | null; readonly queueSize: number; readonly maxCapacity: number;
  readonly pendingSynchronizationVisible: boolean;
}

export interface OfflineReplayRequestDescriptor {
  readonly operationId: "appendProgressEvent"; readonly method: "POST"; readonly path: string;
  readonly headers: Record<string, string>; readonly body: OfflineProgressEventPayload;
}

const FORBIDDEN_BYOK_KEYS = new Set(["api_key", "apiKey", "raw_api_key", "rawApiKey", "secret_key", "auth_secret", "bearer_token", "provider_secret"]);
const FORBIDDEN_ASSESSMENT_KEYS = new Set(["answer_key", "answerKey", "scoring_rubric", "scoringRubric", "private_solution", "privateSolution", "unrevealed_solution", "hidden_tests"]);
const FORBIDDEN_FULL_TEXT_KEYS = new Set(["unapproved_full_text", "unapprovedFullText", "full_text_body", "raw_source_body", "restricted_full_text", "full_text"]);
const SECRET_KEY_VALUE_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/;

function detectForbiddenOfflineCacheContent(
  obj: Record<string, unknown>,
): null | "forbidden_byok_credential" | "forbidden_assessment_answer_key" | "forbidden_unapproved_full_text" {
  const stack: unknown[] = [obj];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      if (typeof current === "string" && SECRET_KEY_VALUE_RE.test(current)) return "forbidden_byok_credential";
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_BYOK_KEYS.has(k)) return "forbidden_byok_credential";
      if (FORBIDDEN_ASSESSMENT_KEYS.has(k)) return "forbidden_assessment_answer_key";
      if (FORBIDDEN_FULL_TEXT_KEYS.has(k)) return "forbidden_unapproved_full_text";
      if (typeof v === "string" && SECRET_KEY_VALUE_RE.test(v)) return "forbidden_byok_credential";
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

export function createBoundedOfflineQueue(options?: {
  readonly accountId?: string | null; readonly syllabusId?: string; readonly maxCapacity?: number;
}) {
  let accountId: string | null = options?.accountId ?? "synthetic-account";
  const syllabusId = options?.syllabusId ?? "synthetic-syllabus-1";
  const maxCapacity = options?.maxCapacity ?? 100;

  const queuedById = new Map<string, OfflineProgressEventPayload>();
  const syncedEventIds = new Set<string>();
  let rejectedCount = 0;

  const makeEnqueueResult = (
    accepted: boolean, deduplicated: boolean, rejectedReason: OfflineEnqueueResult["rejectedReason"], eventId: string | null,
  ): OfflineEnqueueResult => ({
    accepted, deduplicated, rejectedReason, eventId,
    queueSize: queuedById.size, maxCapacity, pendingSynchronizationVisible: queuedById.size > 0,
  });

  const getState = () => {
    const queuedEvents = Array.from(queuedById.values());
    return {
      accountId, syllabusId, maxCapacity, size: queuedEvents.length,
      queuedEvents: queuedEvents as readonly OfflineProgressEventPayload[],
      syncedEventIds: Array.from(syncedEventIds) as readonly string[],
      rejectedCount, pendingSynchronizationVisible: queuedEvents.length > 0,
      cachesRawByokKeys: false as const, cachesAssessmentAnswerKeys: false as const, cachesUnapprovedFullText: false as const,
    };
  };

  function enqueue(rawEvent: Record<string, unknown>): OfflineEnqueueResult {
    const forbiddenReason = detectForbiddenOfflineCacheContent(rawEvent);
    if (forbiddenReason !== null) {
      rejectedCount += 1;
      return makeEnqueueResult(false, false, forbiddenReason, null);
    }

    const rawEventId = rawEvent["event_id"] ?? rawEvent["eventId"];
    const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
    if (!eventId) {
      rejectedCount += 1;
      return makeEnqueueResult(false, false, "missing_event_id", null);
    }
    if (queuedById.has(eventId) || syncedEventIds.has(eventId)) return makeEnqueueResult(true, true, null, eventId);
    if (queuedById.size >= maxCapacity) {
      rejectedCount += 1;
      return makeEnqueueResult(false, false, "queue_capacity_exceeded", eventId);
    }

    const rawNote = rawEvent["note"];
    const sanitizedNote = typeof rawNote === "string" ? renderUntrustedCatalogText(rawNote, { maxLength: 3000 }).text : null;
    if (sanitizedNote && SECRET_KEY_VALUE_RE.test(sanitizedNote)) {
      rejectedCount += 1;
      return makeEnqueueResult(false, false, "forbidden_byok_credential", null);
    }

    const rawTime = rawEvent["time_spent_minutes"] ?? rawEvent["timeSpentMinutes"];
    queuedById.set(eventId, {
      event_id: eventId,
      syllabus_revision_id: sanitizeId(rawEvent["syllabus_revision_id"] ?? rawEvent["syllabusRevisionId"], "synthetic-revision-1"),
      activity_id: sanitizeId(rawEvent["activity_id"] ?? rawEvent["activityId"], "activity-theory"),
      type: (rawEvent["type"] as OfflineProgressEventType) ?? "self_reported_completed",
      occurred_at: sanitizeId(rawEvent["occurred_at"] ?? rawEvent["occurredAt"], "2026-10-26T18:10:00-04:00"),
      client_timezone: sanitizeId(rawEvent["client_timezone"] ?? rawEvent["clientTimezone"], "America/New_York"),
      note: sanitizedNote,
      time_spent_minutes: typeof rawTime === "number" ? Number(rawTime) : 10,
    });

    return makeEnqueueResult(true, false, null, eventId);
  }

  function replayOnReconnect(dispatcher?: (req: OfflineReplayRequestDescriptor) => void | { readonly duplicate?: boolean }) {
    const requests: OfflineReplayRequestDescriptor[] = [];
    let replayedCount = 0;
    let deduplicatedSkipCount = 0;

    for (const [eventId, payload] of Array.from(queuedById.entries())) {
      if (syncedEventIds.has(eventId)) {
        queuedById.delete(eventId);
        deduplicatedSkipCount += 1;
        continue;
      }
      const req: OfflineReplayRequestDescriptor = {
        operationId: "appendProgressEvent", method: "POST",
        path: `/syllabi/${syllabusId}/progress-events`,
        headers: buildOperationHeaders("appendProgressEvent"), body: payload,
      };
      const res = dispatcher?.(req);
      if (res && res.duplicate === true) deduplicatedSkipCount += 1;
      requests.push(req);
      syncedEventIds.add(eventId);
      queuedById.delete(eventId);
      replayedCount += 1;
    }

    return {
      replayedCount, deduplicatedSkipCount, remainingQueueSize: queuedById.size,
      syncedEventIds: Array.from(syncedEventIds) as readonly string[],
      requests: requests as readonly OfflineReplayRequestDescriptor[],
      pendingSynchronizationVisible: queuedById.size > 0,
    };
  }

  return {
    getState,
    enqueue,
    replayOnReconnect,
    flush: replayOnReconnect,
    purgeOnSignOut() {
      accountId = null;
      queuedById.clear();
      syncedEventIds.clear();
      return getState();
    },
    handleAccountSwitch(newAccountId: string | null) {
      if (newAccountId !== accountId) {
        queuedById.clear();
        syncedEventIds.clear();
      }
      accountId = newAccountId;
      return getState();
    },
  };
}
export type BoundedOfflineSyncQueue = ReturnType<typeof createBoundedOfflineQueue>;
export type BoundedOfflineSyncQueueState = ReturnType<BoundedOfflineSyncQueue["getState"]>;
export type OfflineReplaySummary = ReturnType<BoundedOfflineSyncQueue["replayOnReconnect"]>;
