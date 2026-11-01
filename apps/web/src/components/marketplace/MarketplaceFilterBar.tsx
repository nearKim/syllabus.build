import type { ComponentChildren, VNode } from "preact";
import { SfIcon } from "../Icons.tsx";
import {
  CATEGORY_TAGS,
  DIFFICULTY_TAGS,
  FACET_LABELS,
  FORMAT_TAGS,
  MARKETPLACE_CATEGORIES,
  SUBJECT_ICONS,
  SUBJECTS_BY_CATEGORY,
  tagLabelOf,
  TOPIC_PREVIEW,
  type MarketplaceFacet,
  type MarketplaceFilters,
  type MarketplaceListing,
} from "./types.ts";
import {
  inTiers,
  listingTagsOf,
  matchesFilters,
  withMarketplaceFilter,
} from "./filterEngine.ts";

export interface FilterTagProps {
  readonly facet: Exclude<MarketplaceFacet, "category">;
  readonly value: string;
  readonly filters: MarketplaceFilters;
  readonly count?: number;
}

// A tag sets its filter. Pressing the tag that is already active clears that filter.
// In the filter panel a tag shows its result count. On a card it has no count.
export function FilterTag({ facet, value, filters, count }: FilterTagProps): VNode {
  const pressed = filters[facet] === value;
  const label = tagLabelOf(value);
  const onCard = count === undefined;
  return (
    <button
      type="button"
      class="tag"
      data-action="set-marketplace-filter"
      data-facet={facet}
      data-value={pressed ? "All" : value}
      data-subject={facet === "subject" && !onCard ? value : undefined}
      aria-pressed={pressed}
      aria-label={onCard ? `Filter by ${label}` : undefined}
      disabled={count === 0 && !pressed}
    >
      {facet === "subject" && !onCard ? <SfIcon name={SUBJECT_ICONS[value] ?? "course"} size={15} /> : null}
      {label}
      {onCard ? null : pressed ? <SfIcon name="close" size={15} /> : <span class="tag-count">{count}</span>}
    </button>
  );
}

export interface FacetRowProps {
  readonly facet: MarketplaceFacet;
  readonly tier?: 1 | 2 | 3;
  readonly children: ComponentChildren;
}

export function FacetRow({ facet, tier, children }: FacetRowProps): VNode {
  return (
    <div class="facet-row" data-tier={tier} role="group" aria-labelledby={`facet-${facet}-label`}>
      <span class="facet-label" id={`facet-${facet}-label`}>
        {FACET_LABELS[facet]}
      </span>
      <div class="facet-options">{children}</div>
    </div>
  );
}

export interface MarketplaceFilterBarProps {
  readonly filters: MarketplaceFilters;
  readonly listings: readonly MarketplaceListing[];
  readonly topicsExpanded: boolean;
}

export function MarketplaceFilterBar({
  filters,
  listings,
  topicsExpanded,
}: MarketplaceFilterBarProps): VNode {
  // A count is the number of results that choosing the value gives, after the tier rules apply.
  const countIf = (facet: MarketplaceFacet, value: string): number => {
    const next = withMarketplaceFilter(filters, facet, value, listings);
    return listings.filter((listing) => matchesFilters(listing, next)).length;
  };

  const shownCategories = filters.category === "All" ? CATEGORY_TAGS : [filters.category];

  // Topics rank by result count, then by name. A long list shows only its first topics until the learner asks
  // for all of them, and the chosen topic always stays in view. A "1 more" button would only replace one tag.
  const topics = [
    ...new Set(listings.filter((listing) => inTiers(listing, filters)).flatMap((listing) => listingTagsOf(listing).topicTags)),
  ]
    .map((topic) => ({ topic, count: countIf("topic", topic) }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  const topicsOverflow = topics.length > TOPIC_PREVIEW + 1;
  const shownTopics =
    topicsOverflow && !topicsExpanded
      ? topics.filter(({ topic }, index) => index < TOPIC_PREVIEW || topic === filters.topic)
      : topics;

  return (
    <>
      <form class="marketplace-search" role="search" data-action="set-marketplace-query">
        <label class="st-sr" for="marketplace-search">
          Search Community Syllabi
        </label>
        <input
          id="marketplace-search"
          type="search"
          name="query"
          value={filters.query}
          placeholder="Search titles, topics, and curators"
          autocomplete="off"
        />
        <button type="submit" class="btn-secondary">
          Search
        </button>
      </form>

      <div class="marketplace-filters" role="group" aria-label="Filters">
        <FacetRow facet="category" tier={1}>
          {MARKETPLACE_CATEGORIES.map((category) => {
            const count = countIf("category", category);
            return (
              <button
                key={category}
                type="button"
                class="category-btn"
                data-action="set-marketplace-filter"
                data-facet="category"
                data-value={category}
                aria-pressed={filters.category === category}
                disabled={count === 0 && filters.category !== category}
              >
                {category}
                <span class="tag-count">{count}</span>
              </button>
            );
          })}
        </FacetRow>

        <FacetRow facet="subject" tier={2}>
          {shownCategories.flatMap((category) => SUBJECTS_BY_CATEGORY[category]).map((subject) => (
            <FilterTag key={subject} facet="subject" value={subject} filters={filters} count={countIf("subject", subject)} />
          ))}
        </FacetRow>

        <FacetRow facet="topic" tier={3}>
          {topicsOverflow ? (
            <form class="topic-finder" data-action="set-marketplace-filter">
              <label class="st-sr" for="marketplace-topic">
                Find a topic
              </label>
              <input type="hidden" name="facet" value="topic" />
              <input
                id="marketplace-topic"
                type="search"
                name="value"
                list="marketplace-topic-list"
                placeholder="Find a topic"
                autocomplete="off"
              />
              <datalist id="marketplace-topic-list">
                {topics.map(({ topic }) => (
                  <option key={topic} value={topic} />
                ))}
              </datalist>
            </form>
          ) : null}
          {shownTopics.map(({ topic, count }) => (
            <FilterTag key={topic} facet="topic" value={topic} filters={filters} count={count} />
          ))}
          {topicsOverflow ? (
            <button type="button" class="facet-more" data-action="toggle-marketplace-topics" aria-expanded={topicsExpanded}>
              {topicsExpanded ? "Show fewer" : `Show ${topics.length - shownTopics.length} more`}
            </button>
          ) : null}
        </FacetRow>

        <div class="facet-pair">
          <FacetRow facet="difficulty">
            {DIFFICULTY_TAGS.map((difficulty) => (
              <FilterTag
                key={difficulty}
                facet="difficulty"
                value={difficulty}
                filters={filters}
                count={countIf("difficulty", difficulty)}
              />
            ))}
          </FacetRow>
          <FacetRow facet="format">
            {FORMAT_TAGS.map((format) => (
              <FilterTag key={format} facet="format" value={format} filters={filters} count={countIf("format", format)} />
            ))}
          </FacetRow>
        </div>
      </div>
    </>
  );
}
