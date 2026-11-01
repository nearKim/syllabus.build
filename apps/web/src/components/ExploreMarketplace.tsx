import type { VNode } from "preact";
import type { Account } from "../auth.ts";
import { asRecord, rawListOf } from "../shared.ts";
import {
  type ActiveSyllabus,
  type Adoption,
  type MarketplaceListing,
  type MarketplaceSort,
  type MarketplaceFilters,
  type Vote,
} from "./marketplace/types.ts";
import {
  goalTitleOf,
  matchesFilters,
} from "./marketplace/filterEngine.ts";
import { MarketplaceFilterBar } from "./marketplace/MarketplaceFilterBar.tsx";
import { MarketplaceCardGrid } from "./marketplace/MarketplaceCardGrid.tsx";
import { CreatorDashboard } from "./marketplace/CreatorDashboard.tsx";

export { asRecord, rawListOf };

export {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_SUBJECTS,
  MARKETPLACE_DIFFICULTIES,
  MARKETPLACE_FORMATS,
  MARKETPLACE_FACETS,
  MARKETPLACE_SORTS,
  type MarketplaceFacet,
  type MarketplaceSort,
  type MarketplaceFilters,
  NO_MARKETPLACE_FILTERS,
  SORT_LABELS,
  PRIVATE_FIELDS_REMOVED,
  type MarketplaceListing,
  type Adoption,
  type Vote,
  type ActiveSyllabus,
} from "./marketplace/types.ts";

export {
  textOf,
  mathDepthFor,
  studyMinutesOf,
  goalTitleOf,
  publicProjectionOf,
  unitIdsOf,
  adoptionScopeOf,
  adoptedPlanOf,
  facetValuesOf,
  withMarketplaceFilter,
} from "./marketplace/filterEngine.ts";

export {
  type SyllabusTagDescriptor,
  syllabusTagsOf,
  SyllabusTagStrip,
  type SyllabusTagStripProps,
} from "./marketplace/SyllabusTagStrip.tsx";

export {
  MarketplaceFilterBar,
  type MarketplaceFilterBarProps,
} from "./marketplace/MarketplaceFilterBar.tsx";

export {
  MarketplaceCardGrid,
  type MarketplaceCardGridProps,
} from "./marketplace/MarketplaceCardGrid.tsx";

export {
  CreatorDashboard,
  type CreatorDashboardProps,
} from "./marketplace/CreatorDashboard.tsx";

export {
  AdoptSyllabusDialog,
  type AdoptSyllabusDialogProps,
} from "./marketplace/AdoptSyllabusDialog.tsx";

export {
  PublicationPreviewDialog,
  type PublicationPreviewDialogProps,
} from "./marketplace/PublicationPreviewDialog.tsx";

export interface ExploreMarketplaceProps {
  readonly active: boolean;
  readonly signedOut: boolean;
  readonly account: Account;
  readonly listings: readonly MarketplaceListing[];
  readonly myPlans: readonly ActiveSyllabus[];
  readonly votes: readonly Vote[];
  readonly adoptions: readonly Adoption[];
  readonly marketplaceFilters: MarketplaceFilters;
  readonly marketplaceSort: MarketplaceSort;
  readonly topicsExpanded: boolean;
  readonly loadMoreNote: string | null;
}

export function ExploreMarketplace({
  active,
  signedOut,
  account,
  listings,
  myPlans,
  votes,
  adoptions,
  marketplaceFilters: filters,
  marketplaceSort,
  topicsExpanded,
  loadMoreNote,
}: ExploreMarketplaceProps): VNode {
  const upvotesOf = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const rank = (listing: MarketplaceListing): number =>
    marketplaceSort === "top_upvoted"
      ? upvotesOf(listing)
      : marketplaceSort === "most_adopted"
        ? adoptionsOf(listing)
        : Date.parse(listing.publishedAt);
  const shownListings = listings
    .filter((listing) => matchesFilters(listing, filters))
    .sort((a, b) => rank(b) - rank(a) || goalTitleOf(a.syllabus).localeCompare(goalTitleOf(b.syllabus)));

  return (
    <section
      class="top-level-panel"
      id="panel-explore"
      data-top-panel="Explore"
      data-active={String(active)}
      hidden={!active}
    >
      <div class="section-header">
        <h1 class="page-title">Explore</h1>
        <div class="plan-toolbar">
          <button
            type="button"
            class="btn-secondary"
            data-action="open-dialog"
            data-dialog-id="dialog-publication-preview"
          >
            Share with Community
          </button>
        </div>
      </div>

      <MarketplaceFilterBar
        filters={filters}
        listings={listings}
        topicsExpanded={topicsExpanded}
      />

      <MarketplaceCardGrid
        shownListings={shownListings}
        totalCount={listings.length}
        filters={filters}
        marketplaceSort={marketplaceSort}
        myPlans={myPlans}
        votes={votes}
        adoptions={adoptions}
        signedOut={signedOut}
        account={account}
        loadMoreNote={loadMoreNote}
      />

      <CreatorDashboard
        signedOut={signedOut}
        account={account}
        listings={listings}
        myPlans={myPlans}
        votes={votes}
        adoptions={adoptions}
      />
    </section>
  );
}
