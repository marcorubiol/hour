# Hour: estado del proyecto

> Foto del estado actual, verificada el 2026-10-10. La historia (reconciliaciones fechadas, runtimes y pases
> anteriores, el inventario de producto de julio a septiembre) está en `_notes/context-history.md`.
> Si otro fichero contradice esta foto sobre el presente, gana esta foto; si contradice una decisión estable, mirar
> `_decisions.md`. Producción es lo que dice `/health/live`, no esta foto: comprobarlo antes de actuar.

## Lectura mínima al entrar

1. `_context.md`: qué es Hour y dónde está.
2. `_tasks.md`: única cola de trabajo (también es el roadmap).
3. `build/architecture.md`: arquitectura técnica y límites de seguridad.
4. `build/structure-model.md`: modelo de producto (lente, contenedor, módulo, tarea).
5. `_decisions.md`: ADR cronológicos; historia, no estado operativo.
6. `build/runbooks/`: solo para operaciones concretas.

No usar como instrucciones `build/archive/` ni los snapshots de `_notes/`.

## Qué es Hour

SaaS B2B multi-tenant para compañías pequeñas y medianas de artes en vivo. Une difusión, conversaciones,
planificación, producción, road sheets, equipo, tareas y dinero. Sustituye Excel, Drive, correo, Notion y WhatsApp
dispersos, sin sustituir la gestoría ni construir compliance laboral español.

Dirección: una capa de IA proactiva y consent-first sobre el mismo grafo operativo. La IA propone, una persona
aprueba, el sistema ejecuta y deja auditoría. UI manual e IA leen y escriben los mismos contratos.

## Fase

**Phase 0: herramienta interna funcional, endureciéndose para beta privada.** Uso real: Marco, MüK Cia / MaMeMi y
fixtures. Sin billing ni self-service. Modelo ya multi-workspace y multi-account. La beta externa espera a cerrar lo
de Phase 0.9 en `_tasks.md`. Pricing orientativo, no decidido.

## Producción (verificado 2026-11-03)

- Web `https://hour.zerosense.studio`, Worker `hour-web`. `/health/live`: SHA **`99d34c18`**, `dirty:false`, builtAt
  2026-11-08T07:00Z (99 invitaciones con diseño, ADR-190; Worker 5afe6ab2; RLS 603/604, el rojo es una fila sobrante de test en `note.test.ts`, no una fuga. Antes, fafd2bbf: fechas ambiguas al importar WhatsApp. Antes, eaeae4c5: 128 importar WhatsApp, ADR-189, y 105 declaración de público, ADR-191; Worker 304c1c5b; RLS de whatsapp-import y audience 30/30. Antes, a7b3a2e1: panel de conversación, ADR-184/185/186, E2E verde al repetir; antes, scroll del panel de Conversaciones; antes, 121 A y B, ADR-182 y 183, RLS 23/23 y E2E de llamada 7/7. Antes, ADR-181 el correo de cada día con nombre y cita; ADR-180 los correos de envíos y su pantalla, E2E de envíos verde al repetir. Antes, ADR-179, Conversaciones rediseñada; E2E 8 rojos, 7 de red, 1 spec atrasado arreglado. Antes, 125: la barra busca y la pastilla filtra, ADR-178; pulido de Conversaciones. E2E 44/44 contra 123fe4d3. Antes, 120: la hoja del técnico y el cierre por rol de la hoja pública, el bolo como historia, la fila de «Te espera»; antes, 78 la temporada por espacio; antes, 111 el correo original, 123, 122, 101, 103, 106, 102; antes, la ficha de la sala y del proyecto como espejo, 117; el tipo de cada contacto, 115; antes, «Enviar al equipo» visible siempre en el grupo del bolo; antes, Hour de un vistazo, ADR-177: la fila de la lista con persona u organización, tipo y lugar, turno, Zona y Tipo, «Ya está» (114); el cuadro de escribir y el grupo del bolo dicen quién lo lee (113); barra lateral sin «Ámbitos» (116); el pie de cada invitación en el idioma de su suscripción (104). Antes, 110, 112 y 109 en móvil; lo anterior, en `CHANGELOG.md`).
- Despliegue: `pnpm --filter web run deploy` (no `pnpm deploy` desde la raíz). Exige árbol limpio.
- Supabase `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`. Plan Free, con keepalive diario
  (`.github/workflows/keepalive.yml`) contra la pausa por inactividad. Pasar a Pro antes de la beta, aún no
  (`_tasks.md § 9`). Si algo de Supabase falla tras días sin uso, lo primero es `dig <ref>.supabase.co`.
- **Última migración aplicada: `20261108120000`** (99, `mailout_design`; backup 42456419019, inspect 42456633786, plan 42456702668, apply 42456774686). Antes, `20261108110000` (105, `audience_import_statement`, con `20261108100000` (128, `whatsapp_import`); backup 42384840719, inspect 42385116756, plan 42385189596, apply 42385251990). Antes, `20261107100000` (127, `mail_ingest_placement`: cada correo a un solo sitio, el más reciente como suposición; backup 42369883075, plan 42370067753, apply 42370109472; RLS de correo 41/41). Antes, `20261106100000` (121 B, «Llego tarde»; backup 42111959215, plan 42112367735, apply 42112516707). Antes, `20261105120000` (120, `public_roadsheet_role_matrix`, con `20261105110000` `bolo_confirmed_at`; backup 41982223946, plan 41982617996, apply 41982679479). Antes, `20261104170000` (78, `season_start`; backup 41818731108, plan 41819148700, apply 41819212684). Antes, `20261104160000` (con 120000, 130000, 140000 y 150000: 122, 111, 102, 106 y 123; backup 41789151620, plan 41794238427, apply 41796217265). Antes, `20261104110000` (115, `organization_kind_solo`: tipo `solo`; backup 41783655466, plan 41784072303, apply 41784108354). Antes, `20261104100000` (100, `mailout_record_event` con destinatario `skipped`; backup 41781683182, plan 41781990995, apply 41782128356) y `20261103120000` (114, `conversation_feed_kind_city`, firma de 17 a 19, 2026-11-03; backup 41588846019, plan 41589148099, apply 41589540728). La anterior, `20261103100000` (104, idioma por suscripción; backup 41586702676, plan 41587055034, apply 41587173321). Las anteriores, en `_notes/context-history.md`. Las migraciones van por `production-migrate.yml`: backup, plan, apply. **Al redefinir una función, copiar la firma de la base viva (`pg_get_functiondef`), no de la última migración que la nombra: otra firma crea una sobrecarga y PostgREST responde 300.**
- `hour-staging` (ref `slccyknqpgmzhyiyclsq`, `eu-west-1`): reconstruido el 2026-10-13 con el contract de permisos
  (run 38469017859: RLS 309/313, smoke 2/2). Se volverá a pausar sin uso.
- Suites contra `63356312` (2026-11-04): RLS 562, con 3 rojos en `conversation-feed` por el 123, arreglados en `abd1a42b` y 9/9; E2E 174 ok, 4 rojos, 17 saltados: 3 intermitentes verdes al repetir; `open-speed:123` (frío 12,3 s frente a 9 s) sigue rojo, con la red inestable ese día.
- E2E del 115 y el 117 contra `bb5f518e` (2026-11-04): 21/21 (sheet-mirror, conversation-write, acquaintance, organization-record, person, scope-url, tags). RLS 559/559 tras la migración del 100.
- Últimas suites contra producción, contra `16e87b79` (2026-11-03): RLS 558/558 (el test del feed, corregido en `a5c2b567`); E2E 167 ok, 8 rojos, 17 saltados, 3 sin correr; 5 rojos intermitentes por red o tiempo, verdes al repetir; los otros, specs atrasados, puestos al día en `a5c2b567` y `70673fc2` y verdes contra producción. Los specs del público necesitan `.env` además de `.env.test`. No prestar `.playwright/auth.json` a otro carril mientras corre la suite. Por `hour-web.marco-rubiol.workers.dev`.
- Desde el checkout principal (`~/Developer/hour`), nunca desde un worktree: los worktrees no llevan `.env` ni
  `.env.test` (RLS sale saltado, el login del E2E falla).
- `pnpm --filter web test:rls`: siempre contra producción; carga `.env` + `.env.test` y no mira `.env.local`.
- E2E contra un origen desplegado: `PW_BASE_URL=https://hour.zerosense.studio npx playwright test`. Nunca contra
  `vite preview` (no hay `platform.env`, así que no hay Supabase).
- Si Playwright pide otra revisión de Chromium, `PW_CHROMIUM` apuntando a una instalada, p. ej.
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- `.env.local` apunta `vite dev` a una Supabase local (`127.0.0.1:54321`) sin los usuarios fixture: ante un
  `invalid_credentials`, preguntar primero contra qué base se mira.
- `testing` (owner Marco) tiene datos de prueba plantados el 2026-10-15: proyecto «Obra de prueba», 8 conversaciones con historial, hilos y un bolo.
- El usuario del E2E no pertenece a `muk-cia` ni a `marco-rubiol`; las 154 conversaciones de `muk-cia` son reales.

## Modelo y vocabulario

- `account` = pagador; `workspace` = límite RLS; `project` = obra/producción; `line` = agrupación componible.
- `person` = identidad portable; `workspace_person` = dossier local privado; `workspace_organization` = organización.
- `conversation` = diálogo de difusión (nunca `engagement`).
- `performance` = función: día, hora, road sheet, sin dinero (ADR-087). Nunca `show` en código vivo.
- `bolo` = unidad de dinero: el trato con una sala, agrupa 1..N funciones; caché, cobro y factura cuelgan del bolo.
- `date` = ensayo, viaje, prensa, day off u otro evento que no es función.
- Lentes (ADR-088): Desk es el digest; las tres lentes son Planner · Conversations · Books (ES `Cuentas`, ruta
  `/h/books`, ADR-119). Conversaciones tiene dos vistas: Conversaciones, una lista de chats con
  chips Todo · Te toca · Se enfría · Equipo, y Envíos (`?view=envios`), difusión, invitaciones, temporada y listas
  del público (ADR-176). Road sheet es una proyección de performance.
- Sin vocabulario CRM (`lead`, `pipeline`, `prospect`) salvo investigación o interoperabilidad.

## Arquitectura

SvelteKit 2 + Svelte 5 + TypeScript + Vite · Cloudflare Workers + R2 + Durable Objects (`y-partyserver`) · Supabase
Cloud (Postgres 17, Auth, RLS, Realtime, pgmq) · Valibot, TanStack Query, Vitest, Playwright, Sentry. Monorepo pnpm:
`apps/web` y `apps/collab`. Valores públicos de Supabase en `apps/web/.env`; secretos en `.env.test`, Keychain o
Wrangler (`build/setup.md`, `build/runbooks/test-user-setup.md`).

## Reglas para cualquier agente

1. Antes de escribir código: `/Users/marcorubiol/Zerø System/03_AGENCY/_area-methød/code/philosophy.md`.
2. Nav, lentes, módulos o detalle: `build/structure-model.md`.
3. Estado inestable, con evidencia (health, Git, catálogo, tests); nunca una frase de un prompt.
4. `_tasks.md` es la cola; ninguna otra.
5. `_decisions.md` es append-only: `Superseded by ADR-…` en vez de reescribir.
6. No ejecutar nada de `build/archive/`.
7. No tocar `auth.users` directamente; Supabase Auth Admin.
8. Schema solo con migración, backup proporcional, tipos regenerados y tests RLS. Una columna nueva de
   `performance` no existe para PostgREST hasta nombrarla en su grant por columnas.
9. No desplegar un árbol sucio.
10. Secretos en Wrangler, Keychain o `.env*` gitignored; nunca en Git (el repo es público).

## Dónde vive cada verdad

| Pregunta | Fuente |
|---|---|
| ¿Qué hacemos ahora? | `_tasks.md` |
| ¿Qué se entregó? | `CHANGELOG.md` |
| ¿Por qué se decidió? | `_decisions.md` |
| Arquitectura, producto, pantallas | `build/architecture.md`, `build/structure-model.md`, `build/screen-data-spec.md` |
| ¿Qué pasó antes? | `_notes/context-history.md`, `_notes/sessions-log.md` |
| Operar producción, backup, beta | `build/runbooks/` |
| Investigación | `research/INDEX.md` |

## Siguiente paso

Abrir `_tasks.md`. Lo grande después del Planner es comms (ADR-082/083), aparcado a propósito tras el portón de
Marco; y contenedores (bloque 5).
