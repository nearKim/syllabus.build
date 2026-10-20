/**
 * Fail-closed `SafeActivityRenderer` & Untrusted Content Sanitizer
 * (`NFR-002`, `UI-010`, `UI-024`, `@S11`, `@S57`, `@S80`, `@S88`, Section 9.6, Section 9.12, Section 14.5).
 *
 * Security & Rendering Policy:
 * 1. Unknown major curriculum schema versions (or unsupported pre-1.0 minor series)
 *    MUST fail closed: `SafeActivityRenderer` returns an explicit
 *    `unsupported_schema_version` compatibility state with a compatibility alert banner
 *    and a safe plain-text outline of module/activity titles, and never infers or
 *    renders unknown component structures.
 * 2. Only allowlisted activity types (`theory`, `worked_example`, `coding`, `quiz`,
 *    `review`, `reflection`, `project`) and safe URL schemes (`https:`, `mailto:`)
 *    are accepted.
 * 3. Untrusted resource/catalog text and prompt-injection payloads are stripped of
 *    control characters, HTML/SVG/script markup, unsafe Markdown link schemes, and
 *    tool-invocation directives before rendering as inert text.
 * 4. Mathematical expressions are rendered through a semantic MathML + `aria-label`
 *    display model on an opaque study surface.
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

export type ReviewedActivityComponentName =
  | "TheoryStudyPanel"
  | "WorkedExampleWalkthrough"
  | "ExternalCodingTaskPanel"
  | "QuizAssessmentPanel"
  | "SpacedReviewPromptPanel"
  | "ReflectionPromptPanel"
  | "ProjectDeliverablePanel";

export interface ActivityComponentBlueprint {
  readonly activityType: AllowlistedActivityType;
  readonly componentName: ReviewedActivityComponentName;
  readonly surfaceKind: "reading" | "code" | "assessment";
  readonly opaqueSurfaceRequired: true;
  readonly requiresInitialAttemptBeforeSolution: boolean;
  readonly codingExecutionMode: "external_only" | "not_applicable";
  readonly allowsModelAuthoredHtmlOrSvg: false;
}

export const ACTIVITY_COMPONENT_BLUEPRINTS: Readonly<
  Record<AllowlistedActivityType, ActivityComponentBlueprint>
> = {
  theory: {
    activityType: "theory",
    componentName: "TheoryStudyPanel",
    surfaceKind: "reading",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: false,
    codingExecutionMode: "not_applicable",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  worked_example: {
    activityType: "worked_example",
    componentName: "WorkedExampleWalkthrough",
    surfaceKind: "reading",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: false,
    codingExecutionMode: "not_applicable",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  coding: {
    activityType: "coding",
    componentName: "ExternalCodingTaskPanel",
    surfaceKind: "code",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: false,
    codingExecutionMode: "external_only",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  quiz: {
    activityType: "quiz",
    componentName: "QuizAssessmentPanel",
    surfaceKind: "assessment",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: true,
    codingExecutionMode: "not_applicable",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  review: {
    activityType: "review",
    componentName: "SpacedReviewPromptPanel",
    surfaceKind: "assessment",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: true,
    codingExecutionMode: "not_applicable",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  reflection: {
    activityType: "reflection",
    componentName: "ReflectionPromptPanel",
    surfaceKind: "reading",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: false,
    codingExecutionMode: "not_applicable",
    allowsModelAuthoredHtmlOrSvg: false,
  },
  project: {
    activityType: "project",
    componentName: "ProjectDeliverablePanel",
    surfaceKind: "code",
    opaqueSurfaceRequired: true,
    requiresInitialAttemptBeforeSolution: false,
    codingExecutionMode: "external_only",
    allowsModelAuthoredHtmlOrSvg: false,
  },
} as const;

export interface SafeOutlineItem {
  readonly id: string;
  readonly title: string;
  readonly activityTitles?: readonly string[];
}

export interface CompatibilityAlertBanner {
  readonly role: "alert";
  readonly title: string;
  readonly message: string;
  readonly actionableNextStep: string;
}

export interface UnsupportedVersionCompatibilityView {
  readonly status: "unsupported_schema_version";
  readonly schemaVersion: string;
  readonly supportedMajorVersion: number;
  readonly supportedMinorVersion: number;
  readonly message: string;
  readonly compatibilityBanner: CompatibilityAlertBanner;
  readonly safeTextOutline: readonly SafeOutlineItem[];
  readonly safeActivityOutline: readonly SafeOutlineItem[];
  readonly inferredComponentsRendered: 0;
}

export interface RejectedPayloadView {
  readonly status: "rejected_unsafe_payload";
  readonly reason: string;
}

export interface AccessibleMathFormulaView {
  readonly latexSource: string;
  readonly displayMode: "inline" | "block";
  readonly role: "math";
  readonly ariaLabel: string;
  readonly mathml: string;
  readonly surfaceKind: "math";
  readonly opaqueSurfaceRequired: true;
  readonly overflowBehavior: "scrollable_region";
  readonly isScreenshotOnly: false;
}

export interface ValidatedActivityNode {
  readonly activityId: string;
  readonly title: string;
  readonly activityType: AllowlistedActivityType;
  readonly componentName: ReviewedActivityComponentName;
  readonly surfaceKind: "reading" | "code" | "assessment";
  readonly opaqueSurfaceRequired: true;
  readonly masteryGated: boolean;
  readonly safeResourceUrls: readonly string[];
  readonly sanitizedPrompt: string;
  readonly mathFormulas: readonly AccessibleMathFormulaView[];
  readonly svgDiagramPolicy: {
    readonly allowModelAuthoredSvg: false;
    readonly allowModelAuthoredMermaid: false;
    readonly rendererOwnedSvgOnly: true;
  };
  readonly interactionPolicy: {
    readonly autoSubmitOnSelect: false;
    readonly externalOpenMarksCompleted: false;
    readonly codingExecutionMode: "external_only" | "not_applicable";
  };
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

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const HTML_TAG_BLOCK_RE = /<(script|style|iframe|object|embed|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_ANY_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>/gi,
  /\[(?:INST|\/INST|SYSTEM)\]/gi,
  /\b(?:tool_call|function_call|execute_command|invoke_tool)\s*\(/gi,
  /\bSYSTEM\s*:\s*You\s+are\s+now\b/gi,
];

const FORBIDDEN_ACTIVITY_KEYS = [
  "script",
  "raw_html",
  "executable_code",
  "html",
  "raw_svg",
  "mermaid",
  "custom_component",
  "dangerouslySetInnerHTML",
] as const;

export function isSafeResourceUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export interface SafeCatalogLink {
  readonly label: string;
  readonly url: string;
}

export interface SanitizedCatalogTextResult {
  readonly text: string;
  readonly sanitizedText: string;
  readonly safeLinks: readonly SafeCatalogLink[];
  readonly strippedUnsafeSchemes: readonly string[];
  readonly hadControlChars: boolean;
  readonly hadHtmlTags: boolean;
  readonly hadPromptInjectionPatterns: boolean;
  readonly renderAs: "inert_plain_text";
  readonly allowToolExecution: false;
  readonly allowHtmlInterpolation: false;
  toString(): string;
}

/**
 * Isolates and sanitizes untrusted resource/catalog text (`@S57`, `@S88`, Section 14.5).
 * - Strips ASCII/Unicode control characters and bidi overrides.
 * - Strips HTML/script/style/SVG tags and raw angle brackets.
 * - Neutralizes Markdown links with schemes outside `https:` and `mailto:`.
 * - Neutralizes prompt-injected tool-invocation or role-override directives.
 */
export function renderUntrustedCatalogText(
  rawInput: unknown,
  options: { readonly maxLength?: number } = {}
): SanitizedCatalogTextResult {
  const maxLength = options.maxLength ?? 2000;
  if (typeof rawInput !== "string") {
    const empty = "";
    return {
      text: empty,
      sanitizedText: empty,
      safeLinks: [],
      strippedUnsafeSchemes: [],
      hadControlChars: false,
      hadHtmlTags: false,
      hadPromptInjectionPatterns: false,
      renderAs: "inert_plain_text",
      allowToolExecution: false,
      allowHtmlInterpolation: false,
      toString() {
        return empty;
      },
    };
  }

  let working = rawInput;
  const hadControlChars = CONTROL_CHARS_RE.test(working);
  CONTROL_CHARS_RE.lastIndex = 0;
  working = working.replace(CONTROL_CHARS_RE, "");

  const hadHtmlTags =
    HTML_TAG_BLOCK_RE.test(working) || HTML_ANY_TAG_RE.test(working) || /[<>]/.test(working);
  HTML_TAG_BLOCK_RE.lastIndex = 0;
  HTML_ANY_TAG_RE.lastIndex = 0;
  working = working.replace(HTML_TAG_BLOCK_RE, " ");
  working = working.replace(HTML_ANY_TAG_RE, " ");

  let hadPromptInjectionPatterns = false;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(working)) {
      hadPromptInjectionPatterns = true;
      pattern.lastIndex = 0;
      working = working.replace(pattern, "[neutralized-untrusted-directive]");
    }
  }

  const safeLinks: SafeCatalogLink[] = [];
  const strippedUnsafeSchemes: string[] = [];

  working = working.replace(MARKDOWN_LINK_RE, (_fullMatch, rawLabel: string, rawTarget: string) => {
    const cleanLabel = rawLabel.replace(/[<>]/g, "").trim();
    const target = rawTarget.trim();
    if (isSafeResourceUrl(target)) {
      safeLinks.push({ label: cleanLabel, url: target });
      return `[${cleanLabel}](${target})`;
    }
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(target);
    strippedUnsafeSchemes.push(schemeMatch?.[1]?.toLowerCase() ?? "invalid");
    return cleanLabel;
  });

  // Remove any remaining angle brackets so raw HTML can never be interpolated
  working = working.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);

  return {
    text: working,
    sanitizedText: working,
    safeLinks,
    strippedUnsafeSchemes,
    hadControlChars,
    hadHtmlTags,
    hadPromptInjectionPatterns,
    renderAs: "inert_plain_text",
    allowToolExecution: false,
    allowHtmlInterpolation: false,
    toString() {
      return working;
    },
  };
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function latexToSpokenLabel(latex: string): string {
  const spoken = latex
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1) divided by ($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "square root of ($1)")
    .replace(/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, "sum from $1 to $2")
    .replace(/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, "integral from $1 to $2")
    .replace(/\^\{([^}]+)\}/g, " to the power of $1")
    .replace(/\^([a-zA-Z0-9]+)/g, " to the power of $1")
    .replace(/_\{([^}]+)\}/g, " subscript $1")
    .replace(/_([a-zA-Z0-9]+)/g, " subscript $1")
    .replace(/\\(?:alpha|beta|gamma|delta|theta|lambda|sigma|pi|omega|nabla|partial)/g, (m) =>
      m.slice(1)
    )
    .replace(/\\(?:cdot|times)/g, " times ")
    .replace(/\\(?:leq|le)/g, " less than or equal to ")
    .replace(/\\(?:geq|ge)/g, " greater than or equal to ")
    .replace(/\\(?:neq|ne)/g, " not equal to ")
    .replace(/\\(?:in)/g, " in ")
    .replace(/[\\{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spoken ? `Mathematical expression: ${spoken}` : "Mathematical expression";
}

function tokenizeLatexToMrowContent(latex: string): string {
  const fracMatch = /^\\frac\{([^{}]+)\}\{([^{}]+)\}$/.exec(latex.trim());
  if (fracMatch && fracMatch[1] && fracMatch[2]) {
    return `<mfrac><mrow>${tokenizeLatexToMrowContent(fracMatch[1])}</mrow><mrow>${tokenizeLatexToMrowContent(fracMatch[2])}</mrow></mfrac>`;
  }

  const tokens: string[] = [];
  const tokenRe = /\\[a-zA-Z]+|[0-9]+(?:\.[0-9]+)?|[a-zA-Z]|[+\-=*/()^_<>]/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(latex)) !== null) {
    const tok = match[0];
    if (!tok) continue;
    if (/^[0-9]/.test(tok)) {
      tokens.push(`<mn>${escapeXml(tok)}</mn>`);
    } else if (/^[a-zA-Z]$/.test(tok)) {
      tokens.push(`<mi>${escapeXml(tok)}</mi>`);
    } else if (tok.startsWith("\\")) {
      tokens.push(`<mi>${escapeXml(tok.slice(1))}</mi>`);
    } else {
      tokens.push(`<mo>${escapeXml(tok)}</mo>`);
    }
  }

  if (tokens.length === 0) {
    return `<mtext>${escapeXml(latex)}</mtext>`;
  }
  return tokens.join("");
}

/**
 * Produces an accessible MathML-ready + `aria-label` representation for mathematical
 * notation (`UI-010`, `UI-021`, `@S76`, `@S80`, Section 9.2).
 * Never renders math as screenshot-only content or on a translucent surface.
 */
export function renderAccessibleMathFormula(
  rawLatex: string,
  options: { readonly displayMode?: "inline" | "block" } = {}
): AccessibleMathFormulaView {
  const displayMode = options.displayMode ?? "inline";
  // Strip control chars, HTML tags, and dangerous LaTeX file/href commands
  const cleanedLatex = rawLatex
    .replace(CONTROL_CHARS_RE, "")
    .replace(HTML_TAG_BLOCK_RE, "")
    .replace(HTML_ANY_TAG_RE, "")
    .replace(/\\(?:href|url|input|include|write18)\s*\{[^}]*\}/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1000);

  const ariaLabel = latexToSpokenLabel(cleanedLatex);
  const escapedAnnotation = escapeXml(cleanedLatex);
  const mrowBody = tokenizeLatexToMrowContent(cleanedLatex);
  const mathml = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${displayMode}" aria-label="${escapeXml(ariaLabel)}"><semantics><mrow>${mrowBody}</mrow><annotation encoding="application/x-tex">${escapedAnnotation}</annotation></semantics></math>`;

  return {
    latexSource: cleanedLatex,
    displayMode,
    role: "math",
    ariaLabel,
    mathml,
    surfaceKind: "math",
    opaqueSurfaceRequired: true,
    overflowBehavior: "scrollable_region",
    isScreenshotOnly: false,
  };
}

function sanitizePlainText(input: unknown, fallback: string): string {
  if (typeof input !== "string") {
    return fallback;
  }
  const sanitized = renderUntrustedCatalogText(input, { maxLength: 240 }).text;
  return sanitized || fallback;
}

function extractSafeTextOutline(rawDoc: Record<string, unknown>): SafeOutlineItem[] {
  const items: SafeOutlineItem[] = [];
  const rawActivities = Array.isArray(rawDoc["activities"]) ? rawDoc["activities"] : [];
  const activityTitleById = new Map<string, string>();
  for (const rawAct of rawActivities) {
    if (rawAct && typeof rawAct === "object" && !Array.isArray(rawAct)) {
      const act = rawAct as Record<string, unknown>;
      const actId = sanitizePlainText(act["activity_id"] ?? act["id"], "unknown-activity");
      const actTitle = sanitizePlainText(act["title"], "Untitled Activity");
      activityTitleById.set(actId, actTitle);
    }
  }

  const modules = Array.isArray(rawDoc["modules"]) ? rawDoc["modules"] : [];
  for (const mod of modules) {
    if (mod && typeof mod === "object" && !Array.isArray(mod)) {
      const m = mod as Record<string, unknown>;
      const id = sanitizePlainText(m["module_id"] ?? m["id"], "unknown-module");
      const title = sanitizePlainText(m["title"], "Untitled Module");
      const rawActIds = Array.isArray(m["activity_ids"]) ? m["activity_ids"] : [];
      const activityTitles: string[] = [];
      for (const rawId of rawActIds) {
        if (typeof rawId === "string") {
          const cleanId = sanitizePlainText(rawId, "");
          activityTitles.push(activityTitleById.get(cleanId) ?? cleanId);
        }
      }
      items.push({ id, title, activityTitles });
    }
  }
  return items;
}

function extractSafeActivityOutline(rawDoc: Record<string, unknown>): SafeOutlineItem[] {
  const items: SafeOutlineItem[] = [];
  const rawActivities = Array.isArray(rawDoc["activities"]) ? rawDoc["activities"] : [];
  for (const rawAct of rawActivities) {
    if (rawAct && typeof rawAct === "object" && !Array.isArray(rawAct)) {
      const act = rawAct as Record<string, unknown>;
      const id = sanitizePlainText(act["activity_id"] ?? act["id"], "unknown-activity");
      const title = sanitizePlainText(act["title"], "Untitled Activity");
      items.push({ id, title });
    }
  }
  return items;
}

function extractActivityPromptAndMath(act: Record<string, unknown>): {
  sanitizedPrompt: string;
  mathFormulas: AccessibleMathFormulaView[];
} {
  const contentObj =
    act["content"] && typeof act["content"] === "object" && !Array.isArray(act["content"])
      ? (act["content"] as Record<string, unknown>)
      : {};
  const rawPrompt =
    contentObj["study_prompt"] ??
    contentObj["example_prompt"] ??
    contentObj["task_prompt"] ??
    contentObj["recall_prompt"] ??
    contentObj["reflection_prompt"] ??
    act["title"] ??
    "";
  const sanitizedPrompt = renderUntrustedCatalogText(rawPrompt, { maxLength: 1600 }).text;

  const mathFormulas: AccessibleMathFormulaView[] = [];
  if (typeof contentObj["math_formula"] === "string") {
    mathFormulas.push(
      renderAccessibleMathFormula(contentObj["math_formula"], { displayMode: "block" })
    );
  }
  if (Array.isArray(contentObj["math_formulas"])) {
    for (const formula of contentObj["math_formulas"]) {
      if (typeof formula === "string") {
        mathFormulas.push(renderAccessibleMathFormula(formula, { displayMode: "block" }));
      }
    }
  }
  return { sanitizedPrompt, mathFormulas };
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
    const message = "Missing or malformed curriculum schema_version; failing closed.";
    return {
      status: "unsupported_schema_version",
      schemaVersion: rawVersion || "missing",
      supportedMajorVersion: SUPPORTED_CURRICULUM_MAJOR_VERSION,
      supportedMinorVersion: SUPPORTED_CURRICULUM_MINOR_VERSION,
      message,
      compatibilityBanner: {
        role: "alert",
        title: "Unsupported curriculum format",
        message,
        actionableNextStep:
          "Refresh the application or inspect the safe plain-text outline below.",
      },
      safeTextOutline: extractSafeTextOutline(doc),
      safeActivityOutline: extractSafeActivityOutline(doc),
      inferredComponentsRendered: 0,
    };
  }

  const major = Number.parseInt(match[1] ?? "-1", 10);
  const minor = Number.parseInt(match[2] ?? "-1", 10);
  if (
    major !== SUPPORTED_CURRICULUM_MAJOR_VERSION ||
    minor !== SUPPORTED_CURRICULUM_MINOR_VERSION
  ) {
    const message = `Unsupported curriculum schema version ${rawVersion} (expected ${SUPPORTED_CURRICULUM_MAJOR_VERSION}.${SUPPORTED_CURRICULUM_MINOR_VERSION}.x). Failing closed and rendering safe text outline only.`;
    return {
      status: "unsupported_schema_version",
      schemaVersion: rawVersion,
      supportedMajorVersion: SUPPORTED_CURRICULUM_MAJOR_VERSION,
      supportedMinorVersion: SUPPORTED_CURRICULUM_MINOR_VERSION,
      message,
      compatibilityBanner: {
        role: "alert",
        title: `Unsupported curriculum schema version (${rawVersion})`,
        message,
        actionableNextStep:
          "Update your client to a compatible release or view the safe plain-text module outline.",
      },
      safeTextOutline: extractSafeTextOutline(doc),
      safeActivityOutline: extractSafeActivityOutline(doc),
      inferredComponentsRendered: 0,
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
    for (const forbiddenKey of FORBIDDEN_ACTIVITY_KEYS) {
      if (forbiddenKey in act) {
        return {
          status: "rejected_unsafe_payload",
          reason: `Executable or raw markup field "${forbiddenKey}" is forbidden in activity payloads.`,
        };
      }
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

    const typedActivityType = actType as AllowlistedActivityType;
    const blueprint = ACTIVITY_COMPONENT_BLUEPRINTS[typedActivityType];
    const { sanitizedPrompt, mathFormulas } = extractActivityPromptAndMath(act);

    validatedActivities.push({
      activityId: sanitizePlainText(act["activity_id"] ?? act["id"], "activity"),
      title: sanitizePlainText(act["title"], "Untitled Activity"),
      activityType: typedActivityType,
      componentName: blueprint.componentName,
      surfaceKind: blueprint.surfaceKind,
      opaqueSurfaceRequired: true,
      masteryGated: act["mastery_gated"] === true,
      safeResourceUrls: urls,
      sanitizedPrompt,
      mathFormulas,
      svgDiagramPolicy: {
        allowModelAuthoredSvg: false,
        allowModelAuthoredMermaid: false,
        rendererOwnedSvgOnly: true,
      },
      interactionPolicy: {
        autoSubmitOnSelect: false,
        externalOpenMarksCompleted: false,
        codingExecutionMode: blueprint.codingExecutionMode,
      },
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
