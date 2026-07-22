# Build prompt — re-ancla money v3 al **bolo** (ADR-087, plan P2)

> Pega esto en un chat nuevo de Claude Code en el repo Hour. Ese chat NO tiene el
> contexto de la sesión donde se decidió esto — este documento es su brief
> completo. Léelo entero antes de tocar nada.

---

## 0. Antes de nada — lee la canon

Eres un agente construyendo en **Hour** (`/Users/marcorubiol/Developer/hour`), un
SaaS B2B multi-tenant para compañías de artes en vivo (SvelteKit 2 + Svelte 5 +
Cloudflare Workers + Supabase Postgres 17 con RLS). Lee, en este orden, antes de
escribir código:

1. `/Users/marcorubiol/Zerø System/03_AGENCY/_area-methød/code/philosophy.md`
   (regla #1 de `CLAUDE.md`: obligatorio antes de escribir código).
2. `_context.md` (estado canónico), `_tasks.md` (cola), `build/structure-model.md`
   (lentes/módulos/entidades), `build/architecture.md`.
3. **`_decisions.md § ADR-087`** — la decisión que vas a construir. Y ADR-086
   (money v3, que refinas), ADR-074 (money v2), ADR-023 (road sheet), ADR-050
   (invoice = snapshot del fee).

**Reglas duras** (de `CLAUDE.md`): no cambios de schema sin migración +
backup/preflight proporcional + regeneración de tipos + tests RLS; no desplegar
árbol sucio; `_decisions.md` es append-only; no ejecutar `build/archive/`; no
tocar `auth.users` directamente.

## 1. La misión, en una frase

Money v3 ancló el dinero al `performance` (la función). **ADR-087 dice que la
unidad de dinero es el `bolo` (el trato con una sala), que agrupa 1..N funciones.**
Tu trabajo: **re-anclar money v3 del `performance` al `bolo`** (plan **P2**: entidad
`bolo` nueva por encima de `performance`, el dinero sube, la función se queda como
está), **sin tocar** el scheduling/road sheet/planner. **Nada de esto está
desplegado** (vive en la rama `feat/money-v3-build`, sin mergear) — lo cazamos a
tiempo; por eso se **revisan** las migraciones de money v3, no se apila una capa
encima.

## 2. El modelo (ADR-087)

```
Conversación (difusión) → 1:N  Bolo (trato: UNA sala · caché · documento ·
                                     cobrado · pendiente)
                                 → 1:N  Función (performance: día·hora·road sheet,
                                                 SIN dinero)
```

- El **caché se negocia por bolo** (no por función). Un bolo = 1..N funciones.
- El bolo nace de una conversación confirmada **o** se crea a mano.
- **`pendiente = contratado (confirmado) − cobrado`**, independiente de facturar.
- Un bolo = **una sala**, un caché (hoy; ver "Fuera de alcance").

## 3. Dónde estás (comprueba antes de empezar)

- Rama: **`feat/money-v3-build`** (`git checkout feat/money-v3-build`). Contiene el
  build de money v3 (5 migraciones) + el wire de `/h/money`, todo anclado al
  `performance`, **sin desplegar**. `main` está en prod con money v2
  (performance-fee) — NO lo toques hasta desplegar.
- Las 5 migraciones de money v3 a **revisar** (en `supabase/migrations/`):
  `..._money_v3_fiscal_identity`, `..._invoice_document`, `..._invoice_issue`,
  `..._payment_decouple`, `..._fiscal_wiring`.
- El `performance` (checkpoint desplegado) tiene hoy: `fee_amount`, `fee_currency`,
  `venue_name`, `city`, `country`, `performed_at`, `status`, `conversation_id`,
  `line_id`, `project_id`, `slug`. **`fee_amount` es de money v2, YA desplegado** —
  moverlo al bolo es una migración con backfill que se aplica cuando money v3
  despliegue.

## 4. Plan P2 — qué se hace

**Sube al `bolo`** (lo mueves): `caché` (`fee_amount`/`fee_currency`), `venue_name`/
`city`/`country`, `conversation_id`, y las FKs de dinero. El bolo tiene:
`id, project_id, line_id (nullable), conversation_id (nullable), venue_name, city,
country, fee_amount, fee_currency, status, + default_fiscal_identity/document
según ADR-086, timestamps, deleted_at`. FORCE RLS gated por `read/edit:money` como
las demás tablas de dinero.

**Se queda en `performance`** (la función): `performed_at`, slots ADR-023, road
sheet, planner, agenda — INTACTO. Añades **`performance.bolo_id`** (FK al bolo).

**Re-ancla money v3** (revisa las migraciones): `invoice_line.performance_id` →
referencia el bolo (o mantiene función + bolo); `payment` ancla al **bolo** en vez
de `performance`; `collected` = pagos-vs-caché-del-**bolo**; `list_money_
performances` → **`list_money_bolos`** (una fila por bolo, con `collected`);
`create_invoice`/`issue_invoice`/`update_performance_fee` → operan sobre el bolo
(`create_invoice_from_bolo`, `update_bolo_fee`). El expense a nivel gig ancla al
bolo (o a la función — decide: el dinero es del bolo, así que probablemente al
bolo).

**Backfill:** cada `performance` existente → un `bolo` de N=1 que hereda
venue/caché/proyecto/línia/conversación; la función conserva su fecha/agenda +
recibe `bolo_id`. (En prod hay ~90 performances + fixtures.)

**Re-wire la UI** `/h/money` (ADR-087 la redefine): posición general arriba (por
moneda: pipeline · cobrado · **pendiente**); cuerpo = **bolos agrupados por obra**
(nunca por línia); cabecera de obra = contratado · cobrado · pendiente; el
**documento vive en el bolo** (chip que abre el PDF v3), no en sección aparte; las
funciones son sub-detalle del bolo. La tarjeta de bolo es **venue-first** (la sala
manda, la obra secundaria). Se estrecha por pins. Toca: `routes/h/money/+page.svelte`,
`lib/components/line/MoneyModule.svelte`, `MoneyInvoices.svelte`,
`lib/money.ts`/`moneybook.ts`/`invoice.ts`, y las API routes
`routes/api/money/**`, `routes/api/payments`, `routes/api/invoices`,
`routes/api/expenses`.

**NO toques:** road sheet (`lib/server/performance-bundle.ts`, `lib/roadsheet.ts`,
`lib/server/rosters.ts`), `routes/api/dates/**`, planner, `MonthGrid.svelte`, la
agenda del `performance`. Y respeta que Marco tiene WIP sin commitear de **Calm
mode** (`routes/h/+layout.svelte`, `h/desk`, `h/planner`, `MonthGrid.svelte`) — no
los toques ni los commitees.

## 5. Cómo verificar (receta local, ya probada esta sesión)

Supabase local con Docker. NO despliegues nada.

```bash
# aplicar migraciones en local (reconstruye desde cero)
pnpm exec supabase db reset --local
# regenerar tipos (NO hay npm script; escribe el fichero)
pnpm exec supabase gen types typescript --local > apps/web/src/lib/db-types.ts
# comprobar drift (debe decir "No schema changes found")
pnpm exec supabase db diff --local --schema public
# compilar + unit
pnpm --filter web check          # svelte-check, apunta a 0/0
pnpm --filter web test:unit      # apunta a 348+/348+
```

**RLS suite en local (integración; hoy 126/126)** — el reset borra fixtures, así
que recárgalos con la receta de CI (`.github/workflows/staging.yml`):

```bash
export PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY de `pnpm exec supabase status`>
export PW_TEST_PASSWORD=localtest123 PW_LIMITED_PASSWORD=localtest123 PW_EXTERNAL_PASSWORD=localtest123
node supabase/fixtures/provision-auth.mjs                 # crea 3 auth users
docker exec -i supabase_db_hour-phase0 psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/fixtures/staging.sql
# correr:
cd apps/web
export PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY de status>
export PW_TEST_EMAIL=playwright@hour.test PW_LIMITED_EMAIL=limited@hour.test PW_EXTERNAL_EMAIL=external@hour.test
pnpm exec vitest run --project rls
```

Fixtures clave: `playwright@hour.test` (admin), `limited@hour.test` (performer,
`read:money=false`), proyecto `zzz-e2e-collab`, la performance `zzz-e2e-1` (fee
2500 EUR). **Extiende `tests/rls/money-v3.test.ts`** al modelo bolo y añade
regresiones (que las 120 de v2 sigan verdes es la prueba de no-romper).

**Después de escribir las migraciones, haz una review adversarial** (varias lentes
+ verify) antes de dar por hecho — en esta sesión eso cazó una escalada RLS real en
las políticas de payment (OR de adjuntos en el WITH CHECK; debe ser AND: cada
adjunto poblado tiene que autorizar). Patrón de RLS money: FORCE RLS, `REVOKE`
defaults (los revoca `20260720164803_harden_data_api_defaults.sql`), funciones
`SECURITY DEFINER` con `SET search_path` + `REVOKE ... FROM anon, service_role` +
`GRANT ... TO authenticated`. `postgres` (owner de las funciones DEFINER) bypasea
FORCE RLS → así funcionan los contadores/tablas internas sin policy (patrón
`workspace_invitation` / `invoice_number_series`).

## 6. Secuencia sugerida (una fase, verificar entre cada paso)

1. **Entidad `bolo`** + `performance.bolo_id` + backfill (cada performance → bolo
   N=1). RLS + grants + índices FK. `create_bolo` / `update_bolo_fee` (claim-bound,
   `edit:money`). db reset → drift limpio → tipos → check.
2. **Mueve el dinero al bolo** revisando las 5 migraciones de money v3: fee, ancla
   de `payment`, `invoice_line`→bolo, `collected`-vs-caché-del-bolo,
   `list_money_bolos`, `create_invoice_from_bolo`, `issue_invoice`, expense-gig→bolo.
3. **API + tipos**: re-apunta `routes/api/money/**`, payments, invoices, expenses.
4. **UI `/h/money`** al layout ADR-087 (posición general → bolos por obra →
   documento en el bolo → funciones como sub-detalle; venue-first).
5. **Tests**: RLS money-v3 al modelo bolo; unit; svelte-check; review adversarial.
6. Actualiza `_tasks.md` (marca el re-ancla) y añade un Status a ADR-087 si algo
   estructural cambia (append-only). **No despliegues** — staging/prod es un paso
   gateado aparte con backup/preflight y OK explícito de Marco.

## 7. Fuera de alcance (no lo construyas; ADR-087 § Re-evaluate)

Caché por-función (sub-importes por función dentro de un bolo), bolo multi-sala,
tamaño B de money (payable a artistas, P&L). Hoy: un bolo = una sala, un caché.

## 8. Naming

`performance` deja de llamarse "bolo/función atómica" → es la **función**. El
**bolo** es la entidad nueva. No uses `engagement` (vocab CRM muerto en Hour).
