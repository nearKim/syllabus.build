/**
 * Fail-closed `SafeActivityRenderer` (`NFR-002`, `@S11`, Section 14.5).
 *
 * Security & Rendering Policy:
 * 1. Unknown major curriculum schema versions (or unsupported pre-1.0 minor series)
 *    MUST fail closed: `SafeActivityRenderer` returns an explicit
 *    `unsupported_schema_version` compatibility state and a safe plain-text outline
 *    of module/activity titles, and never infers or renders unknown component structures.
 * 2. Only allowlisted activity types (`theory`, `worked_example`, `coding`, `quiz`,
 *    `review`, `reflection`, `project`) and safe URL schemes (`https:`, `mailto:`)
 *    are accepted.
 */

export const SUPPORTED_CURRICULUM_MAJOR_VERSION = 0 as const;
export const SUPPORTED_CURRICULUM_MINOR_VERSION = 2 as const;

export const ALLOWLISTED_ACTIVITY_TYPES = [
  "theory",
  "worked_example",
  "coding",
  "quiz",
  "review",
  "reflection",
  "project",
] as const;

export type AllowlistedActivityType = (typeof ALLOWLISTED_ACTIVITY_TYPES)[number];

export interface SafeOutlineItem {
  readonly id: string;
  readonly title: string;
}

export interface UnsupportedVersionCompatibilityView {
  readonly status: "unsupported_schema_version";
  readonly schemaVersion: string;
  readonly supportedMajorVersion: number;
  readonly supportedMinorVersion: number;
  readonly message: string;
  readonly safeTextOutline: readonly SafeOutlineItem[];
}

export interface RejectedPayloadView {
  readonly status: "rejected_unsafe_payload";
  readonly reason: string;
}

export interface ValidatedActivityNode {
  readonly activityId: string;
  readonly title: string;
  readonly activityType: AllowlistedActivityType;
  readonly masteryGated: boolean;
  readonly safeResourceUrls: readonly string[];
}

export interface SupportedCurriculumView {
  readonly status: "supported";
  readonly schemaVersion: string;
  readonly title: string;
  readonly activities: readonly ValidatedActivityNode[];
}

export type SafeRenderResult =
  | SupportedCurriculumView
  | UnsupportedVersionCompatibilityView
  | RejectedPayloadView;

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function isSafeResourceUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function sanitizePlainText(input: unknown, fallback: string): string {
  if (typeof input !== "string") {
    return fallback;
  }
  return input.replace(/[<>]/g, "").trim().slice(0, 240) || fallback;
}

function extractSafeTextOutline(rawDoc: Record<string, unknown>): SafeOutlineItem[] {
  const items: SafeOutlineItem[] = [];
  const modules = Array.isArray(rawDoc["modules"]) ? rawDoc["modules"] : [];
  for (const mod of modules) {
    if (mod && typeof mod === "object") {
      const m = mod as Record<string, unknown>;
      const id = sanitizePlainText(m["module_id"] ?? m["id"], "unknown-module");
      const title = sanitizePlainText(m["title"], "Untitled Module");
      items.push({ id, title });
    }
  }
  return items;
}

export function evaluateSafeCurriculumRender(input: unknown): SafeRenderResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      status: "rejected_unsafe_payload",
      reason: "Curriculum document must be a non-null JSON object.",
    };
  }

  const doc = input as Record<string, unknown>;
  const rawVersion = typeof doc["schema_version"] === "string" ? doc["schema_version"] : "";
  const match = SEMVER_RE.exec(rawVersion);

  if (!match) {
    return {
      status: "unsupported_schema_version",
      schemaVersion: rawVersion || "missing",
      supportedMajorVersion: SUPPORTED_CURRICULUM_MAJOR_VERSION,
      supportedMinorVersion: SUPPORTED_CURRICULUM_MINOR_VERSION,
      message: "Missing or malformed curriculum schema_version; failing closed.",
      safeTextOutline: extractSafeTextOutline(doc),
    };
  }

  const major = Number.parseInt(match[1] ?? "-1", 10);
  const minor = Number.parseInt(match[2] ?? "-1", 10);
  if (
    major !== SUPPORTED_CURRICULUM_MAJOR_VERSION ||
    minor !== SUPPORTED_CURRICULUM_MINOR_VERSION
  ) {
    return {
      status: "unsupported_schema_version",
      schemaVersion: rawVersion,
      supportedMajorVersion: SUPPORTED_CURRICULUM_MAJOR_VERSION,
      supportedMinorVersion: SUPPORTED_CURRICULUM_MINOR_VERSION,
      message: `Unsupported curriculum schema version ${rawVersion} (expected ${SUPPORTED_CURRICULUM_MAJOR_VERSION}.${SUPPORTED_CURRICULUM_MINOR_VERSION}.x). Failing closed and rendering safe text outline only.`,
      safeTextOutline: extractSafeTextOutline(doc),
    };
  }

  const rawActivities = doc["activities"];
  if (!Array.isArray(rawActivities) || rawActivities.length === 0 || rawActivities.length > 600) {
    return {
      status: "rejected_unsafe_payload",
      reason: "Activities array must be present and contain between 1 and 600 items.",
    };
  }

  const validatedActivities: ValidatedActivityNode[] = [];
  for (const rawAct of rawActivities) {
    if (!rawAct || typeof rawAct !== "object" || Array.isArray(rawAct)) {
      return {
        status: "rejected_unsafe_payload",
        reason: "Activity entry must be an object.",
      };
    }
    const act = rawAct as Record<string, unknown>;
    if ("script" in act || "raw_html" in act || "executable_code" in act || "html" in act) {
      return {
        status: "rejected_unsafe_payload",
        reason: "Executable or raw HTML fields are forbidden in activity payloads.",
      };
    }

    const actType = act["type"] ?? act["activity_type"];
    if (
      typeof actType !== "string" ||
      !(ALLOWLISTED_ACTIVITY_TYPES as readonly string[]).includes(actType)
    ) {
      return {
        status: "rejected_unsafe_payload",
        reason: `Unallowlisted activity type: ${String(actType)}`,
      };
    }

    const urls: string[] = [];
    if (typeof act["source_url"] === "string") {
      if (!isSafeResourceUrl(act["source_url"])) {
        return {
          status: "rejected_unsafe_payload",
          reason: `Unsafe resource URL scheme in activity ${String(act["activity_id"] ?? "")}`,
        };
      }
      urls.push(act["source_url"]);
    }

    validatedActivities.push({
      activityId: sanitizePlainText(act["activity_id"] ?? act["id"], "activity"),
      title: sanitizePlainText(act["title"], "Untitled Activity"),
      activityType: actType as AllowlistedActivityType,
      masteryGated: act["mastery_gated"] === true,
      safeResourceUrls: urls,
    });
  }

  const goalObj =
    doc["goal"] && typeof doc["goal"] === "object"
      ? (doc["goal"] as Record<string, unknown>)
      : {};

  return {
    status: "supported",
    schemaVersion: rawVersion,
    title: sanitizePlainText(goalObj["title"] ?? doc["title"], "Curriculum Plan"),
    activities: validatedActivities,
  };
}
