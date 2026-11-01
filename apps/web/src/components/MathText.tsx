import type { VNode } from "preact";
import { tokenizeTextWithLatex } from "@syllabus/ui";

export function MathText({ text }: { readonly text: string }): VNode {
  const segments = tokenizeTextWithLatex(text);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <>{segments[0].text}</>;
  }
  return (
    <>
      {segments.map((seg, idx) =>
        seg.kind === "text" ? (
          seg.text
        ) : seg.displayMode === "block" ? (
          <div
            key={idx}
            class="math-formula-surface"
            data-opaque-surface="true"
            data-latex={seg.latex}
            dangerouslySetInnerHTML={{ __html: seg.formula.mathml }}
          />
        ) : (
          <span
            key={idx}
            class="math-inline"
            data-opaque-surface="true"
            data-latex={seg.latex}
            dangerouslySetInnerHTML={{ __html: seg.formula.mathml }}
          />
        ),
      )}
    </>
  );
}
