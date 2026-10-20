import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOperationHeaders, OPENAPI_OPERATIONS } from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("generated OpenAPI TypeScript descriptors carry generated-file notice and all 71 operations", () => {
  const generatedTs = fs.readFileSync(path.join(__dirname, "../src/generated.ts"), "utf-8");
  assert.ok(
    generatedTs.includes("GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md")
  );
  assert.equal(Object.keys(OPENAPI_OPERATIONS).length, 71);
});

test("T01 HTTP concurrency policy: GET requires neither Idempotency-Key nor If-Match", () => {
  const getHeaders = buildOperationHeaders("getCurriculumOverview");
  assert.equal(getHeaders["Idempotency-Key"], undefined);
  assert.equal(getHeaders["If-Match"], undefined);
  assert.equal(getHeaders["Accept"], "application/json");
});

test("T01 HTTP concurrency policy: retriable effect-producing commands require Idempotency-Key", () => {
  assert.throws(
    () => buildOperationHeaders("startGeneration"),
    /requires an Idempotency-Key header/
  );
  const headers = buildOperationHeaders("startGeneration", {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(headers["Idempotency-Key"], "11111111-1111-4111-8111-111111111111");
  assert.equal(headers["If-Match"], undefined);
});

test("T01 HTTP concurrency policy: mutations of existing versioned mutable resources require If-Match", () => {
  assert.throws(
    () => buildOperationHeaders("activateCurriculumRevision"),
    /requires an If-Match header/
  );
  const headers = buildOperationHeaders("activateCurriculumRevision", {
    ifMatch: "\"rev-1\"",
  });
  assert.equal(headers["If-Match"], "\"rev-1\"");
  assert.equal(headers["Idempotency-Key"], undefined);
});
