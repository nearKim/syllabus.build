export interface PwaCacheCandidateInput {
  path: string; method?: string; cacheControlHeader?: string;
  containsSecretOrCredential?: boolean; containsUnapprovedFullText?: boolean;
  publicationStatus?: "published" | "withdrawn" | "restricted";
}

export interface PwaCacheEligibilityDecision {
  allowCache: boolean; cacheBucket: "static-shell-v1" | "active-study-metadata-v1" | "none"; reason: string;
}

const denyCache = (reason: string): PwaCacheEligibilityDecision => ({ allowCache: false, cacheBucket: "none", reason });

export function evaluatePwaCacheEligibility(input: PwaCacheCandidateInput): PwaCacheEligibilityDecision {
  if ((input.method ?? "GET").toUpperCase() !== "GET") return denyCache("non_get_request");
  if (input.containsSecretOrCredential) return denyCache("contains_secret_or_credential");
  if (input.containsUnapprovedFullText) return denyCache("contains_unapproved_full_text");
  if (input.publicationStatus === "withdrawn" || input.publicationStatus === "restricted") {
    return denyCache(`publication_${input.publicationStatus}`);
  }
  if ((input.cacheControlHeader ?? "").toLowerCase().includes("no-store")) return denyCache("cache_control_no_store");

  const p = input.path.trim();
  if (
    p.startsWith("/v1/me") || p.startsWith("/me/") || p === "/me" ||
    p.startsWith("/v1/auth") || p.startsWith("/auth/") || p.includes("/credentials")
  ) {
    return denyCache("authenticated_identity_or_credential_route");
  }
  if (
    p.startsWith("/assets/") || p.startsWith("/static/") || p === "/manifest.webmanifest" ||
    p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".woff2")
  ) {
    return { allowCache: true, cacheBucket: "static-shell-v1", reason: "static_shell_asset" };
  }
  if (p.startsWith("/v1/syllabi/") || p.startsWith("/v1/catalog/")) {
    return { allowCache: true, cacheBucket: "active-study-metadata-v1", reason: "permitted_study_metadata" };
  }
  return denyCache("unclassified_route_default_deny");
}
