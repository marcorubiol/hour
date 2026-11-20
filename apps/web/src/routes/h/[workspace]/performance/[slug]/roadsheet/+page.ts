// La vista previa por rol vive en «Compartir», dentro del pase (ADR-230): esta
// página, que fue la del operador, redirige allí; `?share=1` abre el diálogo.
// Una carga completa la redirige el hook (`hooks.server.ts`); una navegación
// dentro de la app, aquí.
import { redirect } from '@sveltejs/kit';

export function load({ params }) {
  redirect(301, `/h/${params.workspace}/performance/${params.slug}?share=1`);
}
