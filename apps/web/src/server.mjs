/**
 * Zero-Dependency Local Development & SSR Server (`apps/web/src/server.mjs`).
 *
 * - Compiles/serves the interactive Section 9.3 web application at `http://127.0.0.1:3000`
 *   (configurable via `WEB_PORT` and `WEB_HOST`).
 * - Server-renders the initial HTML using `renderCurriculumWebAppHtml` and hydrates client
 *   interactivity in the browser via `/client.js`.
 * - Proxies `/v1/*` API calls to `API_BASE_URL` (default `http://127.0.0.1:8080`) when available,
 *   or serves deterministic synthetic state for instant local inspection.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createCurriculumWebAppController,
  getDialogLightDismissFallbackScript,
  renderCurriculumWebAppHtml,
} from "./browserApp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const FLATPICKR_DIST_DIR = path.resolve(__dirname, "../node_modules/flatpickr/dist");
const TOM_SELECT_DIST_DIR = path.resolve(__dirname, "../node_modules/tom-select/dist");
const EXAMPLES_DIR = path.resolve(
  __dirname,
  "../../../specs/001-curriculum-platform/examples"
);

function buildBrowserHydrationClientJs() {
  const fallbackScript = getDialogLightDismissFallbackScript();
  return `// Curriculum.io Interactive Browser Hydration Controller
${fallbackScript}

(function hydrateCurriculumWebApp() {
  const root = document.getElementById("app");
  if (!root) return;
  const INSPECTOR_ID = "learn-detail-inspector";
  const supportsClosedBy = "closedBy" in HTMLDialogElement.prototype;
  let inspectorOpenerKey = null;

  // A selector that finds the same control again after the server re-renders the app,
  // scoped to the dialog that held it so a match behind a modal is never chosen.
  function keyFor(el) {
    if (!el || !el.attributes || !root.contains(el)) return null;
    const dialog = el.closest("dialog");
    if (el.id) return { selector: "#" + CSS.escape(el.id), dialogId: dialog ? dialog.id : null };
    const parts = Array.from(el.attributes)
      .filter((attr) => attr.name.startsWith("data-"))
      .map((attr) => "[" + attr.name + '="' + CSS.escape(attr.value) + '"]');
    if (parts.length === 0) return null;
    const kind = el.classList.length > 0 ? "." + CSS.escape(el.classList[0]) : el.localName;
    return { selector: kind + parts.join(""), dialogId: dialog ? dialog.id : null };
  }

  function focusKey(key) {
    if (!key) return false;
    const scope = key.dialogId ? document.getElementById(key.dialogId) : root;
    const match = scope && Array.from(scope.querySelectorAll(key.selector)).find((el) => el.getClientRects().length > 0);
    if (match) match.focus({ preventScroll: true });
    return Boolean(match);
  }

  // Every way a dialog closes (button, Esc, backdrop) fires "close"; tell the server once, from here.
  function bindDialogs() {
    root.querySelectorAll("dialog").forEach((dialog) => {
      if (dialog.dataset.closeBound === "true") return;
      dialog.dataset.closeBound = "true";
      dialog.addEventListener("close", () => {
        dispatchServerRender({ action: dialog.id === INSPECTOR_ID ? "close-study-detail" : "close-dialog" });
      });
      if (supportsClosedBy || dialog.getAttribute("closedby") !== "any" || dialog.dataset.lightDismissBound === "true") return;
      dialog.dataset.lightDismissBound = "true";
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
        if (!inside) dialog.close();
      });
    });
  }

  // The drawer records which activity it shows, so moving to another step starts at the top.
  function openDialogScroll() {
    const open = new Map();
    root.querySelectorAll("dialog[open]").forEach((dialog) => {
      open.set(dialog.id, { top: (dialog.querySelector("[data-scroll-region]") || dialog).scrollTop, activityId: dialog.dataset.activityId });
    });
    return open;
  }

  // The server marks the dialog to show; open it as a real modal. A dialog that was already open skips its entry slide.
  function openMarkedDialogs(previous) {
    root.querySelectorAll('dialog[data-open="true"]').forEach((dialog) => {
      if (dialog.open) return;
      const before = previous.get(dialog.id);
      if (before) dialog.setAttribute("data-instant", "");
      dialog.showModal();
      (dialog.querySelector("[data-scroll-region]") || dialog).scrollTop = before && before.activityId === dialog.dataset.activityId ? before.top : 0;
    });
  }

  function destroyDatepickers() {
    root.querySelectorAll("[data-datepicker]").forEach((el) => {
      if (el._flatpickr && typeof el._flatpickr.destroy === "function") {
        el._flatpickr.destroy();
      }
    });
  }

  function initDatepickers() {
    if (typeof window.flatpickr !== "function") return;
    root.querySelectorAll("[data-datepicker]").forEach((el) => {
      if (el._flatpickr) return;
      window.flatpickr(el, {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i",
        altInput: true,
        altFormat: "D, M j · h:i K",
        minuteIncrement: 15,
        allowInput: true,
      });
    });
  }

  function destroyPlanSelects() {
    root.querySelectorAll('[data-tom-select="plan"]').forEach((el) => {
      if (el.tomselect && typeof el.tomselect.destroy === "function") {
        el.tomselect.destroy();
      }
    });
  }

  function initPlanSelects() {
    if (typeof window.TomSelect !== "function") return;
    root.querySelectorAll('[data-tom-select="plan"]').forEach((el) => {
      if (el.tomselect) return;
      const metaByVal = {};
      Array.from(el.options).forEach((opt) => {
        metaByVal[opt.value] = {
          domain: opt.getAttribute("data-domain") || "",
          units: opt.getAttribute("data-units") || "",
          progress: opt.getAttribute("data-progress") || "",
          actionOption: opt.getAttribute("data-action-option") || "",
        };
      });
      new window.TomSelect(el, {
        controlInput: null,
        allowEmptyOption: false,
        render: {
          item: function () {
            return '<div class="ts-plan-item">' +
              '<span class="ts-plan-item-label">Switch curriculum</span>' +
              '<svg class="ts-plan-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
            '</div>';
          },
          option: function (data, escape) {
            const m = metaByVal[data.value] || {};
            if (m.actionOption === "new-curriculum" || data.value === "__new_curriculum__") {
              return '<div class="ts-plan-option ts-plan-action-option">' +
                '<span class="ts-plan-action-title">+ New Curriculum</span>' +
              '</div>';
            }
            const metaParts = [m.domain, m.units, m.progress].filter(Boolean).join(" · ");
            return '<div class="ts-plan-option">' +
              '<span class="ts-plan-option-title">' + escape(data.text) + '</span>' +
              (metaParts ? '<span class="ts-plan-option-meta">' + escape(metaParts) + '</span>' : '') +
            '</div>';
          },
        },
        onChange: function (value) {
          if (!value) return;
          dispatchServerRender({ action: "select-curriculum", curriculumId: value });
        },
      });
    });
  }

  async function dispatchServerRender(patch) {
    let payload;
    try {
      const response = await fetch("/api/ui-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return false;
      payload = await response.json();
    } catch {
      // Keep the current DOM when the local server endpoint is unreachable.
      return false;
    }
    if (!payload || typeof payload.html !== "string") return false;
    const activeEl = document.activeElement;
    const isGoalFocused = Boolean(activeEl && activeEl.id === "intake-goal");
    const goalLiveValue = isGoalFocused ? activeEl.value : null;
    const goalSelStart = isGoalFocused && typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null;
    const goalSelEnd = isGoalFocused && typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null;
    const focusedKey = keyFor(activeEl);
    const previous = openDialogScroll();
    const rail = root.querySelector(".today-curricula-grid");
    const railLeft = rail ? rail.scrollLeft : 0;
    destroyDatepickers();
    destroyPlanSelects();
    root.innerHTML = payload.html;
    const nextRail = root.querySelector(".today-curricula-grid");
    if (nextRail) nextRail.scrollLeft = railLeft;
    if (payload.state && payload.state.themePreference) {
      const resolved = payload.state.themePreference === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", resolved);
    }
    bindDialogs();
    openMarkedDialogs(previous);
    initDatepickers();
    initPlanSelects();
    if (!focusKey(focusedKey) && patch.action === "close-study-detail") focusKey(inspectorOpenerKey);
    if (isGoalFocused) {
      const nextGoal = root.querySelector("#intake-goal");
      if (nextGoal) {
        if (goalLiveValue !== null) nextGoal.value = goalLiveValue;
        if (goalSelStart !== null && goalSelEnd !== null && typeof nextGoal.setSelectionRange === "function") {
          nextGoal.setSelectionRange(goalSelStart, goalSelEnd);
        }
      }
    }
    return true;
  }

  bindDialogs();
  openMarkedDialogs(new Map());
  initDatepickers();
  initPlanSelects();

  root.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    // A click on a select only opens its list, and a click inside a form only focuses a field.
    // The change and submit handlers below send the choice.
    if (!target || target.localName === "select" || target.localName === "form") return;
    const action = target.dataset.action;

    if (action === "open-dialog" && target.dataset.dialogId) {
      // Without a session the server answers with the sign-in dialog instead, so only open other dialogs when signed in.
      const signedIn = Boolean(root.querySelector('.curriculum-app-shell[data-auth-status="authenticated"]'));
      const dialog = document.getElementById(target.dataset.dialogId);
      if (dialog && !dialog.open && (signedIn || dialog.id === "dialog-auth")) dialog.showModal();
      dispatchServerRender({ action: "open-dialog", dialogId: target.dataset.dialogId });
      return;
    }

    if (action === "close-dialog" || action === "close-study-detail") {
      event.preventDefault();
      const dialog = target.closest("dialog");
      if (dialog && dialog.open) dialog.close();
      else dispatchServerRender({ action });
      return;
    }

    // Only a control outside the drawer opens it. A step button inside the drawer must not replace
    // that control, or closing the drawer would have nowhere to return focus.
    const opensDrawer = action === "select-map-node" || action === "select-outline-module" || action === "select-outline-activity" || action === "resume-curriculum";
    if (opensDrawer && !target.closest("dialog")) {
      inspectorOpenerKey = keyFor(target);
    }

    if (action === "navigate-top" && target.dataset.destination) {
      dispatchServerRender({ action: "navigate-top", destination: target.dataset.destination });
    } else if (action === "navigate-learn-sub" && target.dataset.subDestination) {
      dispatchServerRender({ action: "navigate-learn-sub", subDestination: target.dataset.subDestination });
    } else if (action === "switch-plan-view" && target.dataset.planView) {
      dispatchServerRender({ action: "switch-plan-view", planView: target.dataset.planView });
    } else if (action === "select-map-node") {
      dispatchServerRender({
        action: "select-plan-module",
        moduleId: target.dataset.moduleId || target.dataset.nodeId,
      });
    } else if (action === "select-outline-module" && target.dataset.moduleId) {
      dispatchServerRender({ action: "select-plan-module", moduleId: target.dataset.moduleId });
    } else if (action === "select-outline-activity" && target.dataset.activityId) {
      dispatchServerRender({
        action: "select-plan-activity",
        activityId: target.dataset.activityId,
        moduleId: target.dataset.moduleId,
      });
    } else if (action === "map-control" && target.dataset.mapControl) {
      dispatchServerRender({ action: "map-control", mapControl: target.dataset.mapControl });
    } else if (action === "complete-activity" && target.dataset.activityId) {
      dispatchServerRender({
        action: "complete-activity",
        activityId: target.dataset.activityId,
        eventId: target.dataset.eventId,
      });
    } else if (action === "set-theme" && target.dataset.themeValue) {
      dispatchServerRender({ action: "set-theme", themeValue: target.dataset.themeValue });
    } else if (action === "toggle-upvote") {
      dispatchServerRender({ action: "toggle-upvote", revisionId: target.dataset.revisionId });
    } else {
      const patch = Object.assign({}, target.dataset);
      if (target.closest("#dialog-new-curriculum")) {
        const goalInput = root.querySelector("#intake-goal");
        if (goalInput) patch.intakeGoalTitle = goalInput.value;
      }
      if (action === "request-hint" || action === "study-worked-solution" || action === "submit-practice") {
        const checked = root.querySelector('input[name="practice-choice"]:checked');
        if (checked) patch.practiceChoice = checked.value;
      }
      if (action === "reschedule-session" && target.dataset.sessionId) {
        const row = target.closest(".schedule-row") || root;
        const input = row.querySelector('[data-reschedule-for="' + CSS.escape(target.dataset.sessionId) + '"]');
        patch.rescheduleValue = input ? input.value : "";
      }
      dispatchServerRender(patch);
    }
  });

  // The sign-in form, the Marketplace search, and the topic finder send their fields under the form's own data-action.
  root.addEventListener("submit", (event) => {
    const form = event.target && event.target.closest ? event.target.closest("form[data-action]") : null;
    if (!form) return;
    event.preventDefault();
    // The finder sends only a topic that its list holds. Other text gets the browser's own error message,
    // and an empty field sends nothing.
    const finder = form.querySelector("#marketplace-topic");
    if (finder) {
      const typed = finder.value.trim().toLowerCase();
      if (!typed) return;
      const known = Array.from(finder.list.options).some((option) => option.value.toLowerCase() === typed);
      finder.setCustomValidity(known ? "" : "No topic is named \u201c" + finder.value.trim() + "\u201d. Choose one from the list.");
      if (!finder.reportValidity()) return;
    }
    const patch = { action: form.dataset.action };
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") patch[key] = value;
    });
    dispatchServerRender(patch);
  });

  // A topic picked from the finder's list applies at once. A pick fires an input event with no inputType or with
  // insertReplacementText. Typed text fires insertText and waits for Enter.
  let goalInputTimer = null;
  root.addEventListener("input", (event) => {
    if (event.target && event.target.id === "intake-goal") {
      if (goalInputTimer) clearTimeout(goalInputTimer);
      const val = event.target.value;
      goalInputTimer = setTimeout(() => {
        dispatchServerRender({ action: "set-intake-goal", intakeGoalTitle: val });
      }, 150);
      return;
    }
    if (event.target.id !== "marketplace-topic") return;
    event.target.setCustomValidity("");
    if (!event.inputType || event.inputType === "insertReplacementText") event.target.form.requestSubmit();
  });

  root.addEventListener("change", (event) => {
    const select = event.target && event.target.closest ? event.target.closest('select[data-action="select-curriculum"]') : null;
    if (select) {
      dispatchServerRender({ action: "select-curriculum", curriculumId: select.value });
      return;
    }
    const subjectSelect = event.target && event.target.closest ? event.target.closest('select[data-action="set-intake-subject"]') : null;
    if (subjectSelect && subjectSelect.value) {
      const goalInput = root.querySelector("#intake-goal");
      dispatchServerRender({
        action: "set-intake-subject",
        intakeSubject: subjectSelect.value,
        intakeGoalTitle: goalInput ? goalInput.value : undefined,
      });
      return;
    }
    const topicSelect = event.target && event.target.closest ? event.target.closest('select[data-action="toggle-intake-topic"]') : null;
    if (topicSelect && topicSelect.value) {
      const goalInput = root.querySelector("#intake-goal");
      dispatchServerRender({
        action: "toggle-intake-topic",
        intakeTopic: topicSelect.value,
        intakeGoalTitle: goalInput ? goalInput.value : undefined,
      });
    }
  });

  root.addEventListener("keydown", (event) => {
    const inMapNode = event.target && event.target.closest ? event.target.closest(".map-node") : null;
    if (!inMapNode) return;
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      dispatchServerRender({ action: "map-keyboard", key: event.key });
    }
  });
})();
`;
}

function readSyntheticExampleOrFallback(fileName, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(EXAMPLES_DIR, fileName), "utf8")
    );
  } catch {
    return fallback;
  }
}

function proxyOrFallbackApiRequest(req, res, apiBaseUrl) {
  const targetUrl = new URL(req.url ?? "/v1/health", apiBaseUrl);
  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
      timeout: 1500,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", () => {
    // Fallback deterministic synthetic state when local Rust API is not running
    const urlPath = (req.url ?? "").split("?")[0];
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Curriculum-Synthetic-Fallback", "true");

    if (urlPath.includes("/schedule")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("schedule.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    if (urlPath.includes("/proficiency")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("proficiency.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    if (urlPath.includes("/curricula")) {
      res.writeHead(200);
      res.end(
        JSON.stringify(
          readSyntheticExampleOrFallback("curriculum.synthetic.json", {
            status: "ok",
          })
        )
      );
      return;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: "synthetic_fallback_ready",
        path: urlPath,
      })
    );
  });

  req.pipe(proxyReq);
}

export function createWebAppServer(options = {}) {
  const apiBaseUrl =
    options.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://127.0.0.1:8080";
  const controller = createCurriculumWebAppController(options.initialState ?? {});

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith("/v1/")) {
      proxyOrFallbackApiRequest(req, res, apiBaseUrl);
      return;
    }

    if (pathname === "/vendor/flatpickr.min.css") {
      const css = fs.readFileSync(path.join(FLATPICKR_DIST_DIR, "flatpickr.min.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(css);
      return;
    }

    if (pathname === "/vendor/flatpickr.min.js") {
      const js = fs.readFileSync(path.join(FLATPICKR_DIST_DIR, "flatpickr.min.js"), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
      return;
    }

    if (pathname === "/vendor/tom-select.min.css") {
      const css = fs.readFileSync(path.join(TOM_SELECT_DIST_DIR, "css/tom-select.min.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(css);
      return;
    }

    if (pathname === "/vendor/tom-select.complete.min.js") {
      const js = fs.readFileSync(path.join(TOM_SELECT_DIST_DIR, "js/tom-select.complete.min.js"), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(js);
      return;
    }

    if (pathname === "/styles.css") {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(css);
      return;
    }

    if (pathname === "/client.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(buildBrowserHydrationClientJs());
      return;
    }

    if (pathname === "/api/ui-state" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const cmd = body ? JSON.parse(body) : {};
          if (cmd.action === "navigate-top" && cmd.destination) {
            controller.navigateTopLevel(cmd.destination);
          } else if (cmd.action === "navigate-learn-sub" && cmd.subDestination) {
            controller.navigateLearnSubDestination(cmd.subDestination);
          } else if (cmd.action === "switch-plan-view" && cmd.planView) {
            controller.switchPlanView(cmd.planView);
          } else if (cmd.action === "select-plan-module" && cmd.moduleId) {
            controller.selectPlanModule(cmd.moduleId);
          } else if (cmd.action === "select-plan-activity" && cmd.activityId) {
            controller.selectPlanActivity(cmd.activityId, cmd.moduleId);
          } else if (cmd.action === "map-control" && cmd.mapControl) {
            controller.applyMapControl(cmd.mapControl);
          } else if (cmd.action === "map-keyboard" && cmd.key) {
            controller.navigateMapKeyboard(cmd.key);
          } else if (cmd.action === "complete-activity" && cmd.activityId) {
            controller.recordTodayActivityCompletion(cmd.activityId, cmd.eventId);
          } else if (cmd.action === "set-theme" && cmd.themeValue) {
            controller.setThemePreference(cmd.themeValue);
          } else if (cmd.action === "toggle-upvote") {
            controller.toggleUpvote(cmd.revisionId);
          } else if (cmd.action === "open-dialog" && cmd.dialogId) {
            controller.openDialog(cmd.dialogId);
          } else if (cmd.action === "close-dialog") {
            controller.closeDialog();
          } else if (typeof cmd.action === "string") {
            const data = Object.fromEntries(Object.entries(cmd).filter(([, value]) => typeof value === "string"));
            controller.applyUiAction(cmd.action, data, data.practiceChoice ?? null);
          }

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              state: controller.getState(),
              html: controller.renderHtml(),
            })
          );
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Default HTML entry route ("/" and deep links)
    const templateHtml = fs.readFileSync(
      path.join(PUBLIC_DIR, "index.html"),
      "utf8"
    );

    const topParam = parsedUrl.searchParams.get("topLevel");
    const subParam = parsedUrl.searchParams.get("learnSub");
    const planViewParam = parsedUrl.searchParams.get("planView");
    if (topParam === "Learn" || topParam === "Explore" || topParam === "Settings") {
      controller.navigateTopLevel(topParam);
    }
    if (
      subParam === "Today" ||
      subParam === "Plan" ||
      subParam === "Progress" ||
      subParam === "Resources"
    ) {
      controller.navigateLearnSubDestination(subParam);
    }
    if (planViewParam === "Map" || planViewParam === "Outline") {
      controller.switchPlanView(planViewParam);
    }

    const ssrAppHtml =
      parsedUrl.searchParams.size > 0
        ? controller.renderHtml()
        : renderCurriculumWebAppHtml(controller.getState());
    const fullPage = templateHtml.replace("<!--__SSR_APP_HTML__-->", ssrAppHtml);

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(fullPage);
  });

  return { server, controller };
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const port = Number(process.env.WEB_PORT ?? 3000);
  const host = process.env.WEB_HOST ?? "127.0.0.1";
  const { server } = createWebAppServer();
  server.listen(port, host, () => {
    console.log(
      `Curriculum.io Interactive Web App listening at http://${host}:${port}`
    );
  });
}
