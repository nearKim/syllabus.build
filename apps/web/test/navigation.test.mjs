import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Web shell enforces Section 9.3 navigation hierarchy (Learn/Explore/Settings -> Today/Plan[Map+Outline]/Progress/Resources)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf-8");
  assert.ok(src.includes('["Learn", "Explore", "Settings"]'));
  assert.ok(src.includes('["Today", "Plan", "Progress", "Resources"]'));
  assert.ok(src.includes('["Map", "Outline"]'));
});
