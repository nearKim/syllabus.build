import type { VNode } from "preact";
import type { Account } from "../../auth.ts";
import { SfIcon, type SfIconName } from "../Icons.tsx";
import {
  type ActiveSyllabus,
  type Adoption,
  type MarketplaceListing,
  type Vote,
} from "./types.ts";
import {
  goalTitleOf,
  listingTagsOf,
  studyMinutesOf,
} from "./filterEngine.ts";

export interface CreatorDashboardProps {
  readonly signedOut: boolean;
  readonly account: Account;
  readonly listings: readonly MarketplaceListing[];
  readonly myPlans: readonly ActiveSyllabus[];
  readonly votes: readonly Vote[];
  readonly adoptions: readonly Adoption[];
}

export function CreatorDashboard({
  signedOut,
  account,
  listings,
  myPlans,
  votes,
  adoptions,
}: CreatorDashboardProps): VNode | null {
  if (signedOut) return null;

  const upvotesOf = (listing: MarketplaceListing): number =>
    listing.upvotes + votes.filter((vote) => vote.revisionId === listing.revisionId).length;
  const adoptionsOf = (listing: MarketplaceListing): number =>
    listing.adoptions + adoptions.filter((adoption) => adoption.publicationId === listing.publicationId).length;
  const studyHoursOf = (listing: MarketplaceListing): number =>
    Math.round((studyMinutesOf(listing.syllabus) * adoptionsOf(listing)) / 60);
  const planOf = (listing: MarketplaceListing): ActiveSyllabus | undefined =>
    myPlans.find((plan) => plan.publicationId === listing.publicationId || plan.syllabusId === listing.sourceSyllabusId);

  // A metric pill with an icon, a count, and its noun, such as "1 learner" or "142 learners". The number is bold.
  const impactPill = (icon: SfIconName, count: number, noun: string): VNode => (
    <span class="impact-pill">
      <SfIcon name={icon} />
      <span>
        <b>{count}</b> {count === 1 ? noun : `${noun}s`}
      </span>
    </span>
  );

  const ownedListings = listings.filter((listing) => listing.ownerAccountId === account.accountId);
  const published = ownedListings.length > 0;
  const ownedTotal = (countOf: (listing: MarketplaceListing) => number): number =>
    ownedListings.reduce((sum, listing) => sum + countOf(listing), 0);
  const learnersReached = ownedTotal(adoptionsOf);
  const hoursGifted = ownedTotal(studyHoursOf);
  const upvotesReceived = ownedTotal(upvotesOf);

  const shareButton = (label: string, kind: "btn-primary" | "btn-secondary"): VNode => (
    <button type="button" class={kind} data-action="open-dialog" data-dialog-id="dialog-publication-preview">
      {label}
    </button>
  );

  return (
    <section class="surface-panel my-publications" aria-labelledby="my-publications-title" data-opaque-surface="true">
      <div class="my-publications-head">
        <div>
          <h2 id="my-publications-title">My Publications</h2>
          {published ? (
            <p class="meta-text">
              Thank you for teaching in the open. Every adoption is a learner who studies your syllabus for free under CC BY 4.0.
            </p>
          ) : null}
        </div>
        {published ? shareButton("Share another syllabus", "btn-secondary") : null}
      </div>
      {published ? (
        <>
          {/* The same sentence as Settings › Your contributions: plain totals, no metric cards. */}
          <p class="impact-summary">
            Your shared {ownedListings.length === 1 ? "plan" : "plans"} reached{" "}
            <strong>
              {learnersReached} {learnersReached === 1 ? "learner" : "learners"}
            </strong>
            , who planned about{" "}
            <strong>
              {hoursGifted} {hoursGifted === 1 ? "study hour" : "study hours"}
            </strong>{" "}
            with {ownedListings.length === 1 ? "it" : "them"}.{" "}
            <strong>
              {upvotesReceived} {upvotesReceived === 1 ? "person" : "people"}
            </strong>{" "}
            upvoted your work.
          </p>
          <ul class="publication-list">
            {ownedListings.map((listing) => {
              const title = goalTitleOf(listing.syllabus);
              const myPlan = planOf(listing);
              const tags = listingTagsOf(listing);
              return (
                <li key={listing.publicationId} data-publication-id={listing.publicationId}>
                  <strong>{title}</strong>
                  <span class="publication-revision">Public · Revision 1</span>
                  <span class="marketplace-card-icon" data-subject={tags.subject} aria-hidden="true">
                    <SfIcon name={tags.subjectIcon} />
                  </span>
                  {tags.topicTags.length > 0 ? (
                    <span class="publication-topics">
                      {tags.topicTags.map((topic) => (
                        <span key={topic} class="tag">
                          {topic}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <p class="publication-impact">
                    {adoptionsOf(listing) > 0 ? (
                      <>
                        {impactPill("course", adoptionsOf(listing), "learner")}
                        {impactPill("clock", studyHoursOf(listing), "study hour")}
                        {impactPill("upvote", upvotesOf(listing), "upvote")}
                      </>
                    ) : (
                      <span class="impact-pill">
                        <SfIcon name="globe" />
                        <span>Live in Explore and ready for its first learner</span>
                      </span>
                    )}
                  </p>
                  <span class="publication-actions">
                    {myPlan ? (
                      <button
                        type="button"
                        class="btn-secondary"
                        data-action="open-syllabus-plan"
                        data-syllabus-id={myPlan.syllabusId}
                      >
                        Open
                      </button>
                    ) : null}
                    <button
                      type="button"
                      class="unpublish-btn"
                      data-action="open-dialog"
                      data-dialog-id="dialog-unpublish"
                      aria-label={`Unpublish ${title}`}
                    >
                      Unpublish
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div class="publish-invite">
          <div>
            <h3>Help the next learner start where you did</h3>
            <p class="prose meta-text">
              Publishing shares your plan's structure under CC BY 4.0, so any self-learner can adopt it for free. Your progress, notes, evidence, keys, billing, and session dates stay private.
            </p>
            {shareButton("Share your first syllabus", "btn-primary")}
          </div>
        </div>
      )}
    </section>
  );
}
