/** A date as Viewers read it, in UTC so server and browser agree. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { dateStyle: 'medium', timeZone: 'UTC' });
}
