// «De qué se habla» (`?view=threads`, ADR-116) es hoy la vista Equipo de esta
// lente (`?view=team`, ADR-134). Una carga completa la redirige el hook
// (`hooks.server.ts`); una navegación dentro de la app, aquí.
import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  if (url.searchParams.get('view') !== 'threads') return;
  const params = new URLSearchParams(url.searchParams);
  params.set('view', 'team');
  redirect(301, `/h/conversations?${params}`);
}
