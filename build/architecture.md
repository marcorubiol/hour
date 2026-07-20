# Hour — arquitectura vigente

> Documento técnico vivo. Reconciliado el **2026-07-20** con código, tipos
> generados, Supabase y producción. Estado operativo: `../_context.md`. Trabajo
> pendiente: `../_tasks.md`. El documento anterior está archivado en
> `archive/2026-07-17-architecture-snapshot.md`.

## 1. Límites del sistema

Hour es una aplicación web multi-tenant para operaciones de artes en vivo. El
límite de seguridad es PostgreSQL RLS, no la UI ni el Worker.

```text
account (facturación)
└── workspace (tenant / límite RLS)
    ├── memberships + role catalog
    ├── people dossiers + organizations
    └── project
        ├── project memberships
        ├── lines / modules
        ├── conversations
        ├── performances + dates
        ├── cast / crew / venues / assets
        ├── tasks
        └── invoices / payments / expenses
```

No existe `project.type`: la combinación de subentidades da forma al proyecto.
Road sheet es una proyección de performance y sus relaciones, no otra entidad.

## 2. Stack

| Capa | Implementación |
|---|---|
| Frontend/full-stack | SvelteKit 2 + Svelte 5 + TypeScript |
| Build/runtime web | Vite + `@sveltejs/adapter-cloudflare` + Worker `hour-web` |
| Server state | TanStack Query |
| Validación | Valibot en fronteras `+server.ts` |
| Base/Auth | Supabase Cloud, Postgres 17, Auth, RLS, Realtime, pgmq |
| Data access | Cliente PostgREST fino sobre `fetch`; JWT reenviado explícitamente |
| Media | Cloudflare R2 |
| Colaboración | Yjs + `y-partyserver` sobre Durable Object `hour-collab` |
| Observabilidad | Sentry + logs JSON + request id + health endpoints |
| Testing | Vitest, suite RLS live, Playwright, Node test para collab |
| Monorepo | pnpm workspaces |

Este stack es una decisión firme. Los problemas actuales no justifican migrar a
otro framework o proveedor.

## 3. Runtimes y entornos

### Producción interna

- `https://hour.zerosense.studio`
- Worker `hour-web`; assets estáticos + SSR/API en el mismo runtime.
- Supabase `hour-phase0` (`lqlyorlccnniybezugme`, `eu-central-1`).
- Durable Object separado `hour-collab`.
- R2 bucket `hour-media`.
- `/health/live` publica SHA, dirty flag y build time.
- `/health/ready` comprueba la dependencia Supabase.

### Desarrollo

- `pnpm dev` en `localhost:5173`.
- Por defecto usa el proyecto cloud configurado en `apps/web/.env`.
- El baseline local es reproducible con `pnpm db:reset`; Auth se aprovisiona
  mediante `supabase/fixtures/provision-auth.mjs` y los datos sintéticos desde
  `supabase/fixtures/staging.sql`.
- `.env.test` añade fixtures para e2e/RLS y nunca se versiona.

### Staging

Existe `hour-staging` (`slccyknqpgmzhyiyclsq`, `eu-west-1`) y se reconstruye
desde cero con `.github/workflows/staging.yml`. El workflow crea tres identidades
sintéticas, carga fixtures deterministas, ejecuta RLS, build y smoke sin tocar
datos de producción. El restore drill desde R2 también está automatizado.

## 4. Identidad y multi-tenancy

### Account, workspace y acceso

- `account` representa quien paga; puede contener varios workspaces.
- `account_membership` controla ownership/facturación.
- `workspace` es el tenant y el límite de RLS.
- `workspace_membership` dice si un usuario pertenece y su nivel
  `owner|admin|member|viewer|guest`.
- `project_membership` contiene `roles[]`, `permission_grants[]` y
  `permission_revokes[]` por proyecto.
- `workspace_role` es el catálogo editable de roles del workspace.

Permiso efectivo:

```text
union(permisos de roles) + grants explícitos - revokes explícitos
```

Owner/admin del workspace tienen bypass por proyecto. El vocabulario cerrado
actual es:

```text
read:money
read:performance
read:conversation
read:person_note_private
read:internal_notes
edit:performance
edit:conversation
edit:money
edit:project_meta
edit:membership
admin:project
```

`read:performance` separa lectura y escritura. `edit:performance` implica lectura
para conservar compatibilidad, pero un performer/guest asignado puede leer su
producción sin obtener escritura. Owner/admin acceden a todos los proyectos del
workspace; el resto solo a proyectos con `project_membership` explícita.

### Persona portable sin expediente global compartido

- `person` contiene la identidad portable/deduplicable.
- `workspace_person` contiene el dossier privado y la visibilidad de cada
  workspace.
- `workspace_organization` contiene organizaciones/contactos locales.
- Compartir una persona es explícito y revocable; no comparte automáticamente
  notas, conversaciones ni expediente de otro workspace.
- `user_profile.person_id` puede unir una cuenta con su identidad personal.

Este modelo permite que una misma persona participe en varias compañías con
roles distintos sin mezclar sus datos tenant-scoped.

## 5. Auth y sesiones

- Proveedor: Supabase Auth, email+password; TOTP opcional en el modelo.
- La app guarda access/refresh tokens en cookies **HttpOnly + Secure +
  SameSite=Strict**; no en localStorage.
- Endpoints: `/api/auth/login|signup|refresh|logout|session|token`.
- `custom_access_token_hook` inyecta `current_workspace_id` en el JWT.
- El login compone el Rate Limiting nativo de Workers (10/min/IP, para
  ráfagas) con una ventana KV independiente (10/5 min/IP, para intentos
  secuenciales); refresh y Sentry tunnel conservan cuotas KV.
- Invitación y acceso se administran desde Settings sin SQL: token hasheado y
  caduco, preview/aceptación con email verificado, cambio de rol y revocación.
- El plan Free de la zona admite una sola regla WAF de rate limiting y la
  regla activa de `wp-login.php` ya ocupa 1/1. Se conserva esa protección y
  Hour usa el binding nativo de Workers, respaldado por KV, sin dejar el login
  únicamente a cargo de un contador KV no atómico.
- Leaked-password/HIBP está bloqueado por el plan Free de Supabase.

No crear usuarios insertando en `auth.users`: usar Auth Admin API/Dashboard.

## 6. Modelo operativo

### Contenedores

- `workspace` → `project` → `line`.
- Los módulos editables viven exclusivamente en line y se componen por
  `line.modules`/`line.kind`.
- Las lentes (`Desk`, `Planner`, `Conversations`, `Money`) leen el sistema
  transversalmente; no poseen lógica de edición de entidades.

### Conversaciones y contactos

- `conversation` es workspace/project-scoped y referencia person/organization.
- Estados anti-CRM: contacted, in conversation, hold, confirmed, declined,
  dormant, recurring.
- Próxima acción y last-contact alimentan Desk; Conversations v1.5 ampliará la
  captura y el timeline.

### Tiempo

- `performance` representa el bolo/función y su lifecycle de holds.
- `date` representa ensayo, residencia, viaje, prensa, day off u otro evento.
- `availability_block` modela indisponibilidad/tentative por persona o compañía.
- Planner deriva conflictos, decisiones y away bands; no persiste una entidad
  `decision`.
- `calendar_share` y `/api/public/calendar` conservan Calendar por ser iCalendar.

### Producción y road sheet

- Cast canónico: `cast_member` a nivel project.
- Sustituciones: `cast_override` por performance.
- Crew: `crew_assignment` por performance.
- Assets: `asset_version` con dirección outbound/inbound/adapted.
- Road sheet público: `roadsheet_share` con token revocable y rol fijado.
- Texto colaborativo: Yjs; snapshots en `collab_snapshot`, materialización a
  `notes` tras persistir el snapshot/marker.

### Dinero

- `performance.fee_*`, `invoice`, `invoice_line`, `payment`, `expense`.
- `performance_redacted` oculta fee sin `read:money`.
- Trigger de escritura exige `edit:money` para cambiar fee.
- Money v2, condiciones/pagos observados, multi-currency correcto y documentos
  fiscales profundos siguen pendientes.

### Tareas e IA

- `task` puede ser libre o apuntar a project/line/performance/conversation.
- `from_at`, `due_at` y `lead_days` producen surfacing derivado en Desk.
- `origin='ai'` representa una propuesta real; aceptar/descartar es una acción
  humana sobre la tarea. No hay ejecución autónoma sin consentimiento.

## 7. RLS y puertas de escritura

- Toda tabla tenant-scoped usa ENABLE + FORCE RLS.
- Los reads simples se basan en membership; los datos de proyecto usan
  `has_permission(project_id, perm)`.
- Operaciones claim-bound o multi-fila pasan por RPC SECURITY DEFINER con
  `search_path` fijo, grants mínimos y checks explícitos.
- Funciones públicas por token se limitan a road sheet e ICS y devuelven una
  proyección saneada.
- Soft-delete que deja la fila invisible al updater se hace por RPC, no por
  PATCH directo.
- El Worker nunca sustituye RLS; valida forma/contrato y reenvía identidad.

La suite `apps/web/tests/rls/` golpea Supabase como anon, admin, fixture limitado
y usuario externo. Baseline actual: 118/118. Incluye cero acceso → invitación →
aceptación → revocación con el mismo JWT, además de aislamiento de fees y guest.

## 8. API

Las rutas SvelteKit viven en `apps/web/src/routes/api/` y se agrupan por dominio:

- auth, workspaces y alias;
- projects, lines, people/team y venues;
- conversations y notes;
- performances, dates, availability, Planner shares;
- tasks;
- invoices, money y expenses;
- collab y road sheets públicos;
- health y Sentry.

Convenciones:

- Valibot whitelist en cada frontera de escritura.
- `{ error, detail?, hint? }` en fallos; no loguear tokens/body sensible.
- `platform.env` para bindings Cloudflare.
- Mutaciones con rollback optimista cuando la UI lo necesita.
- Slugs mutables + `previous_slugs`; UUID v7 como identidad estable.

## 9. Migraciones y reproducibilidad

El schema live evolucionó primero con SQL aplicado por MCP y después con una
carpeta Supabase normalizada. Por eso existen dos series:

- `build/migrations/`: historial legacy, necesario para auditoría.
- `supabase/migrations/`: checkpoint remoto y migraciones administradas desde
  2026-07-20.

`build/schema.sql` y `build/rls-policies.sql` son snapshots congelados. No deben
editarse como si fueran el schema actual.

El checkpoint de `supabase/migrations` es reconstructivo y se ha probado tanto
en Supabase local como en staging alojado. Las migraciones posteriores añaden la
matriz RBAC y el ciclo de invitación sin reescribir el historial aplicado.

Después de cualquier cambio DB:

1. preflight/backup proporcional;
2. migración transaccional cuando PostgreSQL lo permita;
3. regenerar `apps/web/src/lib/db-types.ts` desde live;
4. ejecutar RLS, unit, check y build;
5. consultar advisors y revisar grants públicos.

## 10. Deploy, CI y rollback

- `.github/workflows/ci.yml` ejecuta check/unit/build/collab sin secretos.
- Deploy manual mediante los scripts pnpm/wrangler de cada app.
- `scripts/assert-clean-tree.mjs` impide publicar un árbol sucio.
- El build stamp permite comparar producción con Git.
- Rollback: `build/runbooks/rollback.md`.
- Backup: GitHub Actions + R2; restore drill alojado verificado y documentado.

## 11. Límites y deuda arquitectónica

- El enlace de invitación es copy/send manual; envío transaccional de email no
  se finge como construido.
- Offline actual es scaffold, no road mode garantizado.
- Correo/WhatsApp todavía no aterrizan en `conversation_event`.
- HIBP requiere plan Supabase Pro.
- Totales cross-currency no son económicamente fiables.

La prioridad de estas deudas vive exclusivamente en `../_tasks.md`.

## 12. Layout del repo

```text
apps/web/                 SvelteKit Worker y producto
apps/collab/              Durable Object de colaboración
supabase/migrations/      historia administrada reciente
build/migrations/         historia SQL legacy
build/runbooks/           operaciones activas
build/archive/            planes/prompts/runbooks terminados
research/                 investigación fechada
_context.md               estado actual
_tasks.md                 cola actual
_decisions.md             ADR append-only
_notes/                   historia de sesiones y flux
```
