import type { VNode } from "preact";

export type SfIconName =
  | "learn"
  | "explore"
  | "settings"
  | "today"
  | "plan"
  | "progress"
  | "resources"
  | "zoom-in"
  | "zoom-out"
  | "reset"
  | "focus"
  | "sparkles"
  | "check"
  | "plus"
  | "edit"
  | "close"
  | "clock"
  | "globe"
  | "rigor"
  | "pin"
  | "code"
  | "video"
  | "youtube"
  | "quiz"
  | "course"
  | "upvote"
  | "engineering"
  | "math"
  | "physics"
  | "literature"
  | "systems";

export type GlyphTone = "todo" | "doing" | "done";
export type GlyphKind = "module" | "gate";
export type SegmentStyle = "solid" | "dashed";

function renderSfIconNodes(name: SfIconName): VNode {
  switch (name) {
    case "learn":
      return (
        <>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </>
      );
    case "explore":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </>
      );
    case "settings":
      return (
        <>
          <line x1="21" x2="14" y1="4" y2="4" />
          <line x1="10" x2="3" y1="4" y2="4" />
          <line x1="21" x2="12" y1="12" y2="12" />
          <line x1="8" x2="3" y1="12" y2="12" />
          <line x1="21" x2="16" y1="20" y2="20" />
          <line x1="12" x2="3" y1="20" y2="20" />
          <line x1="14" x2="14" y1="2" y2="6" />
          <line x1="8" x2="8" y1="10" y2="14" />
          <line x1="16" x2="16" y1="18" y2="22" />
        </>
      );
    case "today":
      return (
        <>
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M3 10h18" />
        </>
      );
    case "plan":
      return (
        <>
          <rect x="16" y="16" width="6" height="6" rx="1" />
          <rect x="2" y="16" width="6" height="6" rx="1" />
          <rect x="9" y="2" width="6" height="6" rx="1" />
          <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
          <path d="M12 12V8" />
        </>
      );
    case "progress":
      return (
        <>
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </>
      );
    case "resources":
      return (
        <>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </>
      );
    case "zoom-in":
      return (
        <>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" x2="16.65" y1="21" y2="16.65" />
          <line x1="11" x2="11" y1="8" y2="14" />
          <line x1="8" x2="14" y1="11" y2="11" />
        </>
      );
    case "zoom-out":
      return (
        <>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" x2="16.65" y1="21" y2="16.65" />
          <line x1="8" x2="14" y1="11" y2="11" />
        </>
      );
    case "reset":
      return (
        <>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </>
      );
    case "focus":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="22" x2="18" y1="12" y2="12" />
          <line x1="6" x2="2" y1="12" y2="12" />
          <line x1="12" x2="12" y1="6" y2="2" />
          <line x1="12" x2="12" y1="22" y2="18" />
        </>
      );
    case "sparkles":
      return (
        <>
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <path d="M20 3v4" />
          <path d="M22 5h-4" />
          <path d="M4 17v2" />
          <path d="M5 18H3" />
        </>
      );
    case "check":
      return <path d="M20 6 9 17l-5-5" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "edit":
      return <path d="m16 3 5 5M3 21l5-1L21 7a3.5 3.5 0 0 0-5-5L3 15z" />;
    case "close":
      return (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </>
      );
    case "rigor":
      return (
        <>
          <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
          <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
          <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
        </>
      );
    case "pin":
      return (
        <>
          <line x1="12" x2="12" y1="17" y2="22" />
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
        </>
      );
    case "code":
      return (
        <>
          <path d="m18 16 4-4-4-4" />
          <path d="m6 8-4 4 4 4" />
          <path d="m14.5 4-5 16" />
        </>
      );
    case "video":
      return (
        <>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </>
      );
    case "youtube":
      return (
        <>
          <path d="M21.58 7.19a2.8 2.8 0 0 0-1.97-1.98C17.88 4.75 12 4.75 12 4.75s-5.88 0-7.61.46a2.8 2.8 0 0 0-1.97 1.98A29.3 29.3 0 0 0 2 12a29.3 29.3 0 0 0 .42 4.81 2.8 2.8 0 0 0 1.97 1.98c1.73.46 7.61.46 7.61.46s5.88 0 7.61-.46a2.8 2.8 0 0 0 1.97-1.98A29.3 29.3 0 0 0 22 12a29.3 29.3 0 0 0-.42-4.81Z" fill="currentColor" stroke="none" />
          <path d="m10 8.75 5.5 3.25-5.5 3.25Z" fill="#fff" stroke="none" />
        </>
      );
    case "quiz":
      return (
        <>
          <rect x="4" y="3" width="16" height="19" rx="2" />
          <path d="M9 3V2h6v1M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
          <path d="M12 17h.01" />
        </>
      );
    case "course":
      return (
        <>
          <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
          <path d="M22 10v6" />
          <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
        </>
      );
    case "upvote":
      return (
        <>
          <path
            class="upvote-thumb"
            d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
          />
          <path class="upvote-cuff" d="M7 10v12" />
        </>
      );
    case "engineering":
      return (
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      );
    case "math":
      return <path d="M18 7V4H6l6 8-6 8h12v-3" />;
    case "physics":
      return (
        <>
          <circle cx="12" cy="12" r="1" />
          <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
          <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
        </>
      );
    case "literature":
      return (
        <>
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <polyline points="10 2 10 10 13 7 16 10 16 2" />
        </>
      );
    case "systems":
      return (
        <>
          <rect width="16" height="16" x="4" y="4" rx="2" />
          <rect width="6" height="6" x="9" y="9" rx="1" />
          <path d="M15 2v2" />
          <path d="M15 20v2" />
          <path d="M2 15h2" />
          <path d="M2 9h2" />
          <path d="M20 15h2" />
          <path d="M20 9h2" />
          <path d="M9 2v2" />
          <path d="M9 20v2" />
        </>
      );
  }
}

export interface SfIconProps {
  readonly name: SfIconName;
  readonly size?: 15 | 16;
}

export function SfIcon({ name, size = 16 }: SfIconProps): VNode {
  return (
    <svg
      class="sf-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {renderSfIconNodes(name)}
    </svg>
  );
}

export interface StatusGlyphProps {
  readonly type: GlyphKind;
  readonly tone: GlyphTone;
  readonly size?: number;
}

export function StatusGlyph({ type, tone, size = 20 }: StatusGlyphProps): VNode {
  return (
    <svg
      class="st-glyph"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      data-type={type}
      data-status={tone}
    >
      {type === "gate" ? (
        <path class="st-g-shape" d="M10 1.7 18.3 10 10 18.3 1.7 10Z" />
      ) : (
        <rect class="st-g-shape" x="1.25" y="1.25" width="17.5" height="17.5" rx="4.5" />
      )}
      {type === "gate" ? (
        tone === "done" ? (
          <path class="st-g-check" d="M6.6 10.2 8.9 12.5 13.5 7.6" />
        ) : null
      ) : tone === "doing" ? (
        <path class="st-g-half" d="M10 1.25H5.75a4.5 4.5 0 0 0-4.5 4.5v8.5a4.5 4.5 0 0 0 4.5 4.5H10Z" />
      ) : tone === "done" ? (
        <path class="st-g-check" d="M5.5 10.4 8.4 13.3 14.6 6.8" />
      ) : null}
    </svg>
  );
}

export interface UnitMarkerProps {
  readonly tone: GlyphTone;
  readonly size?: number;
}

export function UnitMarker({ tone, size = 24 }: UnitMarkerProps): VNode {
  return (
    <svg class="st-marker" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-status={tone}>
      {tone === "done" ? (
        <>
          <circle class="st-m-disc" cx="12" cy="12" r="10" />
          <path class="st-m-check" d="M7.3 12.3 10.4 15.4 16.6 8.8" />
        </>
      ) : (
        <>
          <circle class="st-m-ring" cx="12" cy="12" r="9.2" />
          {tone === "doing" ? <path class="st-m-half" d="M12 2.8a9.2 9.2 0 0 0 0 18.4Z" /> : null}
        </>
      )}
    </svg>
  );
}

export interface ArrowSvgProps {
  readonly className: string;
  readonly style?: SegmentStyle;
}

export function ArrowSvg({ className, style = "solid" }: ArrowSvgProps): VNode {
  return (
    <svg class={className} viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" data-style={style}>
      <line x1="1" y1="6" x2="20" y2="6" />
      <path class="arrow-head" d="M19 2 L27 6 L19 10 Z" />
    </svg>
  );
}

export interface ConnectorSvgProps {
  readonly kind: "in" | "out" | "through" | "lead-in" | "lead-through" | "unit-out";
  readonly style: SegmentStyle;
}

export function ConnectorSvg({ kind, style }: ConnectorSvgProps): VNode {
  return (
    <svg class="matrix-svg" data-seg={kind} data-style={style} aria-hidden="true">
      <line x1="0" y1="6" x2="100%" y2="6" />
      {kind === "in" || kind === "lead-in" ? (
        <svg x="100%" overflow="visible">
          <path class="arrow-head" d="M-8 2 L0 6 L-8 10 Z" />
        </svg>
      ) : null}
    </svg>
  );
}

export function FlowKey(): VNode {
  return (
    <ul class="flow-key" aria-label="Flowchart key">
      <li>
        <StatusGlyph type="module" tone="todo" size={16} />
        <span>Not started</span>
      </li>
      <li>
        <StatusGlyph type="module" tone="doing" size={16} />
        <span>In progress</span>
      </li>
      <li>
        <StatusGlyph type="module" tone="done" size={16} />
        <span>Done</span>
      </li>
      <li>
        <StatusGlyph type="gate" tone="todo" size={16} />
        <span>Gate not passed</span>
      </li>
      <li>
        <StatusGlyph type="gate" tone="done" size={16} />
        <span>Gate passed</span>
      </li>
      <li>
        <ArrowSvg className="key-line" style="solid" />
        <span>Next step</span>
      </li>
      <li>
        <ArrowSvg className="key-line" style="dashed" />
        <span>Optional enrichment</span>
      </li>
    </ul>
  );
}
