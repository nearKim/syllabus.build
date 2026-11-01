import type { VNode } from "preact";
import { SfIcon } from "../Icons.tsx";
import {
  syllabusTagsOf,
  type SyllabusTagDescriptor,
} from "./filterEngine.ts";

export type { SyllabusTagDescriptor };
export { syllabusTagsOf };

export interface SyllabusTagStripProps {
  readonly syllabus: Record<string, unknown>;
  readonly fallbackSubject?: string;
  readonly fallbackGateStyle?: string;
}

// Learn tab UI representation of the shared syllabus tag data.
// While Explore renders these tags as interactive filter buttons, Learn renders the same underlying
// syllabus taxonomy and topic tags as a concise metadata strip.
export function SyllabusTagStrip({
  syllabus,
  fallbackSubject,
  fallbackGateStyle,
}: SyllabusTagStripProps): VNode {
  const tags = syllabusTagsOf(syllabus, { subject: fallbackSubject, gateStyle: fallbackGateStyle });
  return (
    <div
      class="learn-syllabus-tags"
      aria-label="Syllabus taxonomy and topic tags"
      data-category={tags.category ?? undefined}
      data-subject={tags.subject}
      data-difficulty={tags.difficulty ?? undefined}
      data-format={tags.format ?? undefined}
    >
      <span class="learn-tag-primary" data-tag-facet="subject">
        <span class="learn-tag-icon" aria-hidden="true">
          <SfIcon name={tags.subjectIcon} size={15} />
        </span>
        {tags.category ? (
          <>
            <span class="learn-tag-category">{tags.category}</span>
            <span class="learn-tag-sep" aria-hidden="true">
              ›
            </span>
          </>
        ) : null}
        <span class="learn-tag-subject">{tags.subjectLabel}</span>
      </span>
      {tags.topicTags.length > 0 ? (
        <ul class="learn-topic-tags" aria-label="Topics">
          {tags.topicTags.map((topic) => (
            <li key={topic} class="learn-topic-chip" data-tag-topic={topic}>
              {topic}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
