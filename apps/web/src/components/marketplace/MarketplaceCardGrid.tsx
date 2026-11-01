import type { VNode } from "preact";
import type { Account } from "../../auth.ts";
import { SfIcon } from "../Icons.tsx";
import { isOneOf } from "../StudyFlowBoard.tsx";
import { FilterTag } from "./MarketplaceFilterBar.tsx";
import {
  FACET_LABELS,
  MARKETPLACE_SORTS,
  SORT_LABELS,
  SUBJECT_TAGS,
  tagLabelOf,
  type ActiveSyllabus,
  type Adoption,
  type MarketplaceFacet,
  type MarketplaceFilters,
  type MarketplaceListing,
  type MarketplaceSort,
  type Vote,
} from "./types.ts";
import {
  goalTitleOf,
  listingTagsOf,
  publicProjectionOf,
} from "./filterEngine.ts";

export interface MarketplaceCardGridProps {
  readonly shownListings: readonly MarketplaceListing[];
  readonly totalCount: number;
  readonly filters: MarketplaceFilters;
  readonly marketplaceSort: MarketplaceSort;
  readonly myPlans: readonly ActiveSyllabus[];
  readonly votes: readonly Vote[];
  readonly adoptions: readonly Adoption[];
  readonly signedOut: boolean;
  readonly account: Account;
  readonly loadMoreNote: string | null;
}

export function MarketplaceCardGrid({
  shownListings,
  totalCount,
  filters,
  marketplaceSort,
  myPlans,
  votes,
  adoptions,
  signedOut,
  account,
  loadMoreNote,
}: MarketplaceCardGridProps): VNode {
  const upvotesOf = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const planOf = (listing: MarketplaceListing): ActiveSyllabus | undefined =>
    myPlans.find((plan) => plan.publicationId === listing.publicationId || plan.syllabusId === listing.sourceSyllabusId);

  // The trail lists the chosen tiers in taxonomy order, then the chosen facets.
  const chosenTiers = (["category", "subject", "topic"] as const).filter((facet) => filters[facet] !== "All");
  const chosenFacets = (["difficulty", "format"] as const).filter((facet) => filters[facet] !== "All");
  const filtered = chosenTiers.length + chosenFacets.length > 0 || filters.query !== "";

  const clearButton = (
    <button type="button" class="clear-filters" data-action="clear-marketplace-filters">
      Clear filters
    </button>
  );

  const trailStep = (facet: MarketplaceFacet): VNode => (
    <li key={facet} class="trail-step" data-facet={facet}>
      <button
        type="button"
        class="trail-chip"
        data-action="set-marketplace-filter"
        data-facet={facet}
        data-value="All"
        aria-label={`Remove ${FACET_LABELS[facet]}: ${tagLabelOf(filters[facet])}`}
      >
        {tagLabelOf(filters[facet])}
        <SfIcon name="close" size={15} />
      </button>
    </li>
  );

  return (
    <>
      <div class="marketplace-results-bar">
        <div class="marketplace-trail">
          <p class="marketplace-count" role="status">
            {filtered
              ? `${shownListings.length} of ${totalCount} syllabi`
              : `${totalCount} syllab${totalCount === 1 ? "us" : "i"}`}
          </p>
          {filtered ? (
            <>
              <ul class="filter-trail" aria-label="Active filters">
                {chosenTiers.length > 0 ? (
                  <li class="trail-path">
                    <ol class="trail-tiers" aria-label="Category path">
                      {chosenTiers.map(trailStep)}
                    </ol>
                  </li>
                ) : null}
                {chosenFacets.map(trailStep)}
                {filters.query ? (
                  <li class="trail-step" data-facet="query">
                    <button
                      type="button"
                      class="trail-chip"
                      data-action="set-marketplace-query"
                      data-query=""
                      aria-label={`Remove search: ${filters.query}`}
                    >
                      “{filters.query}”
                      <SfIcon name="close" size={15} />
                    </button>
                  </li>
                ) : null}
              </ul>
              {clearButton}
            </>
          ) : null}
        </div>
        <div class="marketplace-sort" role="group" aria-label="Sort">
          {MARKETPLACE_SORTS.map((sort) => (
            <button
              key={sort}
              type="button"
              class="sort-btn"
              data-action="set-marketplace-sort"
              data-sort={sort}
              aria-pressed={sort === marketplaceSort}
            >
              {SORT_LABELS[sort]}
            </button>
          ))}
        </div>
      </div>

      {shownListings.length > 0 ? (
        <div class="marketplace-grid">
          {shownListings.map((listing) => {
            const id = listing.publicationId;
            const projection = publicProjectionOf(listing.syllabus);
            const yours = !signedOut && listing.ownerAccountId === account.accountId;
            const myPlan = planOf(listing);
            const voted =
              !signedOut && votes.some((vote) => vote.revisionId === listing.revisionId && vote.accountId === account.accountId);
            const units = projection.modules.length;
            const upvotes = upvotesOf(listing);
            const tags = listingTagsOf(listing);
            const { difficulty, format } = tags;
            return (
              <article
                key={id}
                class="marketplace-card public-template-card"
                data-publication-id={id}
                data-revision-id={listing.revisionId}
                data-subject={tags.subject}
                aria-labelledby={`listing-${id}-title`}
                data-opaque-surface="true"
              >
                <div class="marketplace-card-head">
                  <span class="marketplace-card-icon" aria-hidden="true">
                    <SfIcon name={tags.subjectIcon} />
                  </span>
                  {isOneOf(SUBJECT_TAGS, tags.subject) ? (
                    <FilterTag facet="subject" value={tags.subject} filters={filters} />
                  ) : null}
                  {difficulty ? <FilterTag facet="difficulty" value={difficulty} filters={filters} /> : null}
                  {format ? <FilterTag facet="format" value={format} filters={filters} /> : null}
                </div>
                <div class="marketplace-card-body">
                  <h2 id={`listing-${id}-title`} class="marketplace-title">
                    {projection.title}
                  </h2>
                  <p class="marketplace-summary">{projection.summary}</p>
                </div>
                <div class="marketplace-topics">
                  {tags.topicTags.map((topic) => (
                    <FilterTag key={topic} facet="topic" value={topic} filters={filters} />
                  ))}
                </div>
                <p class="marketplace-meta">
                  <span class="marketplace-handle">{listing.handle}</span>
                  {listing.basedOn ? ` · based on ${listing.basedOn}` : ""} · {units} unit{units === 1 ? "" : "s"} · {adoptionsOf(listing)} adopted
                </p>
                <div class="marketplace-card-foot">
                  <button
                    type="button"
                    class="upvote-btn"
                    data-action="toggle-upvote"
                    data-publication-id={id}
                    data-revision-id={listing.revisionId}
                    aria-pressed={voted}
                    aria-label={`Upvote (${upvotes})`}
                  >
                    <SfIcon name="upvote" />
                    <span class="upvote-count">{upvotes}</span>
                  </button>
                  {yours || myPlan ? <span class="owned-badge">{yours ? "Yours" : "In your plans"}</span> : null}
                  {myPlan ? (
                    <button
                      type="button"
                      class="btn-secondary"
                      data-action="open-syllabus-plan"
                      data-syllabus-id={myPlan.syllabusId}
                    >
                      Open
                    </button>
                  ) : yours ? null : (
                    <button type="button" class="btn-primary" data-action="open-adopt-dialog" data-publication-id={id}>
                      Details
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div class="empty-state marketplace-empty">
          <SfIcon name="explore" />
          <span>No syllabi match these filters.</span>
          {clearButton}
        </div>
      )}

      <p class="meta-text marketplace-note">
        Community publications have not automatically passed educational review.
      </p>
      <div class="action-row load-more-row">
        <button type="button" class="btn-secondary" data-action="load-more">
          Load more
        </button>
      </div>
      {loadMoreNote ? (
        <p class="prose" role="status">
          {loadMoreNote}
        </p>
      ) : null}
    </>
  );
}
