/**
 * The read of the chats list (`GET /api/conversations/feed`), one builder for
 * its key and its URL: the list (ConversationFeed), the Equipo chip's figure
 * and the frame's warm-up (`$lib/lens-warm`) ask with the same key, so what one
 * fetched the others find.
 */
import { fetchJSON } from './api';
import type { ConversationFeedView } from './conversation-feed';

/** One page of the list. */
export const FEED_PAGE = 100;

export function conversationFeedQueryOptions(
  k: { projectIds: string[]; workspaceIds: string[] },
  args: { q?: string; limit?: number; tag?: string | null } = {},
) {
  const q = args.q ?? '';
  const limit = args.limit ?? FEED_PAGE;
  const tag = args.tag ?? null;
  return {
    queryKey: ['conversation-feed', k.projectIds, k.workspaceIds, q, limit, tag] as const,
    // A chat list is never «fresh enough»: it shows what it has and asks again.
    staleTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const p = new URLSearchParams();
      if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
      if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
      if (tag) p.set('etiqueta', tag);
      if (q) p.set('q', q);
      p.set('limit', String(limit));
      return fetchJSON<ConversationFeedView>(`/api/conversations/feed?${p}`, signal);
    },
  };
}
