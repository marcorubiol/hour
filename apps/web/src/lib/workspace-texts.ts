/**
 * Textos guardados del espacio (89, ADR-171): lo que se repite al escribir
 * desde una conversación (presentación de la compañía, condiciones, un
 * párrafo de gira) y se inserta en el cursor del correo. La tabla es
 * `workspace_text` (`20261102120000_workspace_text`): la leen los miembros
 * internos y la escribe quien puede editar conversaciones en algún proyecto.
 */

import { fetchJSON } from './api';

export const TEXT_TITLE_MAX = 120;
export const TEXT_BODY_MAX = 20000;

export interface WorkspaceText {
  id: string;
  title: string;
  body: string;
  updated_at: string;
}

export interface WorkspaceTextsResponse {
  items: WorkspaceText[];
  /** Quien llama puede crear, editar y borrar (`edit:conversation` en algún proyecto). */
  can_edit: boolean;
}

/** Una caché por espacio: Ajustes y el redactor leen la misma. */
export function workspaceTextsQueryOptions(workspaceId: string, enabled = true) {
  return {
    queryKey: ['workspace-texts', workspaceId] as const,
    enabled: enabled && Boolean(workspaceId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<WorkspaceTextsResponse>(`/api/workspaces/${workspaceId}/texts`, signal),
    staleTime: 60_000,
  };
}

/** Lo que se guarda: título y cuerpo sin espacios de más en los bordes; null si falta alguno o se pasa. */
export function cleanText(title: string, body: string): { title: string; body: string } | null {
  const t = title.trim();
  const b = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!t || t.length > TEXT_TITLE_MAX || !b.trim() || b.length > TEXT_BODY_MAX) return null;
  return { title: t, body: b };
}

/** La primera línea del cuerpo, para la fila de Ajustes. */
export function textPreview(body: string, max = 90): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  const one = line.trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Por título, sin mayúsculas ni acentos: el menú del redactor y Ajustes, en el mismo orden. */
export function sortTexts(items: readonly WorkspaceText[]): WorkspaceText[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}
