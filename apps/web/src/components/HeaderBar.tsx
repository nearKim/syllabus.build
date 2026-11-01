import type { VNode } from "preact";
import type { LearnSubDestination, TopLevelDestination } from "../navigationShell.ts";
import type { PlatformRole } from "../releaseAndA11yViews.ts";
import { SfIcon, type SfIconName } from "./Icons.tsx";
import type { Account, AuthStatus } from "../auth.ts";
import { defaultUsernameOfEmail, initialsOf, usernameOf } from "../auth.ts";

export type { Account, AuthStatus };
export { defaultUsernameOfEmail, initialsOf, usernameOf };

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

// Pathway S brand mark: a continuous S-shaped study track winding upward into a Cobalt milestone.
export function BrandMark({ className = "brand-mark" }: { readonly className?: string | undefined }): VNode {
  return (
    <span class={className} aria-hidden="true">
      <svg class="brand-mark-svg" viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path
          d="M6.2 17.2H14.6A1.7 1.7 0 0 0 14.6 13.8H9.4A5.3 5.3 0 0 1 9.4 3.2H12.2A1.8 1.8 0 0 1 12.2 6.8H9.4A1.7 1.7 0 0 0 9.4 10.2H14.6A5.3 5.3 0 0 1 14.6 20.8H6.2A1.8 1.8 0 0 1 6.2 17.2Z"
          fill="currentColor"
        />
        <circle class="brand-mark-apex" cx="17.8" cy="5.0" r="2.25" fill="var(--brand-mark-apex, #8FB3FF)" />
      </svg>
    </span>
  );
}

// The Syllabus.io mark and wordmark.
export function BrandLockup(): VNode {
  return (
    <div class="brand-cluster">
      <BrandMark />
      <span class="brand-title">Syllabus.io</span>
    </div>
  );
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
      <BrandLockup />
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
            <summary class="navbar-avatar-trigger" aria-label={`Account menu (${account.email})`}>
              <span class="user-avatar-circle" aria-hidden="true">
                {account.avatarUrl ? <img class="user-avatar-img" src={account.avatarUrl} alt="" /> : initialsOf(account)}
              </span>
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
                  <span class="navbar-dropdown-name">{`@${usernameOf(account)}`}</span>
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
              data-auth-mode="login"
            >
              Log in
            </button>
            <button
              type="button"
              class="btn-primary header-btn"
              data-action="open-dialog"
              data-dialog-id="dialog-auth"
              data-auth-mode="signup"
            >
              Sign up
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
      <button
        type="button"
        class="btn-primary session-banner-btn"
        data-action="open-dialog"
        data-dialog-id="dialog-auth"
        data-auth-mode="login"
      >
        Sign in
      </button>
    </div>
  );
}

const SIDEBAR_LEARN_DESTINATIONS: readonly LearnSubDestination[] = ["Today", "Progress", "Resources"];

export interface SidebarSyllabusItem {
  readonly syllabusId: string;
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
  syllabi = [],
  adminConsoleOpen = false,
}: {
  readonly signedOut: boolean;
  readonly activeTopLevel: TopLevelDestination;
  readonly activeLearnSub: LearnSubDestination;
  readonly goalTitle: string;
  readonly totalEffort: { readonly min: number; readonly point: number; readonly max: number };
  readonly syllabi?: readonly SidebarSyllabusItem[] | undefined;
  readonly adminConsoleOpen?: boolean | undefined;
}): VNode {
  const effectiveSub: LearnSubDestination = activeLearnSub === "Plan" ? "Today" : activeLearnSub;
  return (
    <aside class="app-sidebar" aria-label="Learn sections">
      {signedOut ? (
        <div class="sidebar-section sidebar-guest-card">
          <p class="sidebar-section-label">Your syllabi</p>
          <p class="meta-text">Sign in to save syllabi, track verified mastery, and build custom study flows.</p>
          <button
            type="button"
            class="sidebar-new-syllabus-btn"
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
          {syllabi.length > 0 ? (
            <div class="sidebar-section sidebar-syllabi">
              <p class="sidebar-section-label">Your syllabi</p>
              <nav class="sidebar-syllabi-list" aria-label="Your syllabi">
                {syllabi.map((item) => (
                  <button
                    key={item.syllabusId}
                    type="button"
                    class={`sidebar-syllabus-btn${item.isSelected ? " is-active" : ""}`}
                    data-action="select-syllabus"
                    data-syllabus-id={item.syllabusId}
                    aria-current={item.isSelected ? "true" : undefined}
                  >
                    <span class="sidebar-syllabus-title">{item.title}</span>
                    <span class="sidebar-syllabus-meta">
                      {item.subject} · {item.progressLabel}
                      {item.isDraft ? " · Draft" : ""}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  class="sidebar-new-syllabus-btn"
                  data-action="open-dialog"
                  data-dialog-id="dialog-new-syllabus"
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
                  <span>New syllabus</span>
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
                class="sidebar-new-syllabus-btn"
                data-action="open-dialog"
                data-dialog-id="dialog-new-syllabus"
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
                <span>New syllabus</span>
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
