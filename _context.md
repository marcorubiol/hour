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

## Producción (verificado 2026-10-20)

- Web `https://hour.zerosense.studio`, Worker `hour-web`. `/health/live`: SHA **`15846ea9`**, `dirty:false`, builtAt
  2026-10-31T08:02Z (ámbito como pastilla en la fila del título ADR-152, monograma de vuelta en Hoy, invitado de bolo en «todo», una fila de todo el día por venir es la tarjeta; antes Hoy como agenda ADR-150, «Lo mío / Todo» por espacio ADR-151; antes Hoy con el día entero en la tarjeta, «Después» y decisiones en Te espera, ADR-149; antes Hoy con la tarjeta primero ADR-148, Hour deja de adivinar quién va ADR-147; antes modo Ahora para el día de bolo, ADR-146; antes tirar hacia abajo actualiza en el móvil; antes Agenda: al traer días anteriores se ancla al día a la vista; antes densidad por pantalla ADR-145 fase 2; antes densidad transversal ADR-145, Difusión móvil con filtros en hoja y filas de dos renglones, cancelar lectura en vuelo tras escribir, login tras hidratación; antes título de lente en dos líneas con aire y «?» pegado; antes datos en el dispositivo, ADR-144; antes Hoy sin cascada: último envío aparte, consultas en paralelo, token de sesión único; antes móvil equilibrado: zona de toque invisible, margen lateral, área segura, barra de secciones con línea; antes tarjeta de Lo siguiente sin rectángulo blanco en opciones; antes iconos PNG para instalar en iPhone y Mac; antes E4: fuera `conversation.status` y su enum, y la ficha de función que aún lo pedía; antes lista de Conversaciones entera desde `conversation_feed`, facetas del espacio en Ajustes, el invitado en el Tablero; marco de /h para un invitado de bolo; aviso de fusión al aceptar una invitación, fusiones en Ajustes; acciones en bloque en Conversaciones, pantalla de fusión de persona, acceso al bolo en pantalla; lista de Conversaciones con fila única, fase 1; membresía de bolo y fusión de persona en la base, sin pantalla; alta en una línea que entiende texto, ⌘K que busca contactos, arreglos de la noche del 21-10; etiquetas del espacio en Ajustes, ⌘K que crea, crear desde la celda del Mes; Ajustes con desplegable bajo 1024; «Trae tu agenda» en Todas; etiquetas fase 3: «Todas» en una lista con `conversation_feed`; conversaciones del proyecto por id; Ajustes sin scroll lateral; antes Hoy aparte en el selector; búsqueda a la izquierda, lentes a la derecha y cuenta al raíl; selector de lentes en el marco, ADR-140; pantalla en blanco arreglada; antes ADR-139, limpieza con guard de tokens, decisiones del 20-10; E2E 132/135, 3 saltados). `main` == prod salvo documentos y tests.
- Despliegue: `pnpm --filter web run deploy` (no `pnpm deploy` desde la raíz). Exige árbol limpio.
- Supabase `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`. Plan Free, con keepalive diario
  (`.github/workflows/keepalive.yml`) contra la pausa por inactividad. Pasar a Pro antes de la beta, aún no
  (`_tasks.md § 9`). Si algo de Supabase falla tras días sin uso, lo primero es `dig <ref>.supabase.co`.
- **Última migración aplicada: `20261031100000_membership_view_scope`** (2026-10-31, run 41178406782; backup 41178130443): `membership.view_scope` y `set_my_view_scope`, aditiva. Antes, `20261023100000_conversation_status_contract` (2026-10-23, run 39993136462; backup 39992602954): E4 de ADR-138, fuera `conversation.status` y su enum, sin staging (Marco: nadie usa la app). Antes, `20261022200000_conversation_feed_list` (run 39840792767): la lista de Conversaciones sale entera de `conversation_feed`. Antes, `20261022180000_person_merge_notices` (run 39829389632), `20261022150100_bolo_access_for_screen` (run 39818343230), con `20261022150000_guest_no_task_availability_writes` (un guest no escribe tareas ni disponibilidad). Antes, `20261022130100_conversation_tag_reserved_keys` (run 39806060254), junto con `20261022100000_bolo_membership` (invitar a un bolo, membresía que caduca) y `20261022130000_person_merge` (fusión de dossier con deshacer). Antes, `20261021200000_delete_organization_person`, `20261021100000_conversation_feed` (lectura común de Conversaciones), `20261020160000_conversation_tags` (etiquetas fase 1), `20261020150000_help_seen` con `20261020140000` y `20261020140100`, y `20261020130000_create_conversation_one_signature`, que arregla la sobrecarga que dejó `20261020120000` (crear conversación falló de 07:49 a 08:15). Las migraciones van por `production-migrate.yml`: backup, plan, apply. **Al redefinir una función, copiar la firma de la base viva (`pg_get_functiondef`), no de la última migración que la nombra: otra firma crea una sobrecarga y PostgREST responde 300.**
- `hour-staging` (ref `slccyknqpgmzhyiyclsq`, `eu-west-1`): reconstruido el 2026-10-13 con el contract de permisos
  (run 38469017859: RLS 309/313, smoke 2/2). Se volverá a pausar sin uso.
- Últimas suites contra producción: RLS 492/492 contra `370bad9d` (2026-10-31); E2E contra `15846ea9` (2026-10-31, 24 min): 161 pasan, 5 saltados, 10 rojos; 8 se repiten (calm:103, desk:46, device-cache:81, money ×5, planner-laws:89, smoke:30) y son regresión de las fusiones del 31-10 (pastilla de ámbito, agenda de Hoy); carril `claude/e2e-regress` en curso. No prestar `.playwright/auth.json` a otro carril mientras corre la suite. Por `hour-web.marco-rubiol.workers.dev`.
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
  `/h/books`, ADR-119). Conversaciones tiene dos vistas: Difusión (Contratación en música) y Equipo
  (`?view=team`, ADR-134). Road sheet es una proyección de performance.
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
