import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../index.ts";
import type { PlatformRole } from "../releaseAndA11yViews.ts";
import { SfIcon, type SfIconName } from "./Icons.tsx";

export type AuthStatus = "authenticated" | "guest" | "session_expired";

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly displayName?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly role: PlatformRole;
}

const KNOWN_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "alex@curriculum.io": "Alex Rivera",
  "ada@curriculum.io": "Ada Lovelace",
  "mo@curriculum.io": "Mo Chen",
};

export function displayNameOf(account: Account): string {
  if (account.displayName && account.displayName.trim().length > 0) {
    return account.displayName.trim();
  }
  const email = account.email.trim().toLowerCase();
  if (KNOWN_DISPLAY_NAMES[email]) return KNOWN_DISPLAY_NAMES[email];
  const local = (email.split("@")[0] ?? "Learner").replace(/[._-]+/g, " ").trim();
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Learner";
}

export function initialsOf(account: Account): string {
  const name = displayNameOf(account);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
  }
  return (name.slice(0, 2) || "U").toUpperCase();
}

// The navbar shows Learn and Explore. Settings opens from the account menu, and Admin has no visible entry.
const PRIMARY_DESTINATIONS = ["Learn", "Explore"] as const;
type PrimaryDestination = (typeof PRIMARY_DESTINATIONS)[number];

export function TopDestButton({
  dest,
  className,
  isCurrent,
}: {
  readonly dest: PrimaryDestination;
  readonly className: string;
  readonly isCurrent: boolean;
}): VNode {
  const icon: SfIconName = dest === "Learn" ? "learn" : "explore";
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
  readonly resolvedThemeMode?: "light" | "dark" | undefined;
  readonly adminConsoleOpen?: boolean | undefined;
}

export function HeaderBar({
  activeTopLevel,
  authStatus,
  account,
  studyMinutes,
  selfReportedCount,
  resolvedThemeMode = "light",
  adminConsoleOpen = false,
}: HeaderBarProps): VNode {
  const signedOut = authStatus === "guest";
  const isDark = resolvedThemeMode === "dark";
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
        {PRIMARY_DESTINATIONS.map((dest) => (
          <TopDestButton
            key={dest}
            dest={dest}
            className="nav-top-btn"
            isCurrent={!adminConsoleOpen && dest === activeTopLevel}
          />
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
        <button
          type="button"
          class="navbar-theme-toggle"
          data-action="set-theme"
          data-theme-value={isDark ? "light" : "dark"}
          aria-pressed={isDark ? "true" : "false"}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? (
            <svg
              class="theme-toggle-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          ) : (
            <svg
              class="theme-toggle-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </button>
        {authStatus === "authenticated" ? (
          <details class="navbar-user-menu">
            <summary class="navbar-avatar-trigger" aria-label={`Account menu for ${displayNameOf(account)}`}>
              <span class="user-avatar-circle" aria-hidden="true">
                {account.avatarUrl ? <img class="user-avatar-img" src={account.avatarUrl} alt="" /> : initialsOf(account)}
              </span>
              <span class="navbar-user-name">{displayNameOf(account)}</span>
              <svg
                class="navbar-user-chevron"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </summary>
            <div class="navbar-user-dropdown" data-opaque-surface="true">
              <div class="navbar-dropdown-identity">
                <span class="user-avatar-circle user-avatar-md" aria-hidden="true">
                  {account.avatarUrl ? <img class="user-avatar-img" src={account.avatarUrl} alt="" /> : initialsOf(account)}
                </span>
                <div class="navbar-dropdown-meta">
                  <span class="navbar-dropdown-name">{displayNameOf(account)}</span>
                  <span class="account-email">{account.email}</span>
                </div>
              </div>
              <div class="navbar-dropdown-actions">
                <button
                  type="button"
                  class="navbar-dropdown-item"
                  data-action="navigate-top"
                  data-destination="Settings"
                >
                  <SfIcon name="settings" size={15} />
                  <span>Profile &amp; Settings</span>
                </button>
                <button
                  type="button"
                  class="navbar-dropdown-item navbar-dropdown-signout"
                  data-action="sign-out"
                >
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </details>
        ) : (
          <div class="navbar-guest-actions" data-auth-status="guest">
            <button
              type="button"
              class="header-login-btn"
              data-action="open-dialog"
              data-dialog-id="dialog-auth"
            >
              Log in
            </button>
            <button
              type="button"
              class="btn-primary header-btn"
              data-action="open-dialog"
              data-dialog-id="dialog-auth"
            >
              Sign in
            </button>
          </div>
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
  adminConsoleOpen = false,
}: {
  readonly signedOut: boolean;
  readonly activeTopLevel: TopLevelDestination;
  readonly activeLearnSub: LearnSubDestination;
  readonly goalTitle: string;
  readonly totalEffort: { readonly min: number; readonly point: number; readonly max: number };
  readonly curricula?: readonly SidebarCurriculumItem[] | undefined;
  readonly adminConsoleOpen?: boolean | undefined;
}): VNode {
  const effectiveSub: LearnSubDestination = activeLearnSub === "Plan" ? "Today" : activeLearnSub;
  return (
    <aside class="app-sidebar" aria-label="Learn sections">
      {signedOut ? (
        <div class="sidebar-section sidebar-guest-card">
          <p class="sidebar-section-label">Your curricula</p>
          <p class="meta-text">Sign in to save curricula, track verified mastery, and build custom study flows.</p>
          <button
            type="button"
            class="sidebar-new-curriculum-btn"
            data-action="open-dialog"
            data-dialog-id="dialog-auth"
          >
            <span>Sign in to get started</span>
          </button>
        </div>
      ) : (
        <>
          <div class="sidebar-section">
            <nav class="learn-sub-nav" aria-label="Learn sub-navigation">
              {SIDEBAR_LEARN_DESTINATIONS.map((sub) => (
                <LearnSubButton key={sub} sub={sub} isCurrent={!adminConsoleOpen && activeTopLevel === "Learn" && sub === effectiveSub} />
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
                <button
                  type="button"
                  class="sidebar-new-curriculum-btn"
                  data-action="open-dialog"
                  data-dialog-id="dialog-new-curriculum"
                >
                  <svg
                    class="sf-icon"
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                  <span>New curriculum</span>
                </button>
              </nav>
            </div>
          ) : (
            <div class="sidebar-section sidebar-goal">
              <p class="meta-text">{goalTitle}</p>
              <p class="meta-text">
                About {totalEffort.point} min planned ({totalEffort.min}–{totalEffort.max})
              </p>
              <button
                type="button"
                class="sidebar-new-curriculum-btn"
                data-action="open-dialog"
                data-dialog-id="dialog-new-curriculum"
              >
                <svg
                  class="sf-icon"
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
                <span>New curriculum</span>
              </button>
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
      {PRIMARY_DESTINATIONS.map((dest) => (
        <TopDestButton key={dest} dest={dest} className="bottom-nav-btn" isCurrent={dest === activeTopLevel} />
      ))}
    </nav>
  );
}
