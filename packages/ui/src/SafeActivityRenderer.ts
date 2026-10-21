/**
 * Fail-closed `SafeActivityRenderer` & Untrusted Content Sanitizer
 * (`NFR-002`, `UI-010`, `UI-024`, `@S11`, `@S57`, `@S80`, `@S88`, Section 9.6, Section 9.12, Section 14.5).
 */

export const SUPPORTED_CURRICULUM_MAJOR_VERSION = 0 as const;
export const SUPPORTED_CURRICULUM_MINOR_VERSION = 2 as const;

export const ALLOWLISTED_ACTIVITY_TYPES = [
  "theory", "worked_example", "coding", "quiz", "review", "reflection", "project",
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

const makeBlueprint = (
  activityType: AllowlistedActivityType,
  componentName: ReviewedActivityComponentName,
  surfaceKind: "reading" | "code" | "assessment",
  requiresInitialAttemptBeforeSolution = false,
  codingExecutionMode: "external_only" | "not_applicable" = "not_applicable",
): ActivityComponentBlueprint => ({
  activityType,
  componentName,
  surfaceKind,
  opaqueSurfaceRequired: true,
  requiresInitialAttemptBeforeSolution,
  codingExecutionMode,
  allowsModelAuthoredHtmlOrSvg: false,
});

export const ACTIVITY_COMPONENT_BLUEPRINTS: Readonly<
  Record<AllowlistedActivityType, ActivityComponentBlueprint>
> = {
  theory: makeBlueprint("theory", "TheoryStudyPanel", "reading"),
  worked_example: makeBlueprint("worked_example", "WorkedExampleWalkthrough", "reading"),
  coding: makeBlueprint("coding", "ExternalCodingTaskPanel", "code", false, "external_only"),
  quiz: makeBlueprint("quiz", "QuizAssessmentPanel", "assessment", true),
  review: makeBlueprint("review", "SpacedReviewPromptPanel", "assessment", true),
  reflection: makeBlueprint("reflection", "ReflectionPromptPanel", "reading"),
  project: makeBlueprint("project", "ProjectDeliverablePanel", "code", false, "external_only"),
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
  "script", "raw_html", "executable_code", "html", "raw_svg", "mermaid", "custom_component", "dangerouslySetInnerHTML",
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

export function renderUntrustedCatalogText(
  rawInput: unknown,
  options: { readonly maxLength?: number } = {},
): SanitizedCatalogTextResult {
  const maxLength = options.maxLength ?? 2000;
  if (typeof rawInput !== "string") {
    return {
      text: "", sanitizedText: "", safeLinks: [], strippedUnsafeSchemes: [],
      hadControlChars: false, hadHtmlTags: false, hadPromptInjectionPatterns: false,
      renderAs: "inert_plain_text", allowToolExecution: false, allowHtmlInterpolation: false,
      toString: () => "",
    };
  }

  let working = rawInput;
  const hadControlChars = CONTROL_CHARS_RE.test(working);
  CONTROL_CHARS_RE.lastIndex = 0;
  working = working.replace(CONTROL_CHARS_RE, "");

  const hadHtmlTags = HTML_TAG_BLOCK_RE.test(working) || HTML_ANY_TAG_RE.test(working) || /[<>]/.test(working);
  HTML_TAG_BLOCK_RE.lastIndex = 0;
  HTML_ANY_TAG_RE.lastIndex = 0;
  working = working.replace(HTML_TAG_BLOCK_RE, " ").replace(HTML_ANY_TAG_RE, " ");

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

  working = working.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);

  return {
    text: working, sanitizedText: working, safeLinks, strippedUnsafeSchemes,
    hadControlChars, hadHtmlTags, hadPromptInjectionPatterns,
    renderAs: "inert_plain_text", allowToolExecution: false, allowHtmlInterpolation: false,
    toString: () => working,
  };
}

/** Shared plain-text sanitizer reused across UI and web view models. */
export function sanitizeText(input: unknown, fallback = "", maxLength = 1600): string {
  if (typeof input !== "string") return fallback;
  return renderUntrustedCatalogText(input, { maxLength }).text || fallback;
}

/** Shared XML/HTML entity escaper reused across UI and web view models. */
export function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function latexToSpokenLabel(latex: string): string {
  const spoken = latex
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]*)\}/g, " $1 ")
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, " ")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1) divided by ($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "square root of ($1)")
    .replace(/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, "sum from $1 to $2")
    .replace(/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, "integral from $1 to $2")
    .replace(/\^\{([^}]+)\}|\^([a-zA-Z0-9]+)/g, (_, a, b) => ` to the power of ${a ?? b}`)
    .replace(/_\{([^}]+)\}|_([a-zA-Z0-9]+)/g, (_, a, b) => ` subscript ${a ?? b}`)
    .replace(/\\(?:alpha|beta|gamma|delta|theta|lambda|sigma|pi|omega|nabla|partial)/g, (m) => m.slice(1))
    .replace(/\\(?:cdot|times)/g, " times ")
    .replace(/\\(?:leq|le)(?![a-zA-Z])/g, " less than or equal to ")
    .replace(/\\(?:geq|ge)(?![a-zA-Z])/g, " greater than or equal to ")
    .replace(/\\(?:neq|ne)(?![a-zA-Z])/g, " not equal to ")
    .replace(/\\in(?![a-zA-Z])/g, " in ")
    .replace(/[\\{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spoken ? `Mathematical expression: ${spoken}` : "Mathematical expression";
}

const LATEX_SYMBOLS: Readonly<Record<string, readonly ["mi" | "mo", string]>> = {
  alpha: ["mi", "α"], beta: ["mi", "β"], gamma: ["mi", "γ"], delta: ["mi", "δ"], theta: ["mi", "θ"],
  lambda: ["mi", "λ"], sigma: ["mi", "σ"], pi: ["mi", "π"], omega: ["mi", "ω"], nabla: ["mi", "∇"], partial: ["mi", "∂"],
  cdot: ["mo", "⋅"], times: ["mo", "×"], le: ["mo", "≤"], leq: ["mo", "≤"], ge: ["mo", "≥"], geq: ["mo", "≥"],
  ne: ["mo", "≠"], neq: ["mo", "≠"], in: ["mo", "∈"], sum: ["mo", "∑"], int: ["mo", "∫"],
};

// Recursive descent over the LaTeX subset that curriculum formulas use: groups, \frac, \sqrt,
// \mathrm-style text, \left/\right fences, sub/superscripts, and named symbols.
function tokenizeLatexToMrowContent(latex: string): string {
  let pos = 0;
  const peek = (): string => latex[pos] ?? "";
  const skipSpaces = (): void => {
    while (/\s/.test(peek())) pos++;
  };
  const readName = (): string => {
    const start = pos;
    while (/[a-zA-Z]/.test(peek())) pos++;
    return latex.slice(start, pos);
  };
  const readRawGroup = (): string => {
    skipSpaces();
    if (peek() !== "{") return "";
    const start = ++pos;
    for (let depth = 1; pos < latex.length && depth > 0; pos++) {
      if (latex[pos] === "{") depth++;
      else if (latex[pos] === "}") depth--;
    }
    return latex.slice(start, pos - 1);
  };
  const group = (): string => {
    skipSpaces();
    if (peek() !== "{") return atom() || "<mrow></mrow>";
    pos++;
    const inner = sequence("}");
    pos++;
    return `<mrow>${inner}</mrow>`;
  };
  const atom = (): string => {
    skipSpaces();
    const ch = peek();
    if (ch === "") return "";
    if (ch === "{") return group();
    pos++;
    if (ch === "\\") {
      const name = readName();
      if (!name) return `<mo>${escapeHtml(latex[pos++] ?? "")}</mo>`;
      if (name === "frac") return `<mfrac>${group()}${group()}</mfrac>`;
      if (name === "sqrt") return `<msqrt>${group()}</msqrt>`;
      if (name === "mathrm" || name === "text" || name === "operatorname") return `<mi mathvariant="normal">${escapeHtml(readRawGroup())}</mi>`;
      // Only \left...\right fences stretch, and only to the content between them.
      if (name === "left") {
        const open = fence();
        const inner = sequence(undefined, true);
        if (!latex.startsWith("\\right", pos)) return `<mrow>${open}${inner}</mrow>`;
        pos += "\\right".length;
        return `<mrow>${open}${inner}${fence()}</mrow>`;
      }
      if (name === "right") return fence();
      const symbol = LATEX_SYMBOLS[name];
      return symbol ? `<${symbol[0]}>${symbol[1]}</${symbol[0]}>` : `<mi>${escapeHtml(name)}</mi>`;
    }
    if (/[0-9]/.test(ch)) {
      const start = pos - 1;
      while (/[0-9.]/.test(peek())) pos++;
      return `<mn>${escapeHtml(latex.slice(start, pos))}</mn>`;
    }
    if (/[a-zA-Z]/.test(ch)) return `<mi>${escapeHtml(ch)}</mi>`;
    return /[()[\]|]/.test(ch) ? `<mo stretchy="false">${escapeHtml(ch)}</mo>` : `<mo>${escapeHtml(ch)}</mo>`;
  };
  const fence = (): string => {
    skipSpaces();
    const ch = latex[pos++] ?? "";
    return ch === "." || ch === "" ? "" : `<mo>${escapeHtml(ch)}</mo>`;
  };
  const sequence = (end?: string, untilRight = false): string => {
    let out = "";
    for (skipSpaces(); pos < latex.length && peek() !== end && !(untilRight && latex.startsWith("\\right", pos)); skipSpaces()) {
      if (peek() === "}") {
        pos++;
        continue;
      }
      const base = atom() || "<mrow></mrow>";
      let sub = "";
      let sup = "";
      for (skipSpaces(); peek() === "_" || peek() === "^"; skipSpaces()) {
        if (latex[pos++] === "_") sub = group();
        else sup = group();
      }
      out += sub && sup ? `<msubsup>${base}${sub}${sup}</msubsup>` : sub ? `<msub>${base}${sub}</msub>` : sup ? `<msup>${base}${sup}</msup>` : base;
    }
    return out;
  };
  return sequence() || `<mtext>${escapeHtml(latex)}</mtext>`;
}

export function renderAccessibleMathFormula(
  rawLatex: string,
  options: { readonly displayMode?: "inline" | "block" } = {},
): AccessibleMathFormulaView {
  const displayMode = options.displayMode ?? "inline";
  const cleanedLatex = rawLatex
    .replace(CONTROL_CHARS_RE, "")
    .replace(HTML_TAG_BLOCK_RE, "")
    .replace(HTML_ANY_TAG_RE, "")
    .replace(/\\(?:href|url|input|include|write18)\s*\{[^}]*\}/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1000);
  const ariaLabel = latexToSpokenLabel(cleanedLatex);
  const mrowBody = tokenizeLatexToMrowContent(cleanedLatex);
  return {
    latexSource: cleanedLatex,
    displayMode,
    role: "math",
    ariaLabel,
    mathml: `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${displayMode}" aria-label="${escapeHtml(ariaLabel)}"><semantics><mrow>${mrowBody}</mrow><annotation encoding="application/x-tex">${escapeHtml(cleanedLatex)}</annotation></semantics></math>`,
    surfaceKind: "math",
    opaqueSurfaceRequired: true,
    overflowBehavior: "scrollable_region",
    isScreenshotOnly: false,
  };
}

const asRecord = (val: unknown): Record<string, unknown> | null =>
  val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : null;

function extractSafeOutlines(rawDoc: Record<string, unknown>): {
  safeTextOutline: SafeOutlineItem[];
  safeActivityOutline: SafeOutlineItem[];
} {
  const safeActivityOutline: SafeOutlineItem[] = [];
  const activityTitleById = new Map<string, string>();
  for (const rawAct of Array.isArray(rawDoc["activities"]) ? rawDoc["activities"] : []) {
    const act = asRecord(rawAct);
    if (act) {
      const id = sanitizeText(act["activity_id"] ?? act["id"], "unknown-activity", 240);
      const title = sanitizeText(act["title"], "Untitled Activity", 240);
      activityTitleById.set(id, title);
      safeActivityOutline.push({ id, title });
    }
  }
  const safeTextOutline: SafeOutlineItem[] = [];
  for (const rawMod of Array.isArray(rawDoc["modules"]) ? rawDoc["modules"] : []) {
    const m = asRecord(rawMod);
    if (m) {
      const id = sanitizeText(m["module_id"] ?? m["id"], "unknown-module", 240);
      const title = sanitizeText(m["title"], "Untitled Module", 240);
      const rawActIds = Array.isArray(m["activity_ids"]) ? m["activity_ids"] : [];
      const activityTitles = rawActIds
        .filter((r): r is string => typeof r === "string")
        .map((r) => {
          const cleanId = sanitizeText(r, "", 240);
          return activityTitleById.get(cleanId) ?? cleanId;
        });
      safeTextOutline.push({ id, title, activityTitles });
    }
  }
  return { safeTextOutline, safeActivityOutline };
}

export function evaluateSafeCurriculumRender(input: unknown): SafeRenderResult {
  const doc = asRecord(input);
  if (!doc) {
    return { status: "rejected_unsafe_payload", reason: "Curriculum document must be a non-null JSON object." };
  }

  const rawVersion = typeof doc["schema_version"] === "string" ? doc["schema_version"] : "";
  const match = SEMVER_RE.exec(rawVersion);
  const unsupportedResult = (schemaVersion: string, title: string, message: string, actionableNextStep: string): UnsupportedVersionCompatibilityView => ({
    status: "unsupported_schema_version",
    schemaVersion,
    supportedMajorVersion: SUPPORTED_CURRICULUM_MAJOR_VERSION,
    supportedMinorVersion: SUPPORTED_CURRICULUM_MINOR_VERSION,
    message,
    compatibilityBanner: { role: "alert", title, message, actionableNextStep },
    ...extractSafeOutlines(doc),
    inferredComponentsRendered: 0,
  });

  if (!match) {
    return unsupportedResult(
      rawVersion || "missing",
      "Unsupported curriculum format",
      "Missing or malformed curriculum schema_version; failing closed.",
      "Refresh the application or inspect the safe plain-text outline below.",
    );
  }

  const major = Number.parseInt(match[1] ?? "-1", 10);
  const minor = Number.parseInt(match[2] ?? "-1", 10);
  if (major !== SUPPORTED_CURRICULUM_MAJOR_VERSION || minor !== SUPPORTED_CURRICULUM_MINOR_VERSION) {
    return unsupportedResult(
      rawVersion,
      `Unsupported curriculum schema version (${rawVersion})`,
      `Unsupported curriculum schema version ${rawVersion} (expected ${SUPPORTED_CURRICULUM_MAJOR_VERSION}.${SUPPORTED_CURRICULUM_MINOR_VERSION}.x). Failing closed and rendering safe text outline only.`,
      "Update your client to a compatible release or view the safe plain-text module outline.",
    );
  }

  const rawActivities = doc["activities"];
  if (!Array.isArray(rawActivities) || rawActivities.length === 0 || rawActivities.length > 600) {
    return { status: "rejected_unsafe_payload", reason: "Activities array must be present and contain between 1 and 600 items." };
  }

  const validatedActivities: ValidatedActivityNode[] = [];
  for (const rawAct of rawActivities) {
    const act = asRecord(rawAct);
    if (!act) return { status: "rejected_unsafe_payload", reason: "Activity entry must be an object." };

    for (const forbiddenKey of FORBIDDEN_ACTIVITY_KEYS) {
      if (forbiddenKey in act) {
        return { status: "rejected_unsafe_payload", reason: `Executable or raw markup field "${forbiddenKey}" is forbidden in activity payloads.` };
      }
    }

    const actType = act["type"] ?? act["activity_type"];
    if (typeof actType !== "string" || !(ALLOWLISTED_ACTIVITY_TYPES as readonly string[]).includes(actType)) {
      return { status: "rejected_unsafe_payload", reason: `Unallowlisted activity type: ${String(actType)}` };
    }

    const safeResourceUrls: string[] = [];
    if (typeof act["source_url"] === "string") {
      if (!isSafeResourceUrl(act["source_url"])) {
        return { status: "rejected_unsafe_payload", reason: `Unsafe resource URL scheme in activity ${String(act["activity_id"] ?? "")}` };
      }
      safeResourceUrls.push(act["source_url"]);
    }

    const typedActivityType = actType as AllowlistedActivityType;
    const blueprint = ACTIVITY_COMPONENT_BLUEPRINTS[typedActivityType];
    const contentObj = asRecord(act["content"]) ?? {};
    const rawPrompt =
      contentObj["study_prompt"] ?? contentObj["example_prompt"] ?? contentObj["task_prompt"] ??
      contentObj["recall_prompt"] ?? contentObj["reflection_prompt"] ?? act["title"] ?? "";
    const sanitizedPrompt = sanitizeText(rawPrompt, "", 1600);

    const mathFormulas: AccessibleMathFormulaView[] = [];
    if (typeof contentObj["math_formula"] === "string") {
      mathFormulas.push(renderAccessibleMathFormula(contentObj["math_formula"], { displayMode: "block" }));
    }
    if (Array.isArray(contentObj["math_formulas"])) {
      for (const f of contentObj["math_formulas"]) {
        if (typeof f === "string") mathFormulas.push(renderAccessibleMathFormula(f, { displayMode: "block" }));
      }
    }

    validatedActivities.push({
      activityId: sanitizeText(act["activity_id"] ?? act["id"], "activity", 240),
      title: sanitizeText(act["title"], "Untitled Activity", 240),
      activityType: typedActivityType,
      componentName: blueprint.componentName,
      surfaceKind: blueprint.surfaceKind,
      opaqueSurfaceRequired: true,
      masteryGated: act["mastery_gated"] === true,
      safeResourceUrls,
      sanitizedPrompt,
      mathFormulas,
      svgDiagramPolicy: { allowModelAuthoredSvg: false, allowModelAuthoredMermaid: false, rendererOwnedSvgOnly: true },
      interactionPolicy: { autoSubmitOnSelect: false, externalOpenMarksCompleted: false, codingExecutionMode: blueprint.codingExecutionMode },
    });
  }

  const goalObj = asRecord(doc["goal"]) ?? {};
  return {
    status: "supported",
    schemaVersion: rawVersion,
    title: sanitizeText(goalObj["title"] ?? doc["title"], "Curriculum Plan", 240),
    activities: validatedActivities,
  };
}
