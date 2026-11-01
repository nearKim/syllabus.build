import { buildOperationHeaders } from "@syllabus/api-client";
import { resolveSurfaceStyle, type ResolvedSurfaceStyle as SurfaceStyle, type ThemeMode } from "@syllabus/ui";
import type { ByokHttpRequest } from "./byokCustody.ts";

export type ReminderChannel = "email" | "web_push";

export interface QuietHoursWindow {
  start_local_time: string; end_local_time: string;
}

export interface NotificationPreferenceFixture {
  enabled: boolean; channels: ReminderChannel[]; timezone: string;
  quiet_hours: QuietHoursWindow; lead_time_minutes: number; version: number; etag?: string;
}

export interface ReminderOccurrenceRecord {
  occurrence_id: string; session_id: string; scheduled_for: string;
  status: "scheduled" | "snoozed" | "sent" | "suppressed_quiet_hours" | "cancelled";
  snoozed_until?: string | null;
}

export interface ReminderPreferenceState extends NotificationPreferenceFixture {
  occurrences: ReminderOccurrenceRecord[]; bestEffortDeliveryDisclosure: string; surfaceStyle: SurfaceStyle;
}

const BEST_EFFORT_REMINDER_DISCLOSURE =
  "Best-effort delivery disclosure: Study reminders respect your local timezone and quiet hours as opt-in nudges. Delivery is best-effort and missed reminders never lock or penalize your syllabus.";
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertValidTimezone(tz: string): void {
  const t = tz.trim();
  if (!t || (!t.includes("/") && t !== "UTC")) throw new Error(`Invalid IANA timezone identifier: "${tz}"`);
}

function assertValidQuietHours(qh: QuietHoursWindow): void {
  if (!HH_MM_PATTERN.test(qh.start_local_time) || !HH_MM_PATTERN.test(qh.end_local_time)) {
    throw new Error(`Quiet hours must use 24-hour HH:MM local time format (got ${qh.start_local_time} - ${qh.end_local_time}).`);
  }
}

export function createReminderPreferenceController(
  initialPrefs: NotificationPreferenceFixture,
  initialOccurrences: ReminderOccurrenceRecord[] = [],
  mode: ThemeMode = "light",
) {
  assertValidTimezone(initialPrefs.timezone);
  assertValidQuietHours(initialPrefs.quiet_hours);

  const surfaceStyle = resolveSurfaceStyle("study_card", { themePreference: mode });
  let prefs: NotificationPreferenceFixture = {
    ...initialPrefs, channels: [...initialPrefs.channels], quiet_hours: { ...initialPrefs.quiet_hours },
  };
  let occurrences: ReminderOccurrenceRecord[] = initialOccurrences.map((occ) => ({ ...occ }));

  const snapshot = (): ReminderPreferenceState => ({
    ...prefs, channels: [...prefs.channels], quiet_hours: { ...prefs.quiet_hours },
    occurrences: occurrences.map((occ) => ({ ...occ })),
    bestEffortDeliveryDisclosure: BEST_EFFORT_REMINDER_DISCLOSURE, surfaceStyle,
  });

  return {
    getState: snapshot,
    buildUpdatePreferencesRequest(
      patch: Partial<Pick<NotificationPreferenceFixture, "enabled" | "channels" | "timezone" | "quiet_hours" | "lead_time_minutes">>,
      options: { ifMatch?: string } = {},
    ): ByokHttpRequest<{
      enabled: boolean; channels: ReminderChannel[]; timezone: string; quiet_hours: QuietHoursWindow; lead_time_minutes: number;
    }> {
      const nextTimezone = patch.timezone ?? prefs.timezone;
      const nextQuietHours = patch.quiet_hours ? { ...patch.quiet_hours } : { ...prefs.quiet_hours };
      assertValidTimezone(nextTimezone);
      assertValidQuietHours(nextQuietHours);

      const ifMatch = options.ifMatch ?? prefs.etag ?? `"notification-prefs-v${prefs.version}"`;
      const nextVersion = prefs.version + 1;
      prefs = {
        enabled: patch.enabled ?? prefs.enabled,
        channels: patch.channels ? [...patch.channels] : [...prefs.channels],
        timezone: nextTimezone, quiet_hours: nextQuietHours,
        lead_time_minutes: patch.lead_time_minutes ?? prefs.lead_time_minutes,
        version: nextVersion, etag: `"notification-prefs-v${nextVersion}"`,
      };

      return {
        method: "PUT", path: "/v1/me/notification-preferences",
        headers: buildOperationHeaders("updateNotificationPreferences", { ifMatch }),
        body: {
          enabled: prefs.enabled, channels: [...prefs.channels], timezone: prefs.timezone,
          quiet_hours: { ...prefs.quiet_hours }, lead_time_minutes: prefs.lead_time_minutes,
        },
      };
    },
    buildSnoozeReminderRequest(input: {
      occurrence_id: string; snooze_minutes?: number; snooze_until?: string;
    }): ByokHttpRequest<{ snooze_minutes?: number; snooze_until?: string }> {
      const target = occurrences.find((occ) => occ.occurrence_id === input.occurrence_id);
      if (!target) throw new Error(`Unknown reminder occurrence_id: ${input.occurrence_id}`);
      if (input.snooze_minutes !== undefined && (input.snooze_minutes < 5 || input.snooze_minutes > 1440)) {
        throw new Error("snooze_minutes must be between 5 and 1440.");
      }
      if (input.snooze_minutes === undefined && !input.snooze_until?.trim()) {
        throw new Error("Either snooze_minutes or snooze_until must be provided.");
      }

      const computedUntil =
        input.snooze_until ??
        new Date(new Date(target.scheduled_for).getTime() + (input.snooze_minutes ?? 30) * 60_000).toISOString();

      occurrences = occurrences.map((occ) =>
        occ.occurrence_id === input.occurrence_id ? { ...occ, status: "snoozed", snoozed_until: computedUntil } : occ,
      );

      return {
        method: "POST",
        path: `/v1/me/reminders/${encodeURIComponent(input.occurrence_id)}/snooze`,
        headers: buildOperationHeaders("snoozeReminderOccurrence"),
        body: {
          ...(input.snooze_minutes !== undefined ? { snooze_minutes: input.snooze_minutes } : {}),
          ...(input.snooze_until ? { snooze_until: input.snooze_until } : {}),
        },
      };
    },
  };
}
export type ReminderPreferenceController = ReturnType<typeof createReminderPreferenceController>;
