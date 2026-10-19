/**
 * El vocabulario de etiquetas para la pantalla (ADR-138): una sola lectura
 * para la lente, la ficha y «Añadir». Aparte de `conversation-tags.ts`, que lo
 * importan también los endpoints y no puede tirar de `$lib/api` (cliente).
 */

import { fetchJSON } from './api';
import type { TagVocabulary } from './conversation-tags';

export function conversationTagsQueryOptions(enabled = true) {
  return {
    queryKey: ['conversation-tags'] as const,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<TagVocabulary>('/api/conversation-tags', signal),
  };
}
