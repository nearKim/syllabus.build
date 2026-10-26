import type { VNode } from "preact";
import {
  TOP_LEVEL_DESTINATIONS,
  type LearnSubDestination,
  type TopLevelDestination,
} from "../index.ts";
import type { PlatformRole } from "../releaseAndA11yViews.ts";
import { SfIcon, type SfIconName } from "./Icons.tsx";

export type AuthStatus = "authenticated" | "guest" | "session_expired";

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly role: PlatformRole;
}

export function TopDestButton({
  dest,
  className,
  isCurrent,
}: {
  readonly dest: TopLevelDestination;
  readonly className: string;
  readonly isCurrent: boolean;
}): VNode {
  const icon: SfIconName = dest === "Learn" ? "learn" : dest === "Explore" ? "explore" : "settings";
  return (
    <button
      type="button"
      class={`${className}${isCurrent ? " is-active" : ""}`}
      data-action="navigate-top"
      data-destination={dest}
      aria-current={isCurrent ? "page" : "false"}
    >
      <SfIcon name={icon} size={16} />
      <span>{dest}</span>
    </button>
  );
}

export function LearnSubButton({
  sub,
  isCurrent,
}: {
  readonly sub: LearnSubDestination;
  readonly isCurrent: boolean;
}): VNode {
  const icon: SfIconName = sub === "Today" ? "today" : sub === "Plan" ? "plan" : sub === "Progress" ? "progress" : "resources";
  return (
    <button
      type="button"
      class={`nav-sub-btn${isCurrent ? " is-active" : ""}`}
      data-action="navigate-learn-sub"
      data-sub-destination={sub}
      aria-current={isCurrent ? "page" : "false"}
    >
      <SfIcon name={icon} size={16} />
      <span>{sub}</span>
    </button>
  );
}

export interface HeaderBarProps {
  readonly activeTopLevel: TopLevelDestination;
  readonly authStatus: AuthStatus;
  readonly account: Account;
  readonly studyMinutes: number;
  readonly selfReportedCount: number;
}

export function HeaderBar({
  activeTopLevel,
  authStatus,
  account,
  studyMinutes,
  selfReportedCount,
}: HeaderBarProps): VNode {
  const signedOut = authStatus === "guest";
  return (
    <header class="app-header nav-chrome-glass" role="banner">
      <div class="brand-cluster">
        <span class="brand-mark" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </svg>
        </span>
        <span class="brand-title">Curriculum.io</span>
      </div>
      <nav class="top-level-nav" aria-label="Primary navigation">
        {TOP_LEVEL_DESTINATIONS.map((dest) => (
          <TopDestButton key={dest} dest={dest} className="nav-top-btn" isCurrent={dest === activeTopLevel} />
        ))}
      </nav>
      <div class="header-status">
        {signedOut ? null : (
          <>
            <span class="duration-pill st-sr" data-study-minutes={studyMinutes}>
              Study minutes {studyMinutes}
            </span>
            <span class="duration-pill st-sr" data-self-reported-count={selfReportedCount}>
              Self-reported {selfReportedCount}
            </span>
          </>
        )}
        {authStatus === "authenticated" ? (
          <>
            <span class="account-pill">
              <span class="account-email">{account.email}</span>
              <span class="role-pill">{account.role}</span>
            </span>
            <button type="button" class="btn-secondary header-btn" data-action="open-dialog" data-dialog-id="dialog-auth">
              Account / Switch
            </button>
            <button type="button" class="btn-secondary header-btn" data-action="sign-out">
              Sign out
            </button>
          </>
        ) : (
          <>
            <span class="account-pill" data-auth-status={authStatus}>
              {signedOut ? "Guest · Exploring" : "Session expired"}
            </span>
            <button type="button" class="btn-primary header-btn" data-action="open-dialog" data-dialog-id="dialog-auth">
              Sign in
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export function SessionExpiredBanner({ authStatus }: { readonly authStatus: AuthStatus }): VNode | null {
  if (authStatus !== "session_expired") return null;
  return (
    <div class="session-banner" role="status">
      <p>
        <strong>Session expired.</strong> Sign in to resume where you left off.
      </p>
      <button type="button" class="btn-primary" data-action="open-dialog" data-dialog-id="dialog-auth">
        Sign in
      </button>
    </div>
  );
}

const SIDEBAR_LEARN_DESTINATIONS: readonly LearnSubDestination[] = ["Today", "Progress", "Resources"];

export interface SidebarCurriculumItem {
  readonly curriculumId: string;
  readonly title: string;
  readonly subject: string;
  readonly progressLabel: string;
  readonly isSelected: boolean;
  readonly isDraft?: boolean | undefined;
}

export function AppSidebar({
  signedOut,
  activeTopLevel,
  activeLearnSub,
  goalTitle,
  totalEffort,
  curricula = [],
}: {
  readonly signedOut: boolean;
  readonly activeTopLevel: TopLevelDestination;
  readonly activeLearnSub: LearnSubDestination;
  readonly goalTitle: string;
  readonly totalEffort: { readonly min: number; readonly point: number; readonly max: number };
  readonly curricula?: readonly SidebarCurriculumItem[] | undefined;
}): VNode {
  const effectiveSub: LearnSubDestination = activeLearnSub === "Plan" ? "Today" : activeLearnSub;
  return (
    <aside class="app-sidebar" aria-label="Learn sections">
      {signedOut ? (
        <div class="sidebar-section">
          <p class="meta-text">Sign in to see your plans.</p>
        </div>
      ) : (
        <>
          <div class="sidebar-section">
            <nav class="learn-sub-nav" aria-label="Learn sub-navigation">
              {SIDEBAR_LEARN_DESTINATIONS.map((sub) => (
                <LearnSubButton key={sub} sub={sub} isCurrent={activeTopLevel === "Learn" && sub === effectiveSub} />
              ))}
            </nav>
          </div>
          {curricula.length > 0 ? (
            <div class="sidebar-section sidebar-curricula">
              <p class="sidebar-section-label">Your curricula</p>
              <nav class="sidebar-curricula-list" aria-label="Your curricula">
                {curricula.map((item) => (
                  <button
                    key={item.curriculumId}
                    type="button"
                    class={`sidebar-curriculum-btn${item.isSelected ? " is-active" : ""}`}
                    data-action="select-curriculum"
                    data-curriculum-id={item.curriculumId}
                    aria-current={item.isSelected ? "true" : undefined}
                  >
                    <span class="sidebar-curriculum-title">{item.title}</span>
                    <span class="sidebar-curriculum-meta">
                      {item.subject} · {item.progressLabel}
                      {item.isDraft ? " · Draft" : ""}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          ) : (
            <div class="sidebar-section sidebar-goal">
              <p class="meta-text">{goalTitle}</p>
              <p class="meta-text">
                About {totalEffort.point} min planned ({totalEffort.min}–{totalEffort.max})
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function CompactBottomNav({ activeTopLevel }: { readonly activeTopLevel: TopLevelDestination }): VNode {
  return (
    <nav class="compact-bottom-nav nav-chrome-glass" aria-label="Compact mobile navigation">
      {TOP_LEVEL_DESTINATIONS.map((dest) => (
        <TopDestButton key={dest} dest={dest} className="bottom-nav-btn" isCurrent={dest === activeTopLevel} />
      ))}
    </nav>
  );
}
