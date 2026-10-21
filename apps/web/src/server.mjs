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

  async function dispatchServerRender(patch) {
    try {
      const response = await fetch("/api/ui-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return false;
      const payload = await response.json();
      if (payload && typeof payload.html === "string") {
        root.innerHTML = payload.html;
        if (payload.state && payload.state.themePreference) {
          const resolved = payload.state.themePreference === "dark" ? "dark" : "light";
          document.documentElement.setAttribute("data-theme", resolved);
        }
        rebindDialogs();
        if (payload.state && payload.state.openDialogId) {
          const dlg = document.getElementById(payload.state.openDialogId);
          if (dlg && typeof dlg.showModal === "function" && !dlg.open) {
            try { dlg.showModal(); } catch {}
          }
        }
        return true;
      }
    } catch {
      // Fallback to local DOM state if server endpoint is unreachable
    }
    return false;
  }

  function rebindDialogs() {
    const dialogs = root.querySelectorAll('dialog[closedby="any"]');
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialogs.forEach((dialog) => {
        if (dialog.dataset.lightDismissBound === 'true') return;
        dialog.dataset.lightDismissBound = 'true';
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent = (
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width
          );
          if (isDialogContent) return;
          dialog.close();
          dispatchServerRender({ action: "close-dialog" });
        });
      });
    }
  }

  rebindDialogs();

  root.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.dataset.action;

    if (action === "open-dialog" && target.dataset.dialogId) {
      const dialog = document.getElementById(target.dataset.dialogId);
      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
      }
      dispatchServerRender({ action: "open-dialog", dialogId: target.dataset.dialogId });
      return;
    }

    if (action === "close-dialog") {
      event.preventDefault();
      const dialog = target.closest("dialog");
      if (dialog && typeof dialog.close === "function") {
        dialog.close();
      }
      dispatchServerRender({ action: "close-dialog" });
      return;
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
