import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSafeCurriculumRender, isSafeResourceUrl } from "../src/SafeActivityRenderer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

const canonicalCurriculum = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "specs/001-curriculum-platform/examples/curriculum.synthetic.json"),
    "utf-8"
  )
);

test("SafeActivityRenderer accepts canonical 0.2.0 curriculum fixture", () => {
  const res = evaluateSafeCurriculumRender(canonicalCurriculum);
  assert.equal(res.status, "supported");
  if (res.status === "supported") {
    assert.equal(res.schemaVersion, "0.2.0");
    assert.ok(res.activities.length > 0);
  }
});

test("SafeActivityRenderer fails closed on unknown major curriculum schema versions (2.0.0 and 1.0.0)", () => {
  const docMajor2 = {
    ...canonicalCurriculum,
    schema_version: "2.0.0",
    modules: [{ module_id: "mod-1", title: "Module One <script>alert(1)</script>" }],
  };
  const res2 = evaluateSafeCurriculumRender(docMajor2);
  assert.equal(res2.status, "unsupported_schema_version");
  if (res2.status === "unsupported_schema_version") {
    assert.equal(res2.schemaVersion, "2.0.0");
    assert.equal(res2.safeTextOutline.length, 1);
    assert.ok(!res2.safeTextOutline[0].title.includes("<"));
  }

  const docMajor1 = {
    ...canonicalCurriculum,
    schema_version: "1.0.0",
  };
  const res1 = evaluateSafeCurriculumRender(docMajor1);
  assert.equal(res1.status, "unsupported_schema_version");
});

test("SafeActivityRenderer rejects unallowlisted activity types and unsafe URL schemes (@S11, NFR-002)", () => {
  const unknownComponentDoc = {
    ...canonicalCurriculum,
    activities: [
      {
        ...canonicalCurriculum.activities[0],
        type: "arbitrary_iframe_widget",
      },
    ],
  };
  const resUnknown = evaluateSafeCurriculumRender(unknownComponentDoc);
  assert.equal(resUnknown.status, "rejected_unsafe_payload");

  assert.equal(isSafeResourceUrl("https://example.edu/course"), true);
  assert.equal(isSafeResourceUrl("javascript:alert(1)"), false);
  assert.equal(isSafeResourceUrl("data:text/html,<script>alert(1)</script>"), false);
});

test("UI tokens generated from design/ui-tokens.json carry generated-file notice and light/dark themes", () => {
  const tokensCss = fs.readFileSync(path.join(__dirname, "../src/tokens.css"), "utf-8");
  const tokensTs = fs.readFileSync(path.join(__dirname, "../src/tokens.ts"), "utf-8");

  assert.ok(tokensCss.includes("GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md"));
  assert.ok(tokensTs.includes("GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md"));
  assert.ok(tokensCss.includes("--color-canvas: #F7F8FA;"));
  assert.ok(tokensCss.includes("--color-canvas: #101216;"));
  assert.ok(tokensCss.includes("@supports not (backdrop-filter: blur(1px))"));
  assert.ok(tokensCss.includes("@media (prefers-reduced-transparency: reduce)"));
});
