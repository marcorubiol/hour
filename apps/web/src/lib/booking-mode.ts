/**
 * The hold convention a workspace speaks (ADR-002): `simple` (theatre, dance:
 * holds coexist on a date, unranked) or `prioritized` (music: 1st, 2nd, 3rd,
 * the 1st has first right to convert).
 *
 * The default follows the trade (tarea 140): a music space ranks its holds, a
 * stage space does not. The stored key (`settings.booking_mode`) is only the
 * exception: absent means «the trade's own», so a space that changes trade
 * changes convention with it unless an admin said otherwise.
 */

export type BookingMode = 'simple' | 'prioritized';

export const BOOKING_MODES: readonly BookingMode[] = ['simple', 'prioritized'];

function isBookingMode(value: unknown): value is BookingMode {
  return value === 'simple' || value === 'prioritized';
}

/** The convention a trade speaks when nobody chose one. */
export function defaultBookingMode(trade: string | null | undefined): BookingMode {
  return trade === 'music' ? 'prioritized' : 'simple';
}

/** The convention this workspace speaks: the stored one, or its trade's. */
export function bookingModeOf(workspace: {
  booking_mode?: string | null;
  trade?: string | null;
}): BookingMode {
  return isBookingMode(workspace.booking_mode)
    ? workspace.booking_mode
    : defaultBookingMode(workspace.trade);
}

/**
 * What to store for a chosen convention: `''` (absent) when it is the trade's
 * own, so it keeps following the trade; the mode itself when it departs.
 */
export function bookingModePatch(mode: BookingMode, trade: string | null | undefined): '' | BookingMode {
  return mode === defaultBookingMode(trade) ? '' : mode;
}
