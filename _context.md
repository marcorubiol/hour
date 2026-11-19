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

## Producción (verificado 2026-11-19)

- Web `https://hour.zerosense.studio`, Worker `hour-web`. `/health/live`: SHA **`247b0322`**, `dirty:false`, builtAt
  2026-11-19T12:07Z. Deploys del 19-11 con los PR 13 a 22: el pase corregido y Hoy en escritorio con su rejilla
  (ADR-217, ADR-218), la ruta `/h/today` (ADR-220), la lista de preparación fases 1 a 4 (ADR-221) y el enlace a la sala
  desde el pase. `CACHE_SCHEMA` 37. Lo entregado, en `CHANGELOG.md`.
- Última suite completa (19-11, contra `247b0322`): E2E de 219 specs, sin rojos que se queden. La pasada se cortó en
  la 198 y se retomó (24/24); `person:47`, `planner-month:125` y `roadsheet-share:17` cayeron y pasaron al repetirlos.
  `--timeout=90000`. RLS entera: 628/629 (19-11); el rojo (`money-v3` o `conversation-feed-list`, distinto cada vez)
  pasa al repetirlo solo.
- Despliegue: `pnpm --filter web run deploy` (no `pnpm deploy` desde la raíz). Exige árbol limpio.
  La integración Git de Workers Builds en `hour-web` está desconectada (Marco, 2026-11-18): fallaba en cada push
  sin `PUBLIC_SENTRY_DSN` y, de pasar, habría subido versiones sin el DSN. El único deploy es el manual; en los PR,
  la puerta es el CI de GitHub (`web` y `collab`).
- Supabase `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`. Plan Free con keepalive diario
  (`keepalive.yml`); Pro antes de la beta (`_tasks.md § 9`). Si falla tras días sin uso: `dig <ref>.supabase.co`.
- **Última migración aplicada: `20261119130000`** (quién cierra una cosa de la lista de preparación; backup
  44511459886, plan 44512039115, apply 44518374143, lanzados desde la rama del PR 21). Antes, el mismo día:
  `20261119110000` y `20261119120000` (la lista por proyecto y su estado por función, ADR-221) y `20261119100000`
  (`today` reservada, ADR-220). La anterior: `20261114100000` (149).
  Las anteriores, en `_notes/context-history.md`. Las migraciones van por `production-migrate.yml` (backup, plan, apply; usa `--include-all`). **Al redefinir una función,
  copiar la firma de la base viva (`pg_get_functiondef`): otra firma crea una sobrecarga y PostgREST responde 300.**
- `hour-staging`: ref `slccyknqpgmzhyiyclsq`, `eu-west-1`; se pausa sin uso.

### Cómo se corren las suites

- Desde el checkout principal, nunca desde un worktree: no lleva `.env` ni `.env.test` (RLS se salta, el login del
  E2E falla).
- `pnpm --filter web test:rls`: siempre contra producción; carga `.env` + `.env.test` y no mira `.env.local`.
  `test:rls -- <filtro>` corre la suite entera; para filtrar, `pnpm exec vitest run --project rls <ficheros>`.
- E2E contra un origen desplegado: `PW_BASE_URL=https://hour.zerosense.studio npx playwright test`, con `apps/web/.env`
  además de `.env.test` (sin él, los specs del público y `ahora.spec` se saltan). Nunca contra `vite preview` (no hay
  `platform.env`, así que no hay Supabase). No prestar `.playwright/auth.json` a otro carril mientras corre la suite.
- Trampas: el login admite 10 intentos por 5 min por IP (un setup colgado 30 s es eso: esperar 5 min); la red local
  se cae a media suite: ante muchos rojos, buscar `ERR_INTERNET_DISCONNECTED` y repetir con `--last-failed`.
  Intermitentes: `help:62`, `help:99`, `roadsheet-share:17`, `device-cache:98`, `conversation-filter-sheet:39`,
  `bolo-guest-frame:148`, `lens-toggle:68`. En `playwright`, `/api/search` tarda 5 o 6 s (tarea 150) y algunos specs se saltan por datos.
- Si Playwright pide otra revisión de Chromium, `PW_CHROMIUM` apuntando a una instalada, p. ej.
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- `.env.local` apunta `vite dev` a una Supabase local sin los usuarios fixture: ante un `invalid_credentials`,
  preguntar contra qué base se mira.
- `testing` (de Marco): datos de prueba y `trade=music` desde el 12-11. No responder el «¿Cuál es tu proyecto?» de
  `external@hour.test` (espacio `950352b3`, el único personal intacto).
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
