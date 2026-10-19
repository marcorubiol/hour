/**
 * Every welcome card and first-time note the app has (`$lib/help`). The auth
 * setup marks them seen so no other spec meets them; help.spec.ts resets
 * them, checks them and leaves them seen again.
 */
export const HELP_SEEN = [
  'card:desk',
  'card:planner',
  'event:first_going',
  'event:first_clash',
  'event:first_hold_due',
  'event:first_trip_guess',
];
