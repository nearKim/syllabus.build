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
  const spec: OperationSpec = OPENAPI_OPERATIONS[operationId];
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (spec.method !== "GET" && spec.method !== "DELETE") {
    headers["Content-Type"] = "application/json";
  }

  if (spec.requiresIdempotencyKey) {
    if (!options.idempotencyKey || options.idempotencyKey.trim().length === 0) {
      throw new Error(
        `Operation ${operationId} (${spec.method} ${spec.path}) is a retriable effect-producing command and requires an Idempotency-Key header.`
      );
    }
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  if (spec.requiresIfMatch) {
    if (!options.ifMatch || options.ifMatch.trim().length === 0) {
      throw new Error(
        `Operation ${operationId} (${spec.method} ${spec.path}) mutates a versioned resource and requires an If-Match header.`
      );
    }
    headers["If-Match"] = options.ifMatch;
  }

  return headers;
}
