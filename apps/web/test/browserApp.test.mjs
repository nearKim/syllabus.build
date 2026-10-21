import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCurriculumWebAppController,
  getDialogLightDismissFallbackScript,
  mountCurriculumWebApp,
  renderCurriculumWebAppHtml,
} from "../src/index.ts";
import { createWebAppServer } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

// The Today study-flow board, from its section tag to the end of its table.
function todayBoard(html) {
  const start = html.indexOf('<section class="flow-board" aria-labelledby="flow-today-title"');
  assert.ok(start >= 0, "Today study-flow board is missing");
  return html.slice(start, html.indexOf("</table>", start));
}

function columnTitles(html) {
  const board = todayBoard(html);
  const head = board.slice(board.indexOf("<thead>"), board.indexOf("</thead>"));
  return [...head.matchAll(/<span class="colhead-title">([^<]+)<\/span>/g)].map((match) => match[1]);
}

function unitRow(html, moduleId) {
  const board = todayBoard(html);
  const start = board.search(new RegExp(`<tr class="study-card outline-module-card[^"]*" data-module-id="${moduleId}"`));
  assert.ok(start >= 0, `row for ${moduleId} is missing`);
  return board.slice(start, board.indexOf("</tr>", start));
}

test("renderCurriculumWebAppHtml renders Section 9.3 navigation hierarchy, SVG DAG Map + Outline, MathML, opaque surfaces, and <dialog closedby='any'> modals", () => {
  const html = renderCurriculumWebAppHtml();

  // 1. Section 9.3 Top-Level Destinations & Learn Sub-Destinations
  for (const topDest of ["Learn", "Explore", "Settings"]) {
    assert.ok(
      html.includes(`data-action="navigate-top" data-destination="${topDest}"`),
      `Missing top-level destination button for ${topDest}`
    );
  }
  for (const subDest of ["Today", "Plan", "Progress", "Resources"]) {
    assert.ok(
      html.includes(`data-action="navigate-learn-sub" data-sub-destination="${subDest}"`),
      `Missing Learn sub-destination button for ${subDest}`
    );
  }

  // 2. Today View: session cards, idempotent complete button, spaced-review separation, two-layer summary
  assert.ok(html.includes('data-action="complete-activity"'));
  assert.ok(html.includes('data-review-separation-valid="true"'));
  assert.ok(html.includes("Honest Two-Layer Status Summary"));
  assert.ok(html.includes('data-opaque-surface="true"'));

  // 3. Accessible MathML formula rendered on opaque surface
  assert.ok(html.includes("<math"));
  assert.ok(html.includes('aria-label="Mathematical expression:'));

  // 4. Synchronized Plan Map (SVG DAG) & Outline
  assert.ok(html.includes('<svg class="plan-dag-svg"'));
  assert.ok(html.includes('<g class="map-node" tabindex="0"'));
  assert.ok(html.includes('<path class="map-edge"'));
  for (const ctrl of ["zoom_in", "zoom_out", "fit_view", "reset_focus"]) {
    assert.ok(
      html.includes(`data-map-control="${ctrl}"`),
      `Missing non-dragging map control ${ctrl}`
    );
  }
  assert.ok(html.includes("Prerequisite Bridge Warning:"));
  assert.ok(html.includes('data-action="activate-revision"'));
  assert.ok(html.includes('data-if-match="&quot;revision-attention-v2-etag&quot;"'));

  // 5. Progress View: 5 canonical objective proficiency statuses + Topic Diagnostic + Adaptation Diff dialog
  for (const status of [
    "unassessed",
    "self_reported",
    "in_progress",
    "needs_review",
    "demonstrated",
  ]) {
    assert.ok(
      html.includes(`data-proficiency-status="${status}"`),
      `Missing proficiency status ${status}`
    );
  }
  assert.ok(html.includes('data-diagnostic-session-id="diagnostic-synthetic-001"'));
  assert.ok(
    html.includes(
      '<dialog id="dialog-adaptation-diff" closedby="any" aria-labelledby="dialog-adaptation-diff-title"'
    )
  );

  // 6. Resources View: publisher provenance, link_and_metadata_only rights badge, separate optional certification cost
  assert.ok(html.includes('data-rights-basis="link_and_metadata_only"'));
  assert.ok(html.includes('data-optional-certification="true"'));
  assert.ok(html.includes("Open ML Press (Curator Verified)"));

  // 7. Explore View: public template card, upvote button, Partial Adoption modal, Publication Preview modal
  assert.ok(html.includes('data-action="toggle-upvote"'));
  assert.ok(
    html.includes(
      '<dialog id="dialog-partial-adoption" closedby="any" aria-labelledby="dialog-partial-adoption-title"'
    )
  );
  assert.ok(
    html.includes(
      '<dialog id="dialog-publication-preview" closedby="any" aria-labelledby="dialog-publication-preview-title"'
    )
  );

  // 8. Settings View: theme selector, BYOK providers, Hosted Wallet & 4-Bucket Cost Breakdown, Reminders, Account Deletion modal
  for (const theme of ["light", "dark", "system"]) {
    assert.ok(html.includes(`data-theme-value="${theme}"`));
  }
  for (const provider of ["openai", "anthropic", "google_gemini"]) {
    assert.ok(html.includes(`data-provider-id="${provider}"`));
  }
  for (const bucketId of [
    "app_service_access",
    "ai_inference",
    "learning_materials",
    "certification_and_compute",
  ]) {
    assert.ok(html.includes(`data-bucket-id="${bucketId}"`));
  }
  assert.ok(html.includes("Price unknown (verify externally)"));
  assert.ok(
    html.includes(
      '<dialog id="dialog-account-deletion" closedby="any" aria-labelledby="dialog-account-deletion-title"'
    )
  );

  // 9. Mandatory closedBy coordinate fallback script
  const fallbackScript = getDialogLightDismissFallbackScript();
  assert.ok(fallbackScript.includes("if (!('closedBy' in HTMLDialogElement.prototype))"));
  assert.ok(fallbackScript.includes("if (event.target !== dialog) return;"));
  assert.ok(fallbackScript.includes("dialog.getBoundingClientRect()"));
  assert.ok(fallbackScript.includes("dialog.close()"));
  assert.ok(html.includes("if (!('closedBy' in HTMLDialogElement.prototype))"));
});

test("apps/web/public/styles.css enforces dialog:modal and dialog::backdrop scroll containment without locking html/body overflow", () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");

  assert.match(css, /dialog:modal\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(
    css,
    /dialog::backdrop\s*\{[^}]*overflow:\s*hidden;[^}]*overscroll-behavior:\s*contain;/s
  );

  // Ensure html/body are never locked with overflow: hidden or position: fixed
  assert.equal(/html\s*\{[^}]*overflow:\s*hidden/s.test(css), false);
  assert.equal(/body\s*\{[^}]*overflow:\s*hidden/s.test(css), false);
  assert.equal(/body\s*\{[^}]*position:\s*fixed/s.test(css), false);

  // Verify responsive breakpoints and accessibility media queries
  assert.ok(css.includes("@media (max-width: 767.98px)"));
  assert.ok(css.includes("@media (min-width: 768px) and (max-width: 1199.98px)"));
  assert.ok(css.includes("@media (min-width: 1200px)"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes("@media (prefers-reduced-transparency: reduce)"));
  assert.ok(css.includes("@media (forced-colors: active)"));
});

test("mountCurriculumWebApp and createCurriculumWebAppController deterministically update tabs, Plan Map/Outline selection, and idempotent Today progress", () => {
  const root = { innerHTML: "" };
  const app = mountCurriculumWebApp(root);

  assert.ok(root.innerHTML.includes('data-current-top-level="Learn"'));
  assert.ok(root.innerHTML.includes('data-current-learn-sub="Today"'));

  // 1. Switch to Plan -> Outline and select Module 2 ("module-attention")
  app.navigateLearnSubDestination("Plan");
  app.switchPlanView("Outline");
  app.selectPlanModule("module-attention", "Outline");
  const planHtml = app.renderHtml();

  assert.ok(planHtml.includes('data-current-learn-sub="Plan"'));
  assert.ok(planHtml.includes('data-current-plan-view="Outline"'));
  assert.ok(planHtml.includes('data-selected-module-id="module-attention"'));
  assert.ok(planHtml.includes('data-selected-activity-id="activity-quiz"'));

  // Both Map and Outline reflect the synchronized selection
  assert.ok(
    planHtml.includes('data-node-id="module-attention" data-node-kind="module" data-module-id="module-attention" data-selected="true"')
  );
  assert.ok(
    planHtml.includes('class="study-card outline-module-card is-selected" data-module-id="module-attention" data-selected="true"')
  );

  // 2. Record self-reported completion in Today view -> idempotent deduplication & honest two-layer status
  const receipt1 = app.recordTodayActivityCompletion("activity-theory", "evt-test-001");
  assert.equal(receipt1.deduplicated, false);
  assert.equal(receipt1.activityExecutionStatus, "self_reported_completed");
  assert.equal(receipt1.objectiveProficiencyDemonstrated, false);
  assert.equal(receipt1.selfReportedCompletedCount, 1);
  assert.equal(receipt1.totalStudyMinutes, 15);

  // Duplicate event_id does not double-count minutes or completions
  const receipt2 = app.recordTodayActivityCompletion("activity-theory", "evt-test-001");
  assert.equal(receipt2.deduplicated, true);
  assert.equal(receipt2.selfReportedCompletedCount, 1);
  assert.equal(receipt2.totalStudyMinutes, 15);

  const afterProgressHtml = app.renderHtml();
  assert.ok(afterProgressHtml.includes('data-study-minutes="15"'));
  assert.ok(afterProgressHtml.includes('data-self-reported-count="1"'));
  assert.ok(
    afterProgressHtml.includes(
      'data-activity-id="activity-theory" data-execution-status="self_reported_completed"'
    )
  );

  // 3. Switch top-level tabs to Explore and Settings
  app.navigateTopLevel("Explore");
  app.toggleUpvote();
  const exploreHtml = app.renderHtml();
  assert.ok(exploreHtml.includes('data-current-top-level="Explore"'));
  assert.ok(exploreHtml.includes("▲ Upvote Revision (15)"));

  app.navigateTopLevel("Settings");
  app.setThemePreference("dark");
  const settingsHtml = app.renderHtml();
  assert.ok(settingsHtml.includes('data-current-top-level="Settings"'));
  assert.ok(settingsHtml.includes('data-theme="dark"'));
});

test("Study flow matrix follows the chosen flow order: theory_first vs application_first", () => {
  const theoryFirst = renderCurriculumWebAppHtml();
  assert.deepEqual(columnTitles(theoryFirst), ["Unit", "Lecture", "Deep Dive", "Code", "Review", "Gate"]);
  assert.ok(todayBoard(theoryFirst).includes('data-action="set-flow-order" data-flow-order="theory_first" aria-pressed="true"'));

  // The switches carry 1-2 word labels. The column headers already spell out the order.
  const head = todayBoard(theoryFirst).slice(0, todayBoard(theoryFirst).indexOf('<div class="matrix-stage">'));
  assert.deepEqual([...head.matchAll(/class="seg-btn"[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]), ["Theory", "Code first", "Balanced"]);
  assert.ok(head.includes('<button type="button" id="flow-today-deep-dive" class="flow-switch" role="switch" aria-checked="true" data-action="set-deep-dive" data-deep-dive="skipped">Deep Dive'));
  assert.ok(head.includes('<button type="button" id="flow-today-spaced-review" class="flow-switch" role="switch" aria-checked="true" data-action="set-spaced-review" data-spaced-review="compact">Review'));
  for (const old of ["Lecture → Deep Dive → Code → Gate", "Skipped (Time-saver)", "Balanced Flow", "Each row is one unit"]) {
    assert.equal(theoryFirst.includes(old), false, `old toolbar text is still rendered: ${old}`);
  }

  // Unit 1 reads Lecture -> Deep Dive -> Code -> Gate: three arrowheads, and the Review column is passed through.
  const unitOne = unitRow(theoryFirst, "module-foundations");
  assert.equal(unitOne.match(/data-seg="in" data-style="solid"/g)?.length, 3);
  assert.ok(unitOne.includes('<td class="flow-cell" data-track="review" data-empty="true"><svg class="matrix-svg" data-seg="through"'));
  assert.ok(unitOne.includes('class="gate-diamond" data-action="select-outline-module" data-module-id="module-foundations" data-status="passed"'));
  const order = ["activity-theory", "activity-example", "activity-coding"].map((id) => unitOne.indexOf(`data-activity-id="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  // Unit 2 ends at its quiz gate; work that depends on the quiz stays off the arrow chain.
  const unitTwo = unitRow(theoryFirst, "module-attention");
  assert.ok(unitTwo.includes('class="gate-diamond" data-action="select-outline-activity" data-activity-id="activity-quiz"'));
  assert.equal(unitTwo.includes('data-seg="in"'), false);
  assert.equal(unitTwo.match(/After the gate/g)?.length, 2);

  const codeFirst = renderCurriculumWebAppHtml({ flowOrder: "application_first" });
  assert.deepEqual(columnTitles(codeFirst), ["Unit", "Code", "Lecture", "Deep Dive", "Review", "Gate"]);
  const codeRow = unitRow(codeFirst, "module-foundations");
  assert.ok(codeRow.indexOf('data-activity-id="activity-coding"') < codeRow.indexOf('data-activity-id="activity-theory"'));
  // The view moved the code lab ahead of its prerequisite, so the card says so instead of hiding the dependency.
  assert.ok(codeRow.includes("Needs Deep Dive first"));
  assert.ok(codeFirst.includes("This plan was generated theory first."));
  assert.equal(theoryFirst.includes("Needs Deep Dive first"), false);

  assert.deepEqual(columnTitles(renderCurriculumWebAppHtml({ flowOrder: "balanced" })), ["Unit", "Lecture", "Code", "Deep Dive", "Review", "Gate"]);
});

test("Deep Dive and Review switches collapse columns without hiding required work", () => {
  const skipped = renderCurriculumWebAppHtml({ deepDive: "skipped" });
  assert.deepEqual(columnTitles(skipped), ["Unit", "Lecture", "Code", "Review", "Gate"]);
  const board = todayBoard(skipped);
  assert.equal(board.includes('data-activity-id="activity-reflection"'), false, "optional enrichment should be hidden");
  // The required worked example moves into the Lecture column after the theory reading.
  const lectureCell = unitRow(skipped, "module-foundations").match(/<td class="flow-cell" data-track="lecture".*?<\/td>/s)?.[0] ?? "";
  assert.ok(lectureCell.indexOf('data-activity-id="activity-theory"') < lectureCell.indexOf('data-activity-id="activity-example"'));
  assert.ok(board.includes("Deep Dive off hides 1 optional deep dive (15 min). Required deep dives stay in the Lecture column."));
  // An off switch offers the value that turns it back on.
  assert.ok(board.includes('role="switch" aria-checked="false" data-action="set-deep-dive" data-deep-dive="included">Deep Dive'));

  const compact = renderCurriculumWebAppHtml({ spacedReview: "compact" });
  assert.deepEqual(columnTitles(compact), ["Unit", "Lecture", "Deep Dive", "Code", "Gate"]);
  assert.ok(todayBoard(compact).includes('role="switch" aria-checked="false" data-action="set-spaced-review" data-spaced-review="included">Review'));
  const gateCell = unitRow(compact, "module-attention").match(/<td class="flow-cell" data-track="gate".*?<\/td>/s)?.[0] ?? "";
  assert.ok(gateCell.includes('data-activity-id="activity-review"'), "compact reviews stay visible under the gate");

  // The same switches drive the mounted app, and unknown values are rejected at the boundary.
  const root = { innerHTML: "" };
  const app = mountCurriculumWebApp(root);
  assert.equal(app.applyUiAction("set-flow-order", { flowOrder: "application_first" }).handled, true);
  assert.equal(app.applyUiAction("set-deep-dive", { deepDive: "skipped" }).handled, true);
  assert.deepEqual(columnTitles(root.innerHTML), ["Unit", "Code", "Lecture", "Review", "Gate"]);
  assert.equal(app.applyUiAction("set-flow-order", { flowOrder: "sideways" }).handled, false);
  assert.equal(app.getState().flowOrder, "application_first");
  app.applyUiAction("set-deep-dive", { deepDive: "included" });
  app.applyUiAction("set-flow-order", { flowOrder: "theory_first" });
  assert.deepEqual(columnTitles(root.innerHTML), ["Unit", "Lecture", "Deep Dive", "Code", "Review", "Gate"]);
});

test("Today shows one Next-up bar above the Study flow, and Resume opens the drawer that holds the details", () => {
  const html = renderCurriculumWebAppHtml();
  const today = html.slice(html.indexOf('id="panel-learn-today"'), html.indexOf('id="panel-learn-plan"'));
  const plan = html.slice(html.indexOf('id="panel-learn-plan"'), html.indexOf('id="panel-learn-progress"'));
  for (const removed of ["Next session", "In this session", "Why this is next", "Access and setup", 'class="macro-stage"', 'class="status-banner"']) {
    assert.equal(today.includes(removed), false, `Today still renders ${removed}`);
  }
  assert.equal(plan.includes('class="macro-stage"'), false, "Plan still renders the unit strip");

  // Only the bar sits between the page header and the Study flow board.
  const between = today.slice(today.indexOf("</select>"), today.indexOf('<section class="flow-board"'));
  assert.equal(between.match(/<(section|ol|dl|h2|h3)\b/g), null);
  const bar = between.slice(between.indexOf('<div class="next-up-bar">'));
  assert.ok(bar.includes('<p class="next-up-progress">0/5 completed · 83m left</p>'));
  assert.ok(bar.includes('<span class="next-up-label">Next:</span><span class="next-up-title">Read Subword Tokenization &amp; Sequence Packing Notes</span><span class="next-up-time">· 15m</span>'));
  const resume = bar.match(/<button type="button" class="btn-primary" data-action="([^"]+)" data-activity-id="([^"]+)" data-module-id="([^"]+)">Resume<span aria-hidden="true">→<\/span><\/button>/);
  assert.ok(resume, "Resume button is missing");

  // Clicking Resume with its own data attributes opens the drawer on that activity.
  const listeners = {};
  const root = { innerHTML: "", addEventListener: (type, listener) => { listeners[type] = listener; } };
  mountCurriculumWebApp(root, { selectedActivityId: "activity-coding" });
  const dataset = { action: resume[1], activityId: resume[2], moduleId: resume[3] };
  listeners.click({ target: { closest: () => ({ dataset }) } });
  const drawerStart = root.innerHTML.indexOf('<dialog id="learn-detail-inspector"');
  const drawer = root.innerHTML.slice(drawerStart, root.innerHTML.indexOf("</dialog>", drawerStart));
  assert.ok(drawer.includes('data-open="true"'));
  assert.ok(drawer.includes(">Read Subword Tokenization &amp; Sequence Packing Notes</h2>"));
  assert.ok(drawer.includes("<dt>Capability</dt><dd>Tokenization &amp; Sequence Foundations</dd>"));
  assert.ok(drawer.includes("<dt>Effort</dt><dd>15 min (10–22)</dd>"));
  assert.ok(drawer.includes("<strong>Why this is next.</strong> Core theory step in Module 1: Tokenization &amp; Sequence Foundations."));
  assert.ok(drawer.includes('data-rights-basis="link_and_metadata_only"'));

  // Another activity's drawer does not claim to be next.
  const other = renderCurriculumWebAppHtml({ selectedActivityId: "activity-coding", studyDetailOpen: true });
  assert.equal(other.includes("Why this is next"), false);

  // With every scheduled activity closed, the bar offers no Resume.
  const allDone = Object.fromEntries(["activity-theory", "activity-example", "activity-coding", "activity-quiz", "activity-review", "activity-reflection"].map((id) => [id, "completed"]));
  const finished = renderCurriculumWebAppHtml({ activityStates: allDone });
  assert.ok(finished.includes('<p class="next-up-progress">5/5 completed</p>'));
  assert.ok(finished.includes('<p class="next-up-text">Nothing is scheduled next.</p>'));
  assert.equal(/<div class="next-up-bar">[\s\S]*?>Resume</.test(finished.slice(0, finished.indexOf('<section class="flow-board"'))), false);
});

test("the activity inspector is one modal drawer that never takes width from the matrix", () => {
  const html = renderCurriculumWebAppHtml();
  assert.equal(html.split('id="learn-detail-inspector"').length - 1, 1);
  assert.ok(html.includes('<dialog id="learn-detail-inspector" class="inspector" closedby="any" aria-labelledby="learn-detail-inspector-title" data-open="false"'));
  assert.equal(/class="st-layout"|class="plan-split"/.test(html), false);

  // Only visible text counts: synthetic hrefs may point at example.invalid, labels never do.
  assert.equal(html.replace(/<[^>]+>/g, " ").includes("example.invalid"), false);

  const app = mountCurriculumWebApp({ innerHTML: "" });
  app.selectPlanActivity("activity-coding");
  const opened = app.renderHtml();
  assert.ok(opened.includes('aria-labelledby="learn-detail-inspector-title" data-open="true"'));
  assert.ok(opened.includes('<button type="button" class="inspector-close" data-action="close-study-detail" aria-label="Close details">'));
  assert.ok(opened.includes('<h2 id="learn-detail-inspector-title" tabindex="-1" autofocus>Implement Reversible Tokenizer &amp; Shape Validator</h2>'));
  app.applyUiAction("close-study-detail");
  assert.ok(app.renderHtml().includes('aria-labelledby="learn-detail-inspector-title" data-open="false"'));
  app.selectPlanActivity("activity-coding");
  app.navigateLearnSubDestination("Progress");
  assert.equal(app.getState().studyDetailOpen, false, "navigation closes the drawer");

  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  assert.match(css, /dialog\.inspector\s*\{[^}]*position:\s*fixed;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /html\s*\{[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(css, /\.node-card\s*\{[^}]*min-height:/s);
  assert.equal(/\.node-card\s*\{[^}]*[^-]height:\s*84px/s.test(css), false, "node cards must not use a fixed height");
  assert.match(css, /\.node-title\s*\{[^}]*overflow-wrap:\s*break-word;\s*word-break:\s*normal;/s);
  assert.equal(/\.curriculum-app-shell\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css), false, "the shell must not let words split mid-letter");
});

test("createWebAppServer serves SSR HTML, stylesheet, hydration script, and synthetic API fallback", async () => {
  const { server } = createWebAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const indexRes = await fetch(`${baseUrl}/?topLevel=Learn&learnSub=Plan&planView=Map`);
    assert.equal(indexRes.status, 200);
    const indexHtml = await indexRes.text();
    assert.ok(indexHtml.includes("<!doctype html>"));
    assert.ok(indexHtml.includes('data-current-learn-sub="Plan"'));
    assert.ok(indexHtml.includes('<svg class="plan-dag-svg"'));

    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);
    const cssText = await cssRes.text();
    assert.ok(cssText.includes("dialog:modal"));

    const stateRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete-activity",
        activityId: "activity-theory",
        eventId: "evt-http-1",
      }),
    });
    assert.equal(stateRes.status, 200);
    const stateJson = await stateRes.json();
    assert.equal(stateJson.state.selfReportedCompletedCount, 1);
    assert.ok(stateJson.html.includes('data-self-reported-count="1"'));

    // The hydration client forwards every other data-action; the server routes it through applyUiAction.
    const clientJs = await (await fetch(`${baseUrl}/client.js`)).text();
    assert.ok(clientJs.includes('dialog.id === INSPECTOR_ID ? "close-study-detail" : "close-dialog"'));
    const flowRes = await fetch(`${baseUrl}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-flow-order", flowOrder: "application_first" }),
    });
    const flowJson = await flowRes.json();
    assert.equal(flowJson.state.flowOrder, "application_first");
    assert.deepEqual(columnTitles(flowJson.html), ["Unit", "Code", "Lecture", "Deep Dive", "Review", "Gate"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
