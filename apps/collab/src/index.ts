/**
 * hour-collab Worker entry.
 *
 * Re-exports the RoadsheetCollab DO class so wrangler can wire the binding.
 * The Worker's own fetch handler is a stub — `workers_dev: false` means no
 * external traffic reaches it; all DO access is via stubs from hour-web.
 *
 * If the fetch handler ever fires in production, something has been
 * misconfigured (workers_dev flipped on, route added). The 404 keeps it
 * obvious.
 */

import { RoadsheetCollab } from './roadsheet';

export { RoadsheetCollab };

export default {
  fetch(): Response {
    return new Response(
      'hour-collab is internal-only. Connect via hour-web /api/collab/...',
      { status: 404, headers: { 'content-type': 'text/plain' } },
    );
  },
} satisfies ExportedHandler;
