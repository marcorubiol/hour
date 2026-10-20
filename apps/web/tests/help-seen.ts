/**
 * Every welcome card and first-time note the app has, read from `$lib/help`
 * so the list cannot drift from the app. The auth setup marks them seen so no
 * other spec meets them; help.spec.ts resets them, checks them and leaves them
 * seen again.
 */
import { EVENTS, SECTIONS, cardKey, eventKey } from '../src/lib/help';

export const HELP_SEEN = [...SECTIONS.map(cardKey), ...EVENTS.map(eventKey)];
