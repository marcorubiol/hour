/**
 * A message as the person reads it (tarea 132). Raw failures still reach
 * toasts from the many `fetch` calls that do not go through `$lib/api`: the
 * browser's network error, in the browser's English and wording («Failed to
 * fetch», Safari's «Load failed»), or a bare «Error 500». Those are said in
 * the app's language; any other message is the caller's and passes as is.
 */
import { t, type Locale } from '$lib/i18n';

/** What each browser says when the request never got an answer. */
const NETWORK = [
  /^failed to fetch$/i, // Chrome, Edge
  /^networkerror when attempting to fetch resource\.?$/i, // Firefox
  /^load failed$/i, // Safari
  /^the network connection was lost\.?$/i, // Safari
  /^the internet connection appears to be offline\.?$/i, // Safari
  /^network ?error$/i,
];

export function readableError(message: string, locale: Locale): string {
  const m = message.trim();
  if (NETWORK.some((re) => re.test(m))) return t('ui.no_connection', locale);
  if (/^(error )?5\d\d\b/i.test(m) || /^internal server error$/i.test(m)) return t('ui.failed', locale);
  return message;
}
