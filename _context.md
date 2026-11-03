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

- Web `https://hour.zerosense.studio`, Worker `hour-web`. `/health/live`: SHA **`9263105a`**, `dirty:false`, builtAt
  2026-11-03T04:46Z (Conversaciones como app de mensajería, ADR-176; 112; 109 en móvil; antes, línea de cifras del Planificador en las cuatro vistas; ADR-155 a 175: el público con pantalla, fases 1 a 3: listas, alta con doble confirmación, importación e invitaciones; base «contacto profesional del sector»; Ajustes › Este espacio con datos fiscales como bloque, plantilla del correo por espacio, materiales en la hoja de ruta, calendario «solo lo mío», Planificador con Temporada, caché por esquema, fichas de organización y sala, contrato del bolo, Cuentas para la gestoría, gastos por persona, sala con su organización, fusión de organizaciones, textos guardados; lo anterior, en `CHANGELOG.md`). `main` (`dec8d778`) lleva además el código del 104 y los specs al día; la migración del 104 sin aplicar.
- Despliegue: `pnpm --filter web run deploy` (no `pnpm deploy` desde la raíz). Exige árbol limpio.
- Supabase `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`. Plan Free, con keepalive diario
  (`.github/workflows/keepalive.yml`) contra la pausa por inactividad. Pasar a Pro antes de la beta, aún no
  (`_tasks.md § 9`). Si algo de Supabase falla tras días sin uso, lo primero es `dig <ref>.supabase.co`.
- **Última migración aplicada: `20261103120000`** (114, `conversation_feed_kind_city`, firma de 17 a 19, 2026-11-03; backup 41588846019, plan 41589148099, apply 41589540728). La anterior, `20261103100000` (104, idioma por suscripción; backup 41586702676, plan 41587055034, apply 41587173321). Las anteriores, en `_notes/context-history.md`. Las migraciones van por `production-migrate.yml`: backup, plan, apply. **Al redefinir una función, copiar la firma de la base viva (`pg_get_functiondef`), no de la última migración que la nombra: otra firma crea una sobrecarga y PostgREST responde 300.**
- `hour-staging` (ref `slccyknqpgmzhyiyclsq`, `eu-west-1`): reconstruido el 2026-10-13 con el contract de permisos
  (run 38469017859: RLS 309/313, smoke 2/2). Se volverá a pausar sin uso.
- Últimas suites contra producción: RLS completa 553/557 contra `49ffb30c` (2026-11-02; el único rojo, de red). E2E contra `9263105a` (2026-11-03): 158 ok, 12 rojos, 16 saltados, 8 sin correr; 2 intermitentes (`conversation-write.spec:199`, `planner-overview.spec:73`) y 10 specs atrasados con la 110, puestos al día en `106686b9` sin correr todavía. Los specs del público necesitan `.env` además de `.env.test`. No prestar `.playwright/auth.json` a otro carril mientras corre la suite. Por `hour-web.marco-rubiol.workers.dev`.
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
