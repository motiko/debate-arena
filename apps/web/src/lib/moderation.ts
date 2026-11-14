// Wording for the Moderator queue, kept out of the page so it can be tested.
import { t, tn, type MessageKey } from '../i18n/t';

const list = new Intl.ListFormat('en', { type: 'conjunction' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "2 Member Reports and 1 anonymous Report": only the kinds there are; empty when there are none. */
export function reportCounts(members: number, anonymous: number): string {
  const parts = [];
  if (members > 0) parts.push(tn('moderation.memberReports', members));
  if (anonymous > 0) parts.push(tn('moderation.anonymousReports', anonymous));
  return list.format(parts);
}

/** Each Report reason once, in the order the Reports list them. */
export function reportReasons(reports: { reason: string }[]): string {
  return [...new Set(reports.map(r => r.reason))].map(r => t(`report.reason.${r}` as MessageKey)).join(', ');
}

/** How long ago a Debate started, as a Moderator scans the queue: "5 hours ago", "yesterday". */
export function waitingSince(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return relative.format(0, 'second');
  if (minutes > -60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}
