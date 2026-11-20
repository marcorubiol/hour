/**
 * Replies waiting for us («Te espera» on a phone), derived from the
 * conversations read Hoy ALREADY makes (`/api/conversations?limit=500&lean=1`).
 *
 * On a phone Hoy hides «Ha cambiado» and «La temporada», so the only thing it
 * ever read from `/api/conversations/overview` was `due.rows` with reason
 * `reply`. Computing those rows here using the exact same `dueReason` rule
 * eliminates a duplicate full-table conversations scan on every mobile open.
 */

import { conversationTitle, relationInputOf, type ConversationItem } from './conversation';
import { BLOCK_ROWS, dueReason } from './conversation-overview';
import type { OverviewReplyRow } from './desk-feed';

const FOLLOW_UP_ROWS = 2;

export function mobileReplyRows(
  conversations: readonly ConversationItem[],
  now: Date,
  size = BLOCK_ROWS,
): OverviewReplyRow[] {
  const replies: { item: ConversationItem; at: string; atMs: number }[] = [];
  let followUpCount = 0;

  for (const item of conversations) {
    const input = {
      ...relationInputOf(item),
      reply_settled_at: item.reply_settled_at ?? null,
      next_action_at: item.next_action_at ?? null,
    };
    const reason = dueReason(input, now);
    if (reason === 'reply' && input.last) {
      replies.push({ item, at: input.last.occurred_at, atMs: Date.parse(input.last.occurred_at) });
    } else if (reason === 'follow_up') {
      followUpCount++;
    }
  }

  replies.sort((a, b) => b.atMs - a.atMs);
  const replyCap = Math.min(replies.length, size - Math.min(followUpCount, FOLLOW_UP_ROWS));

  return replies.slice(0, replyCap).map(({ item, at }) => ({
    id: item.id,
    reason: 'reply',
    title: conversationTitle(item),
    workspace_id: item.workspace_id,
    project_id: item.project_id,
    at,
    tags: item.tags ?? [],
  }));
}
