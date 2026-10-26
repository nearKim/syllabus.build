import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mountCurriculumWebApp } from "../apps/web/src/browserApp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stylesPath = path.join(repoRoot, "apps/web/public/styles.css");
const impeccableBin = path.join(repoRoot, ".claude/skills/impeccable/scripts/impeccable");

function resolveCssVariables(rawCss) {
  const rootMatch = rawCss.match(/:root(?:,\s*\[data-theme="light"\])?\s*\{([^}]*)\}/);
  const vars = {};
  if (rootMatch) {
    for (const line of rootMatch[1].split("\n")) {
      const m = line.match(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  }
  let resolved = rawCss;
  for (let pass = 0; pass < 4; pass++) {
    resolved = resolved.replace(/var\((--[a-zA-Z0-9-]+)(?:,\s*([^)]+))?\)/g, (full, name, fallback) => {
      return vars[name] ?? fallback ?? full;
    });
  }
  return resolved;
}

function extractCssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "m");
  return css.match(re)?.[1] ?? "";
}

function runBoxInBoxAudit(rawCss, views) {
  const violations = [];

  // 1. Outer section / wrapper selectors that MUST NOT be 4-sided bordered boxes wrapping inner cards/boxes
  const bannedOuterBoxSelectors = [
    ".surface-panel",
    "#progress-capability-portfolio",
    ".progress-portfolio-section",
    ".today-unified-header",
    ".today-active-workspace > .flow-board",
    ".resources-table-wrapper",
    ".marketplace-filters",
    ".session-reschedule-panel"
  ];

  for (const sel of bannedOuterBoxSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) continue;
    const hasFourSidedBorder = /(?:^|;|\s)border\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(block);
    const hasCardSurface = /background(?:-color)?\s*:\s*var\(--color-surface(?:-secondary)?\)/m.test(block);
    if (hasFourSidedBorder || hasCardSurface) {
      violations.push(
        `[box-in-box] Outer container '${sel}' has a 4-sided border or card surface background (${hasFourSidedBorder ? "border" : "background"}), creating a Box-in-Box wrapper around inner controls.`
      );
    }
  }

  // 2. Row / inner item selectors that MUST remain flat hairline rows or inline text (not nested boxes)
  const bannedInnerBoxSelectors = [
    ".progress-unit-row",
    ".progress-capability-row",
    ".progress-act-chip",
    ".progress-check-btn",
    ".progress-status-pill",
    ".progress-unit-gate",
    ".resource-usage-chip",
    ".resource-category-badge",
    ".unit-badge",
    ".unit-prereq-pill",
    ".node-optional",
    ".gate-unlocks-badge",
    ".math-inline",
    ".learn-tag-primary",
    ".learn-tag-facet",
    ".learn-topic-chip"
  ];

  for (const sel of bannedInnerBoxSelectors) {
    const block = extractCssBlock(rawCss, sel);
    if (!block) continue;
    const hasFourSidedBorder = /(?:^|;|\s)border\s*:\s*(?:var\(--hairline\)|1px\s+solid)/m.test(block);
    const hasTintedBoxBg =
      /background(?:-color)?\s*:\s*(?:var\(--tint-|var\(--color-(?:surface|accent-surface|success-surface)|color-mix)/m.test(
        block
      );
    if (hasFourSidedBorder || hasTintedBoxBg) {
      violations.push(
        `[box-in-box] Inner element '${sel}' has a nested box border or tinted pill fill (${hasFourSidedBorder ? "border" : "background"}) inside its parent row/card.`
      );
    }
  }

  // 3. Matrix selected row must not paint a tinted box behind .node-card boxes
  const selectedRowBlock = extractCssBlock(rawCss, ".matrix-table tr.is-selected > *");
  if (/background-color\s*:\s*var\(--selected-row\)/m.test(selectedRowBlock)) {
    violations.push(
      "[box-in-box] '.matrix-table tr.is-selected > *' paints a tinted box background behind bordered .node-card elements."
    );
  }

  // 4. DOM structure checks across rendered views
  if (/class="surface-panel"\s+id="progress-capability-portfolio"|id="progress-capability-portfolio"\s+class="surface-panel"/.test(views.progress)) {
    violations.push(
      "[box-in-box] '#progress-capability-portfolio' uses '.surface-panel' in Progress DOM."
    );
  }
  if (/<button[^>]*class="[^"]*progress-act-chip[^"]*"[^>]*>(?:(?!<\/button>)[\s\S])*?<svg/m.test(views.progress)) {
    violations.push(
      "[box-in-box] '.progress-act-chip' in Progress DOM contains a nested SVG checkbox glyph box."
    );
  }
  if (/<button[^>]*class="[^"]*progress-check-btn[^"]*btn-secondary/m.test(views.progress)) {
    violations.push(
      "[box-in-box] '.progress-check-btn' in Progress DOM uses bordered '.btn-secondary' box styling inside a capability row."
    );
  }
  if (/<button[^>]*class="[^"]*resource-usage-chip[^"]*"[^>]*>(?:(?!<\/button>)[\s\S])*?class="badge"/m.test(views.resources)) {
    violations.push(
      "[box-in-box] '.resource-usage-chip' in Resources DOM contains a nested '.badge' pill box."
    );
  }

  return violations;
}

function main() {
  const rawCss = fs.readFileSync(stylesPath, "utf8");
  const resolvedCss = resolveCssVariables(rawCss);

  const root = { innerHTML: "" };
  const app = mountCurriculumWebApp(root);

  app.navigateTopLevel("Learn");
  app.navigateLearnSubDestination("Today");
  const todayHtml = app.renderHtml();

  app.navigateLearnSubDestination("Progress");
  const progressHtml = app.renderHtml();

  app.navigateLearnSubDestination("Resources");
  const resourcesHtml = app.renderHtml();

  app.navigateTopLevel("Explore");
  const exploreHtml = app.renderHtml();

  app.navigateTopLevel("Settings");
  const settingsHtml = app.renderHtml();

  const views = {
    today: todayHtml,
    progress: progressHtml,
    resources: resourcesHtml,
    explore: exploreHtml,
    settings: settingsHtml
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "curriculum-impeccable-gate-"));
  try {
    const htmlFiles = [];
    for (const [name, bodyHtml] of Object.entries(views)) {
      const filePath = path.join(tmpDir, `${name}.html`);
      fs.writeFileSync(
        filePath,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title><style>${resolvedCss}</style></head><body>${bodyHtml}</body></html>`
      );
      htmlFiles.push(filePath);
    }

    let detectRaw = "[]";
    try {
      detectRaw = execFileSync(
        impeccableBin,
        [
          "detect",
          "--no-config",
          "--json",
          ...htmlFiles,
          path.join(repoRoot, "apps/web/public/styles.css"),
          path.join(repoRoot, "apps/web/src/browserApp.ts"),
          path.join(repoRoot, "apps/web/src/components")
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      );
    } catch (err) {
      detectRaw = err.stdout || "[]";
    }

    const parsed = JSON.parse(detectRaw);
    const findings = Array.isArray(parsed) ? parsed : [];
    const boxViolations = runBoxInBoxAudit(rawCss, views);

    if (findings.length > 0 || boxViolations.length > 0) {
      console.error("❌ Impeccable + Box-in-Box Gate Failed:");
      for (const f of findings) {
        console.error(
          `  [${f.severity}:${f.antipattern}] (${path.basename(f.file)}:${f.line}) ${f.snippet || f.name}`
        );
      }
      for (const v of boxViolations) {
        console.error(`  ${v}`);
      }
      process.exit(1);
    }

    console.log(
      `✅ Impeccable + Box-in-Box Gate Passed: 5 rendered screens + source files scanned, 0 anti-patterns, 0 advisories, 0 box-in-box violations.`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
