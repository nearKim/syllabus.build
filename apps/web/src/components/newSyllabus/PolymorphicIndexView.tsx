import type { VNode } from "preact";
import { MathText } from "../MathText.tsx";
import type { PolymorphicResourceIndex } from "./indexing.ts";

export interface PolymorphicIndexViewProps {
  readonly index: PolymorphicResourceIndex;
}

export function PolymorphicIndexView({ index }: PolymorphicIndexViewProps): VNode {
  if (index.kind === "book") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <span>Chapters ({index.tocChapters.length})</span>
        </summary>
        <div class="intake-index-body">
          <p class="meta-text">
            <code>{index.isbn13}</code> · {index.briefSummary}
          </p>
          <ul class="intake-index-list">
            {index.tocChapters.map((ch) => (
              <li key={ch.number}>
                <strong>
                  {ch.number}: <MathText text={ch.title} />
                </strong>{" "}
                — <MathText text={ch.summary} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  if (index.kind === "youtube_playlist") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <span>Videos ({index.syllabusVideos.length})</span>
        </summary>
        <div class="intake-index-body">
          <p class="meta-text">{index.channelTitle}</p>
          <ul class="intake-index-list">
            {index.syllabusVideos.map((vid) => (
              <li key={vid.timestampOrIndex}>
                <code>{vid.timestampOrIndex}</code>{" "}
                <strong>
                  <MathText text={vid.title} />
                </strong>{" "}
                — <MathText text={vid.transcriptSummary} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  if (index.kind === "code_lab") {
    return (
      <details class="intake-resource-index-details">
        <summary class="intake-index-summary">
          <span>Exercises ({index.labExercises.length})</span>
        </summary>
        <div class="intake-index-body">
          <ul class="intake-index-list">
            {index.labExercises.map((ex) => (
              <li key={ex.id}>
                <strong>{ex.title}</strong> · <code>{ex.testCommand}</code>
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  return (
    <details class="intake-resource-index-details">
      <summary class="intake-index-summary">
        <span>Units ({index.syllabusModules.length})</span>
      </summary>
      <div class="intake-index-body">
        <ul class="intake-index-list">
          {index.syllabusModules.map((mod) => (
            <li key={mod.unit}>
              <strong>{mod.unit}:</strong> {mod.title}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export const renderPolymorphicIndexDetails = (index: PolymorphicResourceIndex): VNode => (
  <PolymorphicIndexView index={index} />
);
