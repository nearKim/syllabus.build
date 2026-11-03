import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPLETE_SCREEN_INVENTORY,
  auditCompleteScreenInventory,
  buildFourBucketCostBreakdown,
  createAccountPrivacyController,
  createHostedBillingController,
  createPublicAdoptionController,
  createPublicationLifecycleController,
  evaluateScreenRoleAccess,
  formatMinorCurrency,
  getVisibleNavigationScreens,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(
  __dirname,
  "../../../specs/001-syllabus-platform/examples"
);

function readExampleJson(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(EXAMPLES_DIR, fileName), "utf8")
  );
}

test("T07B & T07D: 4-bucket cost separation, unknown price handling (@S06), wallet reservations, settlement, and D07 checkout gate", () => {
  assert.equal(
    formatMinorCurrency(null, "USD"),
    "Price unknown (verify externally)"
  );
  assert.equal(formatMinorCurrency(1250, "USD"), "$12.50");

  const costBreakdown = buildFourBucketCostBreakdown({
    theme: "light",
    appServiceAccessMinor: 0,
    inferenceMode: "byok",
    inferenceQuoteMinor: 185,
    materials: [
      {
        resourceId: "book-1",
        title: "Open Textbook",
        required: true,
        currency: "USD",
        costMinor: 0,
      },
      {
        resourceId: "book-2",
        title: "Third-Party Reference Manual",
        required: false,
        currency: "USD",
        costMinor: null,
      },
    ],
    certificationAndComputeMinor: 2500,
    currency: "USD",
  });

  assert.equal(costBreakdown.surface.opaque, true);
  assert.equal(costBreakdown.hasAnyUnknownPrice, true);
  assert.equal(
    costBreakdown.buckets.learning_materials.hasUnknownPrices,
    true
  );
  assert.equal(
    costBreakdown.buckets.learning_materials.lineItems[1].formattedAmount,
    "Price unknown (verify externally)"
  );
  assert.ok(
    !costBreakdown.buckets.learning_materials.lineItems[1].formattedAmount.includes(
      "$0"
    )
  );
  assert.equal(
    costBreakdown.buckets.ai_inference.billingMechanism,
    "external_byok_provider"
  );
  assert.equal(costBreakdown.buckets.ai_inference.isNonBindingEstimate, true);
  assert.ok(costBreakdown.byokEstimateDisclaimer?.includes("BYOK"));

  const billing = createHostedBillingController({
    wallet: {
      currency: "USD",
      available_minor: 1500,
      reserved_minor: 0,
      live_billing_enabled: true,
      updated_at: "2026-03-31T10:00:00Z",
    },
  });

  billing.registerQuote({
    quote_id: "synthetic-quote-001",
    mode: "hosted",
    currency: "USD",
    estimated_cost_minor: 320,
    max_charge_minor: 500,
    expires_at: "2026-03-31T11:00:00Z",
  });

  const reserveReq = billing.buildReserveInferenceBudgetRequest({
    quoteId: "synthetic-quote-001",
    reservationId: "synthetic-reservation-001",
    idempotencyKey: "idem-reserve-001",
    nowIso: "2026-03-31T10:05:00Z",
  });

  assert.equal(reserveReq.headers["Idempotency-Key"], "idem-reserve-001");
  assert.equal(reserveReq.wallet.available_minor, 1000);
  assert.equal(reserveReq.wallet.reserved_minor, 500);

  const hostedGenFixture = readExampleJson(
    "generation-request.hosted.synthetic.json"
  );
  const startGenReq = billing.buildHostedGenerationRequest({
    request: hostedGenFixture,
    quoteId: "synthetic-quote-001",
    reservationId: "synthetic-reservation-001",
    idempotencyKey: "idem-gen-hosted-001",
  });
  assert.equal(startGenReq.headers["Idempotency-Key"], "idem-gen-hosted-001");
  assert.equal(startGenReq.body.quote_id, "synthetic-quote-001");
  assert.equal(startGenReq.body.reservation_id, "synthetic-reservation-001");
  assert.deepEqual(startGenReq.body.request, hostedGenFixture);

  // Settlement cannot exceed reserved budget (@S16)
  assert.throws(
    () =>
      billing.settleReservation({
        reservationId: "synthetic-reservation-001",
        actualSettledMinor: 600,
      }),
    /cannot exceed reserved budget/
  );

  const settled = billing.settleReservation({
    reservationId: "synthetic-reservation-001",
    actualSettledMinor: 350,
    occurredAt: "2026-03-31T10:08:00Z",
  });
  assert.equal(settled.wallet.available_minor, 1150);
  assert.equal(settled.wallet.reserved_minor, 0);
  assert.equal(settled.reservation.released_minor, 150);

  const checkoutReq = billing.buildCreateCheckoutSessionRequest({
    packId: "pack-standard-1000",
    creditAmountMinor: 1000,
    successUrl: "https://app.example/billing/success",
    cancelUrl: "https://app.example/billing/cancel",
    idempotencyKey: "idem-checkout-001",
  });
  assert.equal(checkoutReq.headers["Idempotency-Key"], "idem-checkout-001");

  const state = billing.getState();
  assert.equal(state.invariantViolations.length, 0);
  assert.equal(state.ledger.length, 2);
  assert.equal(state.usage.length, 1);

  // D07 release gate check when live_billing_enabled is false
  const gatedBilling = createHostedBillingController({
    wallet: {
      currency: "USD",
      available_minor: 500,
      reserved_minor: 0,
      live_billing_enabled: false,
      updated_at: "2026-03-31T10:00:00Z",
    },
  });
  assert.throws(
    () =>
      gatedBilling.buildCreateCheckoutSessionRequest({
        packId: "pack-standard-1000",
        creditAmountMinor: 1000,
        successUrl: "https://app.example/billing/success",
        cancelUrl: "https://app.example/billing/cancel",
        idempotencyKey: "idem-checkout-002",
      }),
    /LIVE_BILLING_DISABLED/
  );
});

test("T13: Publication preview confirmation, mutation invalidation, owner management null-field quarantine handling, and revision upvotes", () => {
  const previewFixture = readExampleJson("publication-preview.synthetic.json");
  const ownedPubsFixture = readExampleJson("owned-publications.synthetic.json");
  const ownedRevsFixture = readExampleJson(
    "owned-publication-revisions.synthetic.json"
  );

  const controller = createPublicationLifecycleController({
    preview: previewFixture,
    ownedPublications: ownedPubsFixture.items,
    ownedRevisions: ownedRevsFixture.items,
  });

  const initialState = controller.getState();
  assert.equal(initialState.cachePolicy, "private, no-store");
  assert.ok(initialState.excludedPrivateFields.includes("learner_notes"));
  assert.ok(initialState.excludedPrivateFields.includes("attempt_history"));

  // Quarantined item with null display_title and null current_revision_upvote_count must NOT fabricate 0
  const quarantinedCard = initialState.ownedPublicationCards.find(
    (c) => c.publicationId === "publication-quarantined"
  );
  assert.ok(quarantinedCard);
  assert.equal(quarantinedCard.isTitleWithheld, true);
  assert.equal(quarantinedCard.displayTitleText, "Withheld pending moderation");
  assert.equal(quarantinedCard.isUpvoteCountWithheld, true);
  assert.equal(
    quarantinedCard.upvoteDisplayText,
    "Withheld pending moderation"
  );

  // Publishing without accepting terms fails
  assert.throws(
    () =>
      controller.buildPublishSyllabusRequest({
        idempotencyKey: "idem-pub-001",
      }),
    /TERMS_REQUIRED/
  );

  controller.setPublicationTermsAccepted(true);
  const publishReq = controller.buildPublishSyllabusRequest({
    idempotencyKey: "idem-pub-001",
  });
  assert.equal(publishReq.headers["Idempotency-Key"], "idem-pub-001");
  assert.equal(
    publishReq.body.expected_preview_sha256,
    previewFixture.preview_sha256
  );
  assert.equal(publishReq.body.accept_publication_terms, true);

  // Mutating preview-affecting metadata invalidates confirmation until a fresh preview is loaded (@S79, @S83)
  controller.mutateDraftMetadata({ title: "Edited Title After Preview" });
  assert.equal(controller.getState().isPreviewStale, true);
  assert.throws(
    () =>
      controller.buildPublishSyllabusRequest({
        idempotencyKey: "idem-pub-002",
      }),
    /PREVIEW_STALE/
  );

  // Unpublish requires If-Match bound to management_version_id
  const unpublishReq = controller.buildUnpublishSyllabusRequest({
    publicationId: "publication-001",
    confirmUnpublish: true,
  });
  assert.equal(unpublishReq.headers["If-Match"], "management-001");

  // Revision-specific upvote optimistic toggle and rollback
  controller.registerPublicRevisionVoteState({
    publicationId: "publication-synthetic-001",
    publicationRevisionId: "public-revision-synthetic-001",
    upvoteCount: 0,
    viewerHasUpvoted: false,
  });
  const voteAction = controller.toggleRevisionUpvoteOptimistically({
    publicationId: "publication-synthetic-001",
    publicationRevisionId: "public-revision-synthetic-001",
  });
  assert.equal(voteAction.operationId, "setMyUpvote");
  assert.equal(voteAction.optimisticState.viewerHasUpvoted, true);
  assert.equal(voteAction.optimisticState.upvoteCount, 1);

  const rolledBack = voteAction.rollback();
  assert.equal(rolledBack.viewerHasUpvoted, false);
  assert.equal(rolledBack.upvoteCount, 0);

  // Sign-out purge clears private owner state (@S84)
  controller.clearOnSignOutOrAccountSwitch();
  assert.equal(controller.getState().ownedPublicationCards.length, 0);
  assert.equal(controller.getState().currentPreview, null);
});

test("T13: Full and partial adoption with transitive prerequisite closure across deterministic, hosted, and BYOK modes", () => {
  const publicSyllabus = readExampleJson("public-syllabus.synthetic.json");
  const detFixture = readExampleJson("adoption-request.synthetic.json");
  const hostedFixture = readExampleJson(
    "adoption-request.hosted.synthetic.json"
  );
  const byokFixture = readExampleJson("adoption-request.byok.synthetic.json");

  // Extend public syllabus with a dependent module & prerequisite edge to verify transitive prerequisite resolution
  const multiModuleSyllabus = {
    ...publicSyllabus,
    content: {
      ...publicSyllabus.content,
      objectives: [
        ...publicSyllabus.content.objectives,
        {
          objective_id: "objective-bpe",
          title: "Train a BPE vocabulary",
        },
      ],
      prerequisite_edges: [
        {
          from_objective_id: "objective-tokenization",
          to_objective_id: "objective-bpe",
        },
      ],
      modules: [
        ...publicSyllabus.content.modules,
        {
          module_id: "public-module-bpe",
          title: "Subword BPE & Unigram Tokenizers",
          objective_ids: ["objective-bpe"],
          activity_ids: [],
        },
      ],
    },
  };

  const adoption = createPublicAdoptionController(multiModuleSyllabus);
  const partialScope = adoption.resolveScope(["public-module-bpe"]);
  assert.deepEqual(partialScope.resolvedModuleIds, [
    "public-module-tokenization",
    "public-module-bpe",
  ]);
  assert.deepEqual(partialScope.autoIncludedPrerequisiteModuleIds, [
    "public-module-tokenization",
  ]);
  assert.deepEqual(partialScope.autoIncludedPrerequisiteObjectiveIds, [
    "objective-tokenization",
  ]);

  // 1. Deterministic full adoption matches adoption-request.synthetic.json
  const fullAdapter = createPublicAdoptionController(publicSyllabus);
  const detReq = fullAdapter.buildAdoptionRequest({
    idempotencyKey: "idem-adopt-det-001",
    basePlanningOrRequest: detFixture.planning,
    execution: { mode: "deterministic" },
  });
  assert.equal(detReq.requiresAiCredentials, false);
  assert.equal(detReq.requiresCreditReservation, false);
  assert.equal(detReq.headers["Idempotency-Key"], "idem-adopt-det-001");
  assert.deepEqual(detReq.body, detFixture);

  // 2. Hosted generative adoption matches adoption-request.hosted.synthetic.json
  const hostedReq = fullAdapter.buildAdoptionRequest({
    idempotencyKey: "idem-adopt-hosted-001",
    basePlanningOrRequest: hostedFixture.request,
    execution: {
      mode: "generate_hosted",
      model_policy_id: hostedFixture.request.inference.model_policy_id,
      inferenceBudget: hostedFixture.request.budgets.inference,
      quote_id: hostedFixture.quote_id,
      reservation_id: hostedFixture.reservation_id,
    },
  });
  assert.equal(hostedReq.requiresCreditReservation, true);
  assert.deepEqual(hostedReq.body, hostedFixture);

  // 3. BYOK generative adoption matches adoption-request.byok.synthetic.json
  const byokReq = fullAdapter.buildAdoptionRequest({
    idempotencyKey: "idem-adopt-byok-001",
    basePlanningOrRequest: byokFixture.request,
    execution: {
      mode: "generate_byok",
      provider_id: byokFixture.request.inference.provider_id,
      credential_ref: byokFixture.request.inference.credential_ref,
      credential_version_ref:
        byokFixture.request.inference.credential_version_ref,
      model_policy_id: byokFixture.request.inference.model_policy_id,
      allow_hosted_fallback: false,
      inferenceBudget: byokFixture.request.budgets.inference,
    },
  });
  assert.equal(byokReq.requiresAiCredentials, true);
  assert.equal(byokReq.requiresCreditReservation, false);
  assert.deepEqual(byokReq.body, byokFixture);
});

test("T14-Full & T09: Complete screen inventory, role boundaries (@S88), WCAG 2.2 AA audit, and account export/deletion flows", () => {
  assert.equal(COMPLETE_SCREEN_INVENTORY.length, 15);

  const auditReport = auditCompleteScreenInventory();
  assert.equal(auditReport.automatedChecksPass, true);
  assert.equal(auditReport.replacesManualWcagEvaluation, false);
  assert.equal(auditReport.manualEvaluationMatrix.parts.length, 8);

  // Role boundary checks (@S88)
  const learnerVisible = getVisibleNavigationScreens(["User"]);
  assert.equal(
    learnerVisible.every((s) => !s.isInternalOperationalRoute),
    true
  );

  const deniedModeratorRoute = evaluateScreenRoleAccess(
    "moderator_publication_quarantine_queue",
    ["User"]
  );
  assert.equal(deniedModeratorRoute.allowed, false);
  assert.equal(deniedModeratorRoute.statusCode, 403);

  const allowedModeratorRoute = evaluateScreenRoleAccess(
    "moderator_publication_quarantine_queue",
    ["Admin"]
  );
  assert.equal(allowedModeratorRoute.allowed, true);
  assert.equal(allowedModeratorRoute.statusCode, 200);

  // T09 Account export & deletion controller
  const privacy = createAccountPrivacyController({ theme: "dark" });
  const exportReq = privacy.buildCreateAccountExportRequest({
    idempotencyKey: "idem-export-001",
  });
  assert.equal(exportReq.headers["Idempotency-Key"], "idem-export-001");
  assert.equal(exportReq.path, "/me/exports");

  // Unconfirmed deletion is rejected
  assert.throws(
    () =>
      privacy.buildCreateAccountDeletionRequest({
        idempotencyKey: "idem-del-001",
      }),
    /DELETION_CONFIRMATION_REQUIRED/
  );

  privacy.setExplicitDeletionConfirmed(true);
  const deletionReq = privacy.buildCreateAccountDeletionRequest({
    idempotencyKey: "idem-del-001",
    reason: "Completed study goal",
  });
  assert.equal(deletionReq.headers["Idempotency-Key"], "idem-del-001");
  assert.equal(deletionReq.body.confirm_deletion, true);

  const privacyState = privacy.getState();
  assert.equal(privacyState.destructiveSurface.opaque, true);
  assert.equal(privacyState.clientStatePurged, true);
  assert.ok(
    privacyState.disclosures.byokDeletionVsProviderRevocation.includes(
      "does not revoke the key at your AI provider"
    )
  );
});

test("T13 Adversarial: resolveTransitiveAdoptionScope safely handles cyclic module and objective graphs without stack overflow", () => {
  const cyclicSyllabus = {
    content: {
      objectives: [
        { objective_id: "obj-1", prerequisite_objective_ids: ["obj-2"] },
        { objective_id: "obj-2", prerequisite_objective_ids: ["obj-1"] },
      ],
      prerequisite_edges: [
        { from_objective_id: "obj-1", to_objective_id: "obj-2" },
        { from_objective_id: "obj-2", to_objective_id: "obj-1" },
      ],
      modules: [
        {
          module_id: "mod-1",
          prerequisite_module_ids: ["mod-2"],
          objective_ids: ["obj-1"],
        },
        {
          module_id: "mod-2",
          prerequisite_module_ids: ["mod-1"],
          objective_ids: ["obj-2"],
        },
      ],
    },
  };
  const adoption = createPublicAdoptionController(cyclicSyllabus);
  const scope = adoption.resolveScope(["mod-1"]);
  assert.ok(scope.resolvedModuleIds.includes("mod-1"));
  assert.ok(scope.resolvedModuleIds.includes("mod-2"));
});

