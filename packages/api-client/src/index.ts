/**
 * Typed HTTP client descriptors enforcing the T01 HTTP concurrency policy (`Section 14.6`):
 * - `Idempotency-Key` is required ONLY for retriable effect-producing commands.
 * - `If-Match` is required ONLY for mutations of existing versioned mutable resources.
 * - `GET` operations require neither.
 */

export * from "./generated.ts";
import { OPENAPI_OPERATIONS, type OperationId, type OperationSpec } from "./generated.ts";

export interface ConcurrencyHeaderOptions {
  readonly idempotencyKey?: string;
  readonly ifMatch?: string;
}

export function buildOperationHeaders(
  operationId: OperationId,
  options: ConcurrencyHeaderOptions = {}
): Record<string, string> {
  const spec: OperationSpec | undefined = OPENAPI_OPERATIONS[operationId];
  if (!spec) {
    throw new Error(`Unknown operationId: ${String(operationId)}`);
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (spec.method !== "GET" && spec.method !== "DELETE") {
    headers["Content-Type"] = "application/json";
  }

  const trimmedIdempotencyKey = options.idempotencyKey?.trim();
  if (spec.requiresIdempotencyKey) {
    if (!trimmedIdempotencyKey || trimmedIdempotencyKey.length === 0) {
      throw new Error(
        `Operation ${operationId} (${spec.method} ${spec.path}) is a retriable effect-producing command and requires an Idempotency-Key header.`
      );
    }
    headers["Idempotency-Key"] = trimmedIdempotencyKey;
  } else if (trimmedIdempotencyKey && trimmedIdempotencyKey.length > 0) {
    headers["Idempotency-Key"] = trimmedIdempotencyKey;
  }

  const trimmedIfMatch = options.ifMatch?.trim();
  if (spec.requiresIfMatch) {
    if (!trimmedIfMatch || trimmedIfMatch.length === 0) {
      throw new Error(
        `Operation ${operationId} (${spec.method} ${spec.path}) mutates a versioned resource and requires an If-Match header.`
      );
    }
    headers["If-Match"] = trimmedIfMatch;
  } else if (trimmedIfMatch && trimmedIfMatch.length > 0) {
    headers["If-Match"] = trimmedIfMatch;
  }

  return headers;
}
