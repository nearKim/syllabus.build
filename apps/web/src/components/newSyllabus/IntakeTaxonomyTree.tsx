import type { VNode } from "preact";
import { SfIcon } from "../Icons.tsx";
import {
  INTAKE_SUBJECTS,
  SUBJECT_TOPIC_TAXONOMY,
  subjectIcon,
  type IntakeSubject,
} from "./taxonomy.ts";
import type { IntakeResourceFitEvaluation } from "./indexing.ts";

export interface IntakeTaxonomyTreeProps {
  readonly subject: IntakeSubject;
  readonly requestedTopics: readonly string[];
  readonly fitEvaluation: IntakeResourceFitEvaluation;
}

export function IntakeTaxonomyTree({
  subject,
  requestedTopics,
  fitEvaluation,
}: IntakeTaxonomyTreeProps): VNode {
  const taxonomy = SUBJECT_TOPIC_TAXONOMY[subject];
  const disclosedSubtopics: { readonly topic: string; readonly parentTopic: string }[] = [];
  const seenSubtopics = new Set<string>();

  for (const [parentTopic, subs] of Object.entries(taxonomy.subtopicsByParent)) {
    if (requestedTopics.includes(parentTopic)) {
      for (const sub of subs) {
        if (!seenSubtopics.has(sub)) {
          seenSubtopics.add(sub);
          disclosedSubtopics.push({ topic: sub, parentTopic });
        }
      }
    }
  }

  return (
    <div class="intake-taxonomy-tree" role="group" aria-label="Subject and dependent topic tags">
      <div class="facet-row" data-tier="1" role="group" aria-labelledby="intake-subject-label">
        <span class="facet-label" id="intake-subject-label">
          Subject
        </span>
        <div class="facet-options" id="intake-subject-select">
          {INTAKE_SUBJECTS.map((subj) => {
            const active = subj === subject;
            return (
              <button
                key={subj}
                type="button"
                class="tag intake-subject-tag"
                data-action="set-intake-subject"
                data-intake-subject={subj}
                data-subject={subj}
                aria-pressed={active}
              >
                <SfIcon name={subjectIcon(subj)} size={15} />
                <span>{subj === "Mathematics" ? "Math" : subj}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="facet-row" data-tier="2" role="group" aria-labelledby="intake-topics-label">
        <span class="facet-label" id="intake-topics-label">
          Topics
        </span>
        <div
          class="facet-options"
          id="intake-topic-select"
          data-dependent-on-subject={subject}
        >
          {taxonomy.coreTopics.map((topic) => {
            const active = requestedTopics.includes(topic);
            const requiredBy = requestedTopics.filter(
              (other) => other !== topic && (taxonomy.prerequisitesByTopic[other] ?? []).includes(topic),
            );
            const childSubs = taxonomy.subtopicsByParent[topic] ?? [];
            const cov = fitEvaluation.topicCoverage.find((c) => c.topic === topic);
            const status = cov?.status ?? "covered";
            return (
              <button
                key={topic}
                type="button"
                class="tag intake-topic-tag"
                data-action="toggle-intake-topic"
                data-intake-topic={topic}
                data-topic-coverage={active ? status : undefined}
                data-topic-coverage-pill={active ? topic : undefined}
                data-coverage-state={active ? status : undefined}
                aria-pressed={active}
              >
                <span>{topic}</span>
                {active && requiredBy.length > 0 ? (
                  <span
                    class="tag-dep-badge"
                    title={`Prerequisite for ${requiredBy.join(", ")}`}
                  >
                    prereq
                  </span>
                ) : !active && childSubs.length > 0 ? (
                  <span class="tag-count" title={`Unlocks ${childSubs.join(", ")}`}>
                    +{childSubs.length}
                  </span>
                ) : null}
                {active ? <SfIcon name="close" size={15} /> : null}
              </button>
            );
          })}
          {requestedTopics.length > 0 ? (
            <button
              type="button"
              class="clear-filters intake-clear-topics-btn"
              data-action="clear-intake-topics"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {disclosedSubtopics.length > 0 ? (
        <div class="facet-row" data-tier="3" role="group" aria-labelledby="intake-subtopics-label">
          <span class="facet-label" id="intake-subtopics-label">
            Sub-topics
          </span>
          <div class="facet-options" data-dependent-subtopics-for={subject}>
            {disclosedSubtopics.map(({ topic, parentTopic }) => {
              const active = requestedTopics.includes(topic);
              const cov = fitEvaluation.topicCoverage.find((c) => c.topic === topic);
              const status = cov?.status ?? "covered";
              return (
                <button
                  key={topic}
                  type="button"
                  class="tag intake-subtopic-tag"
                  data-action="toggle-intake-topic"
                  data-intake-topic={topic}
                  data-parent-topic={parentTopic}
                  data-topic-coverage={active ? status : undefined}
                  data-topic-coverage-pill={active ? topic : undefined}
                  data-coverage-state={active ? status : undefined}
                  aria-pressed={active}
                >
                  <span>{topic}</span>
                  <span class="tag-dep-badge">via {parentTopic}</span>
                  {active ? <SfIcon name="close" size={15} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
