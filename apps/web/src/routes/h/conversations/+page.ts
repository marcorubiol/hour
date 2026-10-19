// Las vistas Difusión · Equipo de ADR-134 son hoy chips de etiqueta
// (ADR-138 § 2): `?view=team`, y el viejo `?view=threads` (ADR-116), van a
// `?etiqueta=team`. Una carga completa la redirige el hook
// (`hooks.server.ts`); una navegación dentro de la app, aquí.
import { redirect } from '@sveltejs/kit';
import { legacyViewRedirect } from '$lib/conversation-tags';

export function load({ url }) {
  const next = legacyViewRedirect(url.searchParams);
  if (next) redirect(301, `/h/conversations?${next}`);
}
