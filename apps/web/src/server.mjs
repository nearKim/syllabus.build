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
    const focusedKey = keyFor(document.activeElement);
    const previous = openDialogScroll();
    root.innerHTML = payload.html;
    if (payload.state && payload.state.themePreference) {
      const resolved = payload.state.themePreference === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", resolved);
    }
    bindDialogs();
    openMarkedDialogs(previous);
    if (!focusKey(focusedKey) && patch.action === "close-study-detail") focusKey(inspectorOpenerKey);
    return true;
  }

  bindDialogs();
  openMarkedDialogs(new Map());

  root.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    // A click on a select only opens its list. The change handler below sends the choice.
    if (!target || target.localName === "select") return;
    const action = target.dataset.action;

    if (action === "open-dialog" && target.dataset.dialogId) {
      const dialog = document.getElementById(target.dataset.dialogId);
      if (dialog && !dialog.open) dialog.showModal();
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
      if (action === "submit-practice") {
        const checked = root.querySelector('input[name="practice-choice"]:checked');
        if (checked) patch.practiceChoice = checked.value;
      }
      if (action === "reschedule-session" && target.dataset.sessionId) {
        const input = root.querySelector('[data-reschedule-for="' + CSS.escape(target.dataset.sessionId) + '"]');
        patch.rescheduleValue = input ? input.value : "";
      }
      dispatchServerRender(patch);
    }
  });

  root.addEventListener("change", (event) => {
    const select = event.target && event.target.closest ? event.target.closest('select[data-action="select-curriculum"]') : null;
    if (select) dispatchServerRender({ action: "select-curriculum", curriculumId: select.value });
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
