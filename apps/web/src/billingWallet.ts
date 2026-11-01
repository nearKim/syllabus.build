import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle, type ThemeMode } from "@syllabus/ui";

export type CostBucketId = "app_service_access" | "ai_inference" | "learning_materials" | "certification_and_compute";

export interface MaterialResourceCostItem {
  readonly resourceId: string; readonly title: string; readonly required: boolean;
  readonly currency: string; readonly costMinor: number | null | undefined;
}

export interface CostBucketDisclosure {
  readonly bucketId: CostBucketId; readonly label: string;
  readonly billingMechanism: "platform_subscription" | "hosted_credit_wallet" | "external_byok_provider" | "external_merchant" | "none";
  readonly knownTotalMinor: number; readonly currency: string;
  readonly isNonBindingEstimate: boolean; readonly hasUnknownPrices: boolean; readonly formattedSummary: string;
  readonly lineItems: readonly { readonly id: string; readonly label: string; readonly formattedAmount: string; readonly isUnknownPrice: boolean }[];
}

export interface FourBucketCostBreakdownView {
  readonly surface: ResolvedSurfaceStyle;
  readonly buckets: { readonly [P in CostBucketId]: CostBucketDisclosure };
  readonly hasAnyUnknownPrice: boolean; readonly byokEstimateDisclaimer: string | null;
}

export interface HostedCreditWalletSnapshot {
  readonly currency: string; readonly available_minor: number; readonly reserved_minor: number;
  readonly live_billing_enabled: boolean; readonly updated_at: string;
}

export interface GenerationQuoteSnapshot {
  readonly quote_id: string; readonly mode: "hosted" | "byok"; readonly currency: string;
  readonly estimated_cost_minor: number; readonly max_charge_minor: number; readonly expires_at: string;
}

export interface BudgetReservationSnapshot {
  readonly reservation_id: string; readonly quote_id: string;
  readonly reserved_minor: number; readonly settled_minor: number; readonly released_minor: number;
  readonly status: "active" | "settled" | "released" | "expired"; readonly expires_at: string;
}

export interface LedgerEntrySnapshot {
  readonly entry_id: string; readonly occurred_at: string;
  readonly entry_type: "credit_purchase" | "reservation_hold" | "settlement_debit" | "reservation_release" | "refund";
  readonly delta_minor: number; readonly balance_after_minor: number; readonly reference_id: string; readonly summary: string;
}

export interface UsageItemSnapshot {
  readonly usage_id: string;
  readonly operation_kind: "syllabus_generation" | "plan_adaptation" | "diagnostic_generation" | "generative_adoption";
  readonly inference_mode: "hosted" | "byok"; readonly quote_id: string | null; readonly reservation_id: string | null;
  readonly reserved_minor: number; readonly settled_minor: number; readonly released_minor: number; readonly occurred_at: string;
}

export interface HostedGenerationInnerRequest {
  readonly schema_version: string; readonly goal: Record<string, unknown>; readonly learner_profile: Record<string, unknown>;
  readonly constraints: Record<string, unknown>; readonly access_policy: Record<string, unknown>;
  readonly budgets: {
    readonly materials: { readonly currency: string; readonly max_minor_units: number };
    readonly compute: { readonly currency: string; readonly max_minor_units: number };
    readonly inference: { readonly currency: string; readonly max_minor_units: number };
  };
  readonly inference: { readonly mode: "hosted"; readonly model_policy_id: string };
  readonly generation_options: Record<string, unknown>; readonly instruction_preferences: Record<string, unknown>;
  readonly template_origin: Record<string, unknown> | null;
}

export function formatMinorCurrency(amountMinor: number | null | undefined, currency = "USD"): string {
  if (amountMinor === null || amountMinor === undefined) return "Price unknown (verify externally)";
  const sign = amountMinor < 0 ? "-" : "";
  const major = (Math.abs(amountMinor) / 100).toFixed(2);
  return currency === "USD" ? `${sign}$${major}` : `${sign}${major} ${currency}`;
}

export function buildFourBucketCostBreakdown(options: {
  readonly theme?: ThemeMode; readonly appServiceAccessMinor?: number;
  readonly inferenceMode: "deterministic" | "hosted" | "byok"; readonly inferenceQuoteMinor?: number;
  readonly materials: readonly MaterialResourceCostItem[]; readonly certificationAndComputeMinor?: number; readonly currency?: string;
}): FourBucketCostBreakdownView {
  const theme = options.theme ?? "light";
  const currency = options.currency ?? "USD";
  const appMinor = options.appServiceAccessMinor ?? 0;
  const certMinor = options.certificationAndComputeMinor ?? 0;
  const inferenceMinor = options.inferenceMode === "deterministic" ? 0 : (options.inferenceQuoteMinor ?? 0);

  let materialsKnownMinor = 0;
  let materialsHasUnknown = false;
  const materialLines = options.materials.map((item) => {
    const isUnknown = item.costMinor === null || item.costMinor === undefined;
    if (isUnknown) materialsHasUnknown = true;
    else materialsKnownMinor += item.costMinor;
    return {
      id: item.resourceId, label: item.title,
      formattedAmount: formatMinorCurrency(item.costMinor, item.currency || currency), isUnknownPrice: isUnknown,
    };
  });

  return {
    surface: resolveSurfaceStyle("pricing", { themePreference: theme }),
    buckets: {
      app_service_access: {
        bucketId: "app_service_access", label: "1. App Service Access", billingMechanism: "platform_subscription",
        knownTotalMinor: appMinor, currency, isNonBindingEstimate: false, hasUnknownPrices: false,
        formattedSummary: formatMinorCurrency(appMinor, currency),
        lineItems: [{ id: "app-access", label: "Platform workspace & offline sync access", formattedAmount: formatMinorCurrency(appMinor, currency), isUnknownPrice: false }],
      },
      ai_inference: {
        bucketId: "ai_inference", label: "2. AI Inference",
        billingMechanism: options.inferenceMode === "hosted" ? "hosted_credit_wallet" : options.inferenceMode === "byok" ? "external_byok_provider" : "none",
        knownTotalMinor: inferenceMinor, currency, isNonBindingEstimate: options.inferenceMode === "byok", hasUnknownPrices: false,
        formattedSummary:
          options.inferenceMode === "deterministic"
            ? "$0.00 (Deterministic — no AI inference used)"
            : options.inferenceMode === "byok"
              ? `~${formatMinorCurrency(inferenceMinor, currency)} (External provider estimate; not billed by platform)`
              : `${formatMinorCurrency(inferenceMinor, currency)} (Hosted credit reservation cap)`,
        lineItems: [{
          id: "inference-operation",
          label: options.inferenceMode === "deterministic" ? "Deterministic execution" : options.inferenceMode === "byok" ? "BYOK external provider token estimate" : "Hosted credit budget reservation",
          formattedAmount: formatMinorCurrency(inferenceMinor, currency), isUnknownPrice: false,
        }],
      },
      learning_materials: {
        bucketId: "learning_materials", label: "3. Learning Materials", billingMechanism: "external_merchant",
        knownTotalMinor: materialsKnownMinor, currency, isNonBindingEstimate: true, hasUnknownPrices: materialsHasUnknown,
        formattedSummary: materialsHasUnknown
          ? `${formatMinorCurrency(materialsKnownMinor, currency)} known + unknown external resource prices (never assumed $0)`
          : formatMinorCurrency(materialsKnownMinor, currency),
        lineItems: materialLines,
      },
      certification_and_compute: {
        bucketId: "certification_and_compute", label: "4. Certification & Compute", billingMechanism: "external_merchant",
        knownTotalMinor: certMinor, currency, isNonBindingEstimate: true, hasUnknownPrices: false,
        formattedSummary: formatMinorCurrency(certMinor, currency),
        lineItems: [{ id: "cert-compute", label: "External certification & sandbox compute", formattedAmount: formatMinorCurrency(certMinor, currency), isUnknownPrice: false }],
      },
    },
    hasAnyUnknownPrice: materialsHasUnknown,
    byokEstimateDisclaimer:
      options.inferenceMode === "byok"
        ? "BYOK cost figures are non-binding estimates billed directly by your external AI provider. No hosted wallet credits are reserved or debited."
        : null,
  };
}

export function createHostedBillingController(initial: {
  readonly wallet: HostedCreditWalletSnapshot; readonly ledger?: readonly LedgerEntrySnapshot[];
  readonly usage?: readonly UsageItemSnapshot[]; readonly theme?: ThemeMode;
}) {
  const theme = initial.theme ?? "light";
  let wallet: HostedCreditWalletSnapshot = { ...initial.wallet };
  const quotes = new Map<string, GenerationQuoteSnapshot>();
  const reservations = new Map<string, BudgetReservationSnapshot>();
  const ledger: LedgerEntrySnapshot[] = [...(initial.ledger ?? [])];
  const usage: UsageItemSnapshot[] = [...(initial.usage ?? [])];

  const getActiveReservation = (reservationId: string): BudgetReservationSnapshot => {
    const existing = reservations.get(reservationId);
    if (!existing || existing.status !== "active") throw new Error(`Reservation '${reservationId}' is not active.`);
    return existing;
  };

  return {
    registerQuote(quote: GenerationQuoteSnapshot): GenerationQuoteSnapshot {
      if (quote.max_charge_minor < quote.estimated_cost_minor) {
        throw new Error("Quote max_charge_minor cannot be less than estimated_cost_minor.");
      }
      quotes.set(quote.quote_id, quote);
      return quote;
    },
    buildReserveInferenceBudgetRequest(options: {
      readonly quoteId: string; readonly reservationId: string; readonly idempotencyKey: string; readonly nowIso?: string;
    }) {
      const quote = quotes.get(options.quoteId);
      if (!quote) throw new Error(`Unknown generation quote '${options.quoteId}'.`);
      if (quote.mode !== "hosted") throw new Error("BYOK quotes do not reserve or debit hosted wallet credits.");
      if (Date.parse(quote.expires_at) <= Date.parse(options.nowIso ?? new Date().toISOString())) {
        throw new Error(`Generation quote '${quote.quote_id}' has expired.`);
      }
      if (quote.max_charge_minor > wallet.available_minor) {
        throw new Error(`Insufficient hosted credits: required ${quote.max_charge_minor} minor units, available ${wallet.available_minor} minor units.`);
      }

      const headers = buildOperationHeaders("reserveInferenceBudget", { idempotencyKey: options.idempotencyKey });
      const reservation: BudgetReservationSnapshot = {
        reservation_id: options.reservationId, quote_id: quote.quote_id,
        reserved_minor: quote.max_charge_minor, settled_minor: 0, released_minor: 0, status: "active", expires_at: quote.expires_at,
      };
      const occurredAt = options.nowIso ?? wallet.updated_at;
      reservations.set(reservation.reservation_id, reservation);
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor - reservation.reserved_minor,
        reserved_minor: wallet.reserved_minor + reservation.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-hold-${reservation.reservation_id}`, occurred_at: occurredAt, entry_type: "reservation_hold",
        delta_minor: -reservation.reserved_minor, balance_after_minor: wallet.available_minor, reference_id: reservation.reservation_id,
        summary: `Reserved up to ${formatMinorCurrency(reservation.reserved_minor, wallet.currency)} for quote ${quote.quote_id}`,
      });

      return {
        operationId: "reserveInferenceBudget" as const, method: "POST" as const, path: "/usage/reservations",
        headers, body: { quote_id: quote.quote_id, max_reserved_minor: quote.max_charge_minor }, reservation, wallet,
      };
    },
    settleReservation(options: {
      readonly reservationId: string; readonly actualSettledMinor: number;
      readonly operationKind?: UsageItemSnapshot["operation_kind"]; readonly occurredAt?: string;
    }) {
      const existing = getActiveReservation(options.reservationId);
      if (options.actualSettledMinor < 0 || options.actualSettledMinor > existing.reserved_minor) {
        throw new Error(`Settlement (${options.actualSettledMinor}) cannot exceed reserved budget (${existing.reserved_minor}).`);
      }
      const releasedMinor = existing.reserved_minor - options.actualSettledMinor;
      const updated: BudgetReservationSnapshot = {
        ...existing, settled_minor: options.actualSettledMinor, released_minor: releasedMinor, status: "settled",
      };
      reservations.set(updated.reservation_id, updated);
      const occurredAt = options.occurredAt ?? wallet.updated_at;
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor + releasedMinor,
        reserved_minor: wallet.reserved_minor - existing.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-settle-${updated.reservation_id}`, occurred_at: occurredAt, entry_type: "settlement_debit",
        delta_minor: -options.actualSettledMinor, balance_after_minor: wallet.available_minor, reference_id: updated.reservation_id,
        summary: `Settled ${formatMinorCurrency(options.actualSettledMinor, wallet.currency)}; released ${formatMinorCurrency(releasedMinor, wallet.currency)} unused hold`,
      });
      usage.push({
        usage_id: `usage-${updated.reservation_id}`, operation_kind: options.operationKind ?? "syllabus_generation",
        inference_mode: "hosted", quote_id: updated.quote_id, reservation_id: updated.reservation_id,
        reserved_minor: updated.reserved_minor, settled_minor: updated.settled_minor, released_minor: updated.released_minor, occurred_at: occurredAt,
      });
      return { reservation: updated, wallet };
    },
    releaseReservation(options: {
      readonly reservationId: string; readonly reason?: "cancelled" | "failed" | "expired"; readonly occurredAt?: string;
    }) {
      const existing = getActiveReservation(options.reservationId);
      const updated: BudgetReservationSnapshot = {
        ...existing, settled_minor: 0, released_minor: existing.reserved_minor, status: options.reason === "expired" ? "expired" : "released",
      };
      reservations.set(updated.reservation_id, updated);
      const occurredAt = options.occurredAt ?? wallet.updated_at;
      wallet = {
        ...wallet,
        available_minor: wallet.available_minor + existing.reserved_minor,
        reserved_minor: wallet.reserved_minor - existing.reserved_minor,
        updated_at: occurredAt,
      };
      ledger.push({
        entry_id: `ledger-release-${updated.reservation_id}`, occurred_at: occurredAt, entry_type: "reservation_release",
        delta_minor: existing.reserved_minor, balance_after_minor: wallet.available_minor, reference_id: updated.reservation_id,
        summary: `Released full hold of ${formatMinorCurrency(existing.reserved_minor, wallet.currency)} (${options.reason ?? "released"})`,
      });
      return { reservation: updated, wallet };
    },
    buildHostedGenerationRequest(options: {
      readonly request: HostedGenerationInnerRequest; readonly quoteId: string; readonly reservationId: string; readonly idempotencyKey: string;
    }) {
      if (options.request.inference.mode !== "hosted") throw new Error("Expected hosted inference mode.");
      if (!options.quoteId.trim() || !options.reservationId.trim()) {
        throw new Error("Hosted generation requires both quoteId and reservationId.");
      }
      const activeReservation = reservations.get(options.reservationId);
      if (activeReservation && (activeReservation.status !== "active" || activeReservation.quote_id !== options.quoteId)) {
        throw new Error("Hosted generation reservationId must be active and match quoteId.");
      }
      return {
        operationId: "startGeneration" as const, method: "POST" as const, path: "/generations",
        headers: buildOperationHeaders("startGeneration", { idempotencyKey: options.idempotencyKey }),
        body: { request: options.request, quote_id: options.quoteId, reservation_id: options.reservationId },
      };
    },
    buildCreateCheckoutSessionRequest(options: {
      readonly packId: string; readonly creditAmountMinor: number; readonly successUrl: string; readonly cancelUrl: string; readonly idempotencyKey: string;
    }) {
      if (!wallet.live_billing_enabled) {
        throw new Error("LIVE_BILLING_DISABLED: Live billing checkout is disabled by the D07 release gate for this environment.");
      }
      if (!options.packId.trim() || options.creditAmountMinor <= 0) {
        throw new Error("Checkout session requires a valid packId and positive integer creditAmountMinor.");
      }
      return {
        operationId: "createBillingCheckoutSession" as const, method: "POST" as const, path: "/me/billing/checkout-sessions",
        headers: buildOperationHeaders("createBillingCheckoutSession", { idempotencyKey: options.idempotencyKey }),
        body: {
          pack_id: options.packId, credit_amount_minor: options.creditAmountMinor, currency: wallet.currency,
          success_url: options.successUrl, cancel_url: options.cancelUrl,
        },
      };
    },
    getState() {
      const invariantViolations: string[] = [];
      for (const item of usage) {
        if (item.settled_minor > item.reserved_minor) {
          invariantViolations.push(`Usage '${item.usage_id}' settled (${item.settled_minor}) exceeds reserved (${item.reserved_minor}).`);
        }
        if (item.inference_mode === "hosted" && item.settled_minor + item.released_minor !== item.reserved_minor) {
          invariantViolations.push(`Usage '${item.usage_id}' settled + released does not equal reserved_minor.`);
        }
      }
      return {
        surface: resolveSurfaceStyle("pricing", { themePreference: theme }),
        wallet,
        formattedAvailableBalance: formatMinorCurrency(wallet.available_minor, wallet.currency),
        formattedReservedBalance: formatMinorCurrency(wallet.reserved_minor, wallet.currency),
        liveBillingReleaseGateStatus: wallet.live_billing_enabled ? ("enabled" as const) : ("disabled_by_d07_gate" as const),
        ledger: [...ledger], usage: [...usage], reservations: Array.from(reservations.values()), invariantViolations,
      };
    },
  };
}
