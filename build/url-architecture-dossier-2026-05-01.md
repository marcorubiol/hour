# URL Architecture Dossier — Hour (2026-05-01)

> Status: dossier de evaluación. No reabre ADR-022; confirma su validez con tres ajustes operativos antes del scaffold del día 5 de Phase 0.0.
> Trigger: Marco no estaba convencido al 100% del shape `/h/[workspace]/[entity]/[slug]` y pidió alternativas evaluadas con razonamiento.

## 1. Resumen ejecutivo

**Recomendación: mantener `/h/[workspace]/[entity]/[slug]` como decisión por defecto, con dos refinamientos.** El shape de ADR-022 es defendible y supera a las cinco alternativas serias evaluadas en este momento del proyecto. Refinamientos: (a) reservar **explícitamente la lista de slugs prohibidos a nivel de workspace** ahora — no en "implementation finalization" — para no quemar el espacio raíz cuando llegue marketing/docs/blog en Phase 1; (b) dejar el subdomain `{workspace}.hour.zerosense.studio` documentado como **migración no-destructiva** (no como decisión actual) para activar en Phase 1 si se materializan vanity workspaces o un volumen alto de tráfico SEO sobre el marketing site. **No reabrir ADR-022 ahora.** Sí endurecer la sección "finalized at implementation" antes de escribir el scaffold del día 5 del sprint.

## 2. Estado actual (lo que dice ADR-022 + ADR-024)

- **Shape**: `/h/:workspace-slug/:entity/:slug-or-id`. Path-prefix multi-tenancy, no subdomain (Phase 0).
- **Entidades con URL canónica declaradas**: `house`, `room`, `run`, `gig`, `engagement`, `person`, `venue`, `asset`. Road sheet es sub-vista de gig: `/h/:workspace/gig/:slug/roadsheet`.
- **Public links** sólo road sheet en Phase 0: `/public/roadsheet/:signed-token` (partial D6).
- **Slugs**: hard reject + `previous_slugs text[]` para redirects. Uniqueness scope `(workspace_id, entity_type, slug)`. `id uuid` inmutable separado del slug.
- **Estado declarado**: "Firm on three-level principle and path-prefix multi-tenancy. Slug collision rules, full D6 activation, and Master View sharing-via-URL deferred to implementation."
- **SvelteKit fit (ADR-026, 2026-05-01)**: `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte` cubre el shape nativamente. Roadmap día 5 estructura el scaffold.

## 3. Inventario de entidades shareable

Reviso las 18 tablas del reset v2 (architecture.md §6, _decisions.md ADR-001..007) y filtro por: ¿tiene pantalla dedicada que un humano comparta por enlace?

| Entity (schema) | Producto | URL canónica? | Shape sugerida | Frecuencia uso real |
|---|---|---|---|---|
| `workspace` | House | Sí | `/h/[workspace]` | Alta — landing de tenant |
| `project` | Room | Sí | `/h/[workspace]/room/[slug]` | Alta — entrada principal del trabajo |
| `line` | Run | Sí | `/h/[workspace]/run/[slug]` | Media — tours/temporadas |
| `show` | Gig | Sí | `/h/[workspace]/gig/[slug]` | Alta — el "evento atómico" |
| `show` + roadsheet | — | Sí (sub-ruta) | `/h/[workspace]/gig/[slug]/roadsheet` | Alta — pantalla más compartida |
| `engagement` | — | Sí | `/h/[workspace]/engagement/[slug]` | Alta interna — Difusión es esto |
| `person` | — | Sí | `/h/[workspace]/person/[slug]` | Alta — 154 rows ya |
| `venue` | — | Sí | `/h/[workspace]/venue/[slug]` | Media |
| `asset_version` | Asset | Sí | `/h/[workspace]/asset/[slug]` | Media |
| `date` | — | **No** | — | Sub-render de Calendar/Gig |
| `invoice` / `invoice_line` / `payment` / `expense` | — | **Sí (Phase 0.3)** | `/h/[workspace]/invoice/[slug]` | Baja-media |
| `person_note` / `workspace_membership` / `workspace_role` / `project_membership` / `audit_log` / `crew_assignment` / `cast_override` | — | **No** | Sub-vistas de su entidad padre | — |

**Lectura**: 9 entidades necesitan URL canónica (más roadsheet como sub-ruta). De ahí los entity-folders en `src/routes/h/[workspace]/`. Sólo `invoice` se añade ya respecto al inventario de ADR-022 — money es Phase 0.3 pero la URL ya cabe en el shape sin tocar nada.

**Public no-`/h/`**: `/public/roadsheet/[signed-token]` (Phase 0), futuras `/login`, `/api/*`, `/playground` (dev), `/booking` (legacy ya servido). En Phase 1: `/`, `/pricing`, `/docs`, `/blog`, `/signup`, `/legal/*`.

## 4. Cinco alternativas evaluadas

Datos reales de Marco para todos los ejemplos: workspace `marco-rubiol`, project `mamemi`, una `engagement` con un programmer (slug ejemplo `marche-teatro`), un show ejemplo (slug `igualada-2026-04-12`).

### Alt A — `/h/[workspace]/[entity]/[slug]` (status quo ADR-022)

Ejemplo: `hour.zerosense.studio/h/marco-rubiol/gig/igualada-2026-04-12`
Ejemplo road sheet: `…/h/marco-rubiol/gig/igualada-2026-04-12/roadsheet`

- **Pros**: namespace anchor `/h/` reserva el espacio raíz para marketing/auth/docs sin colisionar con workspace slugs. Entidad explícita en URL → routing en SvelteKit es 1-folder-per-entity, layouts compartidos por workspace funcionan. Slug uniqueness `(workspace, entity, slug)` ya implementado (ADR-024). Compatible con migración futura a subdomain (Alt B) sin romper enlaces. URL legible incluso truncada.
- **Contras**: 4 segmentos antes del slug. Ligero ruido respecto a competidores (Linear: 2 segmentos; GitHub: 2). El prefix `/h/` no se autoexplica visualmente al primer vistazo (es jerga interna).
- **Coste de migración futura a Alt B (subdomain)**: bajo. Reescritura por regex + redirects 301 desde el path antiguo. `previous_slugs` no se ve afectado. El esquema de DB no cambia.

### Alt B — Subdomain por workspace `{workspace}.hour.zerosense.studio/[entity]/[slug]`

Ejemplo: `marco-rubiol.hour.zerosense.studio/gig/igualada-2026-04-12`

- **Pros**: máxima separación de tenants, "se siente" SaaS-grade (Slack, Linear vanity domains). URL más corta. Aislamiento de cookies natural por subdomain (defensa-en-profundidad). Permite vanity domains futuros sin reescribir routing.
- **Contras grandes para Phase 0**:
  1. **Cloudflare Workers + custom domain por workspace** requiere wildcard DNS + wildcard SSL + lógica de routing en el Worker para extraer el subdomain como param. No imposible, pero es ~1 día de infra para 1 workspace real.
  2. SvelteKit no tiene un mecanismo nativo de "subdomain como param". Hay que parsear `Host` en `hooks.server.ts` y reinyectar como `event.locals.workspace`. Custom code que no existe hoy.
  3. **Staging**: `hour-staging.zerosense.studio` ya es subdomain — necesitarías `marco-rubiol.hour-staging.zerosense.studio`, doble wildcard, complica DNS y certificados.
  4. Auth: redirect URLs de Supabase deberían ser comodín (`https://*.hour.zerosense.studio/**`); Supabase soporta wildcard pero es más fricción en cada cambio.
  5. CORS y cookies cross-subdomain → más superficie de configuración.
- **Cuándo activar**: Phase 1 si (a) hay >50 workspaces y SEO del marketing site importa, o (b) un cliente paga por vanity (`mamemi.hour.app`).
- **Coste de migración futura desde Alt A**: bajo (rewrites 301 + DNS).

**Veredicto**: prematuro para Phase 0. Coste de infra desproporcionado para 1 tenant real.

### Alt C — Sin prefix `/h/`: `/[workspace]/[entity]/[slug]`

Ejemplo: `hour.zerosense.studio/marco-rubiol/gig/igualada-2026-04-12`

- **Pros**: 1 segmento menos. Más memorizable. Más cercano a GitHub.
- **Contras**:
  1. **Workspace slug colisiona con cualquier ruta raíz futura**. Ya hoy `/login`, `/api`, `/booking` (legacy), `/playground` están en raíz. En Phase 1 se añaden `/`, `/pricing`, `/docs`, `/blog`, `/signup`, `/legal`, `/about`, `/marketing`, `/help`. Cada nueva ruta raíz se convierte en un slug **prohibido para workspaces** retroactivamente. GitHub mantiene una lista de >100 reserved usernames precisamente por esto.
  2. SvelteKit `[workspace]` en raíz **se traga todo lo demás** salvo si lo declaras explícitamente; cualquier nueva ruta raíz hay que añadirla **antes** de que se cree un workspace con ese slug. Riesgo operativo alto.
  3. Marketing site futuro en el mismo dominio queda canibalizado: `/pricing` puede ser un workspace.
- **Mitigación**: lista grande de reserved slugs (50-100 entradas). Funciona pero es deuda perpetua.
- **Coste de migración desde A → C**: bajo. Inverso es mucho más caro.

**Veredicto**: ahorro estético no compensa el coste de namespace permanente.

### Alt D — Slug global por workspace, sin entity en path: `/h/[workspace]/[slug]`

Ejemplo: `hour.zerosense.studio/h/marco-rubiol/igualada-2026-04-12` (type discovery por DB lookup)

- **Pros**: URL más corta, "Notion-like" sensación de wiki plano. El usuario no necesita saber si Igualada-2026-04-12 es un gig, un venue, o un asset.
- **Contras**:
  1. **Cambio de schema**: el partial unique index actual es `(workspace_id, entity_type, slug)`. Si el path no codifica entity, hace falta `(workspace_id, slug)` global. Eso elimina la posibilidad de tener `engagement/marche-teatro` y `person/marche-teatro` como entidades distintas dentro del mismo workspace — colisionan. Esto **es muy probable** porque engagement y person comparten "nombre humano" naturalmente.
  2. **DB lookup extra por request** para resolver el tipo antes de cargar la entidad. RLS necesita policy que primero adivine la tabla. Engineering tax.
  3. **SvelteKit routing**: un único `[slug]` que abre y dentro decide qué `+page.svelte` mostrar. Pierdes layouts por entity, pierdes type-safety en `+layout.server.ts` `params`, complicas tests.
  4. Pierdes legibilidad: `/h/marco-rubiol/igualada-2026-04-12` no le dice al lector si es un gig o un venue.
- **Coste de migración A → D**: alto. Cambio de index, de RLS, de routing, de UX (hay que renombrar entidades para evitar colisiones).

**Veredicto**: descartar.

### Alt E — Linear-style entity-prefix-id: `/h/[workspace]/[ENG-123]`

Ejemplo: `hour.zerosense.studio/h/marco-rubiol/GIG-45` o `MAM-GIG-45`

- **Pros**: identifier estable inmune a renombrado. Linear lo usa exitosamente. Auto-generado, sin pedir al usuario que invente nombres.
- **Contras**:
  1. **Choca frontalmente con ADR-024** ("clean names"). Marco lo eligió explícitamente sobre el modelo Linear/Notion.
  2. Pierde el valor SEO/social (cuando llegue marketing) de URLs descriptivas tipo `/room/ombra`.
  3. La auto-numeración secuencial requiere counter por workspace + entity_type → trigger SQL (`SELECT COALESCE(MAX(seq), 0) + 1`) o secuencia. Manejable pero es complejidad nueva.
  4. Pierde el nombre humano del slug en URLs de pegado en email — "GIG-45" no le dice nada al destinatario.
- **Coste de migración A → E**: medio. Mantener ambos (slug + ENG-id) es viable pero duplica superficie.

**Veredicto**: contradice ADR-024 reciente y bien fundamentado. Descartar.

(Las variantes "Notion UUID" y "GitHub `/[workspace]/[slug]`" caen dentro de los mismos análisis: UUID = pierdes legibilidad, sin valor; GitHub = igual que Alt C.)

## 5. Recomendación final

**Mantener Alt A (`/h/[workspace]/[entity]/[slug]`)** con tres precisiones:

1. **Cerrar la lista de reserved slugs ANTES del scaffold del día 5**, no en "implementation finalization". Reservar **al menos** estos a nivel de `workspace.slug`:
   - Sistema/router: `h`, `public`, `api`, `auth`, `login`, `logout`, `signup`, `signin`, `signout`, `oauth`.
   - Marketing futuro Phase 1: `www`, `app`, `home`, `about`, `pricing`, `docs`, `blog`, `help`, `support`, `legal`, `terms`, `privacy`, `contact`, `careers`, `status`, `changelog`.
   - Convenciones: `admin`, `settings`, `account`, `profile`, `billing`, `dashboard`, `new`, `edit`, `delete`, `search`, `explore`, `discover`.
   - Producto Hour: `house`, `room`, `run`, `gig`, `desk`, `plaza`, `roadsheet`, `engagement`, `person`, `venue`, `asset`, `invoice`, `calendar`, `contacts`, `money`, `comms`, `archive`.
   - Operacional: `staging`, `dev`, `playground`, `booking`, `assets`, `static`, `cdn`.
   - Total ~70. Listar en un `reserved_slugs.ts` y validar en `slug_generator()` SQL function (ADR-024 ya preveía esto).

2. **Documentar Alt B (subdomain) como Phase 1 migration path** en ADR-022. No reabrir, sólo añadir un párrafo "Migration path to subdomain". El compromiso es: si Phase 1 lo necesita, se hace 301 desde `/h/{w}/...` → `{w}.hour.app/...`. Coste estimado <1 día. Esto le baja el riesgo perceptual a Marco y resuelve el "no estoy convencido al 100%".

3. **Confirmar que `engagement` y `venue` y `asset` siguen como entidades canónicas en Phase 0** (ADR-022 las lista, pero el roadmap día 12-13 sólo menciona `room` y `gig`). Para no scaffoldear demás, abrir las rutas `/engagement/[slug]` y `/person/[slug]` ya en Phase 0.0 día 5 (son carpetas vacías con `+page.svelte` placeholder), pero diferir `/venue`, `/run`, `/asset`, `/invoice` a su Phase respectiva.

**Por qué descartar las otras ahora**:
- B (subdomain): infra cost desproporcionado para 1 tenant; reversible cuando crezca.
- C (sin `/h/`): namespace permanente quemado; la línea de marketing Phase 1 es real.
- D (slug global sin entity): cambio de schema, colisiones engagement/person inevitables, pérdida de legibilidad.
- E (entity-prefix-id): contradice ADR-024 y el research de 10 SaaS que respaldó "clean names".

## 6. Implicaciones de implementación inmediata (Phase 0.0 día 5)

**Estructura `apps/web/src/routes/`** (post-ADR-026):

```
src/routes/
├── +layout.svelte                  # Shell global (head, fonts, error boundary)
├── +page.svelte                    # Landing — Phase 0: redirige a /login si no auth, a /h/[workspace] si sí
├── login/+page.svelte              # Ya existe
├── booking/+page.svelte            # Legacy, mantener como redirect a /h/marco-rubiol/engagement
├── playground/+page.svelte         # Dev only
├── api/
│   └── engagements/+server.ts      # Ya existe
├── public/
│   └── roadsheet/[token]/+page.svelte   # Phase 0 D6 partial
└── h/
    ├── +layout.server.ts           # Auth guard global de /h/
    └── [workspace]/
        ├── +layout.server.ts       # Resuelve workspace por slug (+ previous_slugs fallback), 404/403
        ├── +layout.svelte          # Shell Plaza+Desk+Sidebar (ADR-009)
        ├── +page.svelte            # House overview (Desk)
        ├── room/[slug]/
        │   ├── +page.server.ts     # Carga project + sub-entidades
        │   └── +page.svelte
        ├── run/[slug]/+page.svelte           # Phase 0.2
        ├── gig/[slug]/
        │   ├── +page.svelte                  # Gig detail
        │   └── roadsheet/+page.svelte        # Phase 0.2 (ADR-023)
        ├── engagement/[slug]/+page.svelte    # Phase 0.0 placeholder
        ├── person/[slug]/+page.svelte        # Phase 0.0 placeholder
        ├── venue/[slug]/+page.svelte         # Phase 0.3
        ├── asset/[slug]/+page.svelte         # Phase 0.5
        └── invoice/[slug]/+page.svelte       # Phase 0.3
```

3 `+layout.svelte` activos: raíz, `/h/` (auth), `/h/[workspace]/` (shell). Uno por nivel — no hay sobreingeniería.

**Validaciones en `+layout.server.ts` de `/h/[workspace]/`**:
1. Verificar que `params.workspace` no está en la lista de reserved slugs (404 si lo está — defensa en profundidad incluso si SvelteKit ya resolvió la ruta).
2. Resolver workspace por `(slug = params.workspace)`; si no existe, fallback a `previous_slugs @> ARRAY[params.workspace]` y emitir redirect 301.
3. Comprobar `workspace_membership` para `auth.uid()`. Sin membership: 404 (no 403 — no leakear existencia de tenant).
4. Setear `event.locals.workspaceId` para el resto del request tree.
5. Re-emitir JWT con `current_workspace_id` correcto si el usuario tiene varios workspaces y está navegando a uno distinto al claim actual (ADR del 2026-04-19 sobre workspace switching).

**Cambios en schema**: ninguno respecto a ADR-024 cerrado. **Recomendación adicional**: añadir CHECK constraint o trigger que valide `slug NOT IN (reserved list)` en `workspace` y en cada tabla con `entity_type` reservado (ej. project no puede llamarse `roadsheet`, `team`, `members`).

**Que `slug_generator(name)` reciba** un parámetro `entity_type` ya está implícito en ADR-024 ("collision check within workspace scope"); confirmar que la lista de reserved slugs es per-`entity_type` (workspace tiene la lista global más estricta; project puede llamarse `home`, workspace no).

## 7. Riesgos y abiertos

1. **Colisión entity-name vs reserved sub-route**. Si en Phase 0.5+ se añade `/h/[workspace]/comms`, el segundo segmento `comms` debe estar reservado **a nivel `entity` enum**, no como slug de project. La lista reserved per-entity-type necesita actualizarse cada vez que añadimos un lens o entity. **Mitigación**: usar el enum de entity_type (`room | run | gig | engagement | person | venue | asset | invoice`) como conjunto cerrado al routing, y prohibir cualquier `params.entity` que no esté en el enum (404). SvelteKit lo da gratis si declaras carpetas explícitas en lugar de `[entity]` dinámico.
2. **Caso de slug renombrado durante una sesión activa**. `previous_slugs` resuelve el redirect, pero si el usuario tiene la pestaña abierta y otro renombra, recibirá un 301 en su próximo navigate. Aceptable — UX standard.
3. **Phase 1 multi-workspace switching**. El claim `current_workspace_id` se inyecta a partir de la **primera** membership aceptada (architecture.md §165). Si el user navega a `/h/otro-workspace/...` y tiene membership pero el claim apunta a otro, hace falta re-auth. ADR-022 no lo cubre; debe entrar en Phase 0.4 o Phase 1.
4. **Master View URL sharing** (D-PRE-05) deferred. Cuando se active, decidir si la querystring serializada va al canonical URL o a una ruta `?view=...` específica. No bloquea día 5.
5. **Public guest links full activation (D6)**: hoy sólo road sheet. Cuando se abra a otras entidades, decidir si se monta bajo `/public/[entity]/[token]` o `/h/[workspace]/[entity]/[slug]?token=...`. La primera es más limpia y no leakea workspace slug a externos no autenticados. Recomendado.
6. **`/booking` legacy**: mientras siga sirviendo a `/booking` directamente (sin pasar por `/h/`), hay una ruta de tenant fuera del namespace `/h/`. Acción: redirigir `/booking` → `/h/marco-rubiol/engagement` y sunsetar.
7. **i18n + locale prefix**: si Phase 1 activa `paraglide-sveltekit` con prefix `/[locale]/h/[workspace]/...`, cabe en el shape sin romper. Confirmar con D-PRE-03 cuando se materialice.
