/**
 * Authentication and Account domain types and utilities.
 */
import type { PlatformRole } from "./releaseAndA11yViews.ts";

export type AuthStatus = "authenticated" | "guest" | "session_expired";

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly username?: string | undefined;
  readonly displayName?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly role: PlatformRole;
}

export function defaultUsernameOfEmail(email: string): string {
  const local = (email.trim().toLowerCase().split("@")[0] ?? "").replace(/^@+/, "").trim();
  return local || "learner";
}

export function usernameOf(account: Pick<Account, "email" | "username">): string {
  const custom = account.username?.trim().replace(/^@+/, "");
  if (custom && custom.length > 0) return custom;
  return defaultUsernameOfEmail(account.email);
}

export function initialsOf(account: Pick<Account, "email" | "username">): string {
  const handle = usernameOf(account);
  const parts = handle.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
  }
  return (handle.slice(0, 2) || "U").toUpperCase();
}
