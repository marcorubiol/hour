import type { PageServerLoad } from './$types';
import { LOCALE_COOKIE, requestLocale } from '$lib/i18n';

// The invitation renders in the visitor's language before any script runs:
// the one chosen at the door (cookie), else the browser's (ADR-169).
export const load: PageServerLoad = ({ cookies, request }) => ({
  locale: requestLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language')),
});
