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
  | "check"
  | "close"
  | "clock"
  | "rigor"
  | "pin"
  | "code";

export type GlyphTone = "todo" | "doing" | "done";
export type GlyphKind = "module" | "gate";
export type SegmentStyle = "solid" | "dashed";

function renderSfIconNodes(name: SfIconName): VNode {
  switch (name) {
    case "learn":
      return (
        <>
          <path d="M3 2.75h3.6c.8 0 1.4.65 1.4 1.45V13" />
          <path d="M13 2.75H9.4c-.8 0-1.4.65-1.4 1.45V13" />
          <path d="M3 12.25h3.6" />
          <path d="M13 12.25H9.4" />
        </>
      );
    case "explore":
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="m9.95 6.05-1.15 3.15-3.15 1.15 1.15-3.15z" />
        </>
      );
    case "settings":
      return (
        <>
          <path d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5" />
          <circle cx="5.5" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="6.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
        </>
      );
    case "today":
      return (
        <>
          <rect x="2.75" y="3.5" width="10.5" height="9.75" rx="1.5" />
          <path d="M2.75 6.5h10.5M5.5 2.5v2M10.5 2.5v2" />
        </>
      );
    case "plan":
      return (
        <>
          <circle cx="4" cy="4.5" r="1.5" />
          <circle cx="12" cy="4.5" r="1.5" />
          <circle cx="8" cy="12" r="1.5" />
          <path d="M5.3 5.4 6.9 10.6M10.7 5.4 9.1 10.6" />
        </>
      );
    case "progress":
      return <path d="M3 13V8.5M8 13V4M13 13V6.5" />;
    case "resources":
      return (
        <>
          <path d="M4.25 2.75h5.4l2.1 2.1v8.15a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75z" />
          <path d="M9.6 2.75V5h2.15" />
        </>
      );
    case "zoom-in":
      return (
        <>
          <circle cx="7" cy="7" r="3.75" />
          <path d="m10 10 3.25 3.25M7 5.25v3.5M5.25 7h3.5" />
        </>
      );
    case "zoom-out":
      return (
        <>
          <circle cx="7" cy="7" r="3.75" />
          <path d="m10 10 3.25 3.25M5.25 7h3.5" />
        </>
      );
    case "reset":
      return (
        <>
          <path d="M13 8a5 5 0 1 1-1.35-3.4" />
          <path d="M13 2.75V5.5h-2.75" />
        </>
      );
    case "focus":
      return (
        <>
          <circle cx="8" cy="8" r="2" />
          <path d="M8 2.25v2.15M8 11.6v2.15M2.25 8h2.15M11.6 8h2.15" />
        </>
      );
    case "check":
      return <path d="M3.25 8.25 6.4 11.4 12.75 4.6" />;
    case "close":
      return <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />;
    case "clock":
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M8 5.25V8l1.9 1.25" />
        </>
      );
    case "rigor":
      return (
        <>
          <path d="M3 2.75v10.5h10.5z" />
          <path d="M3 10.5h2.75v2.75" />
        </>
      );
    case "pin":
      return (
        <>
          <path d="M6 2.75h4l-.6 3.6 1.85 2.15h-6.5L6.6 6.35z" />
          <path d="M8 8.5v4.75" />
        </>
      );
    case "code":
      return <path d="M5.75 4.75 2.5 8l3.25 3.25M10.25 4.75 13.5 8l-3.25 3.25" />;
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
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
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
      <line x1="1" y1="6" x2="26" y2="6" />
      <path d="M20.5 2 26 6 20.5 10" />
    </svg>
  );
}

export interface ConnectorSvgProps {
  readonly kind: "in" | "out" | "through";
  readonly style: SegmentStyle;
}

export function ConnectorSvg({ kind, style }: ConnectorSvgProps): VNode {
  return (
    <svg class="matrix-svg" data-seg={kind} data-style={style} aria-hidden="true">
      <line x1="0" y1="6" x2="100%" y2="6" />
      {kind === "in" ? (
        <svg x="100%" overflow="visible">
          <path d="M-7.5 2 -1.5 6 -7.5 10" />
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
