/**
 * ¿Lee o edita conversaciones en ALGÚN proyecto? La puerta de la lente
 * Conversations (ADR-124), como `moneyAccessAnyQueryOptions` lo es de Cuentas.
 * Solo un «no» explícito esconde: mientras no responde, o si falla, se pinta
 * (quien la tiene no la ve parpadear; los datos siguen gateados por la RLS).
 */

import { fetchJSON } from './api';

interface ConversationAccess {
  read: boolean;
  edit: boolean;
}

export function conversationAccessQueryOptions() {
  return {
    queryKey: ['conversation-access'] as const,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<ConversationAccess>('/api/conversations/access', signal),
  };
}
