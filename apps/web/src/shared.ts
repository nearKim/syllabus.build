import { renderUntrustedCatalogText } from "../../../packages/ui/src/index.ts";

export function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

export function requireNonEmpty(
  value: string | undefined | null,
  errorMessage: string,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(errorMessage);
  }
  return trimmed;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function sanitizeId(
  value: unknown,
  fallback: string,
  maxLength = 200,
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const clean = renderUntrustedCatalogText(value, { maxLength }).text;
  return clean || fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
