# Comms + acceso — material de construcción (WIP, no mergear a `main`)

> Esta rama (`feat/comms-threads`) fue reconstruida el 2026-07-20 para contener
> **solo lo que aún no puede vivir en `main`**. El pensamiento ya es canon en
> `main`; aquí queda el material a medio construir. Reconstruida sobre `main`
> `2176eec`. La historia completa anterior (incluida la autoría commit a commit
> de la migración) está en el tag `archive/comms-threads-2026-07-20`.

## Qué es canon y YA está en `main` (no rehacer)

- **ADR-082** (personas/roles/acceso), **ADR-083** (capa de comms), **ADR-085**
  (el invitat + delegación acotada) — en `_decisions.md`.
- **Dos escaleras + la faceta como primitivo** — en `build/structure-model.md`.
- **Digest del grill** — `_notes/spec-access-comms-decisions.md`.
- **Review de 32 hallazgos de la migración** — `_notes/review-comms-migration-2026-07-20.md`.

## Qué vive SOLO aquí (el material de construcción)

- **`build/migrations/2026-07-20_comms_threads_and_membership.sql`** — 604 líneas,
  **NO APLICADA**. 2 enums, 7 tablas (`facet`, `facet_level`, `membership`,
  `membership_facet`, `thread`, `thread_participant`, `message`), 4 funciones,
  9 políticas, triggers y rollback. Aditiva pura.
- **`app design/` + `build/access-comms-design-prompt.md`** — los 7 prototipos
  de acceso/comms y su contrato de diseño. Enlazan el `base.css` real; no entran
  en el build.
- **`_notes/review-prototypes-2026-07-20.md`** — review de esos prototipos.

De **código de aplicación no hay nada**: ni ruta, ni componente, ni endpoint.

## Por qué está bloqueado (detalle en `main`, `_tasks.md § Bloqueado`)

1. **El `invitat` no tiene forma de autenticarse.** El schema puede guardarlo
   (`membership.user_id IS NULL` + `ends_at`) pero todo camino de lectura se
   apoya en `auth.uid()`. `workspace_invitation` (que `main` ya construyó) no
   sirve: exige login verificado. Y el invitat **escribe** — sería la primera
   escritura anónima del sistema. Patrón a copiar si se hace: el de
   `workspace_invitation` (token hasheado + `expires_at` + revocación), no el de
   los shares (token en claro, sin caducidad).
2. **Falta la RPC de expansión de presets.** Sin ella no se escribe ni una fila
   en `membership_facet` → la etapa 1 nace muerta. Además la etapa 2 se encareció
   al partirse `has_permission` en `main`.
3. **Defecto nuevo del backfill**: `project_membership` se retro-rellena sin
   `accepted_at`, pero el guard `accepted_at IS NOT NULL` rechaza esas filas →
   toda membresía de proyecto nacería inerte. Corregir antes de aplicar.

## La puerta de producto (ADR-085, es de Marco)

> Usar la app durante una temporada de difusión real antes de construir nada de
> esto. Mientras no se cumpla, resolver los bloqueantes es trabajo especulativo.

## Cómo retomar el día que toque

1. `git rebase main` (esta rama irá muy por detrás; el rebase es obligatorio).
2. Reconciliar la migración con lo que `main` cambió desde entonces
   (`has_permission` partido, `read:performance`, matriz RBAC, money v2).
3. Cerrar el defecto del backfill y los hallazgos del review que siguen abiertos.
4. Decidir arquitectura del invitat y escribir la RPC de expansión de presets.
5. Solo entonces: aplicar la migración con backup/preflight y tests RLS.
