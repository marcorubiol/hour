/**
 * WHY A RECORD DID NOT ARRIVE, in the two answers a reader can act on.
 * `missing` (404, 403): it is not there for you, and asking again will not
 * change that. `failed` (5xx, the network, anything else): something broke
 * on the way, and «Try again» is the honest offer. A server failure must
 * never read as «does not exist» (it makes people think it was deleted or
 * that their access was taken), and the server's own text is never the
 * copy: it may be English or technical, and its detail belongs in Sentry.
 */

import { ApiError } from '$lib/api';

export type LoadFail = 'missing' | 'failed';

export function loadFailKind(err: unknown): LoadFail {
  return err instanceof ApiError && (err.status === 404 || err.status === 403) ? 'missing' : 'failed';
}

/**
 * The retry of a record's read: never for a `missing` answer, once for a
 * failure. TanStack's default (three, with backoff) kept «Loading…» on
 * screen about seven seconds before saying anything; the reader has a
 * «Try again» of their own.
 */
export function retryLoad(count: number, err: unknown): boolean {
  return loadFailKind(err) === 'failed' && count < 1;
}
