# Hour — cola vigente

> **ÚNICA COLA ACTIVA.** Última reconciliación: 2026-07-20.
> Estado general y evidencia: `_context.md`. Historia: `_decisions.md` y
> `_notes/sessions-log.md`. Los documentos de `build/archive/` no crean tareas.

## Cerrado — bloque 2: permisos y entrada a beta

4. [x] **Matriz RBAC completa.** Owner/admin/member/performer/guest/external
   cubiertos por RLS 118/118. Lectura y edición de performance están separadas;
   la revocación invalida el JWT previo y reautoriza/cierra sockets collab.

5. [x] **Onboarding y administración sin SQL.** Invitación hasheada y caduca,
   aceptación por email verificado, rol/proyecto explícitos, ledger de acceso y
   revocación inmediata están disponibles en Settings.

6. [x] **Identidad completamente externa de fixture.** `external@hour.test`
   prueba cero acceso → invitación/aceptación → acceso → revocación con el mismo
   JWT, sin depender del admin ni de `limited@hour.test`.

7. [x] **Rate-limit Cloudflare en `/api/auth/login`.** Binding nativo de Workers
   10/min/IP para ráfagas + ventana KV independiente 10/5 min/IP. La única regla
   WAF Free sigue protegiendo `wp-login.php` (slot 1/1), sin sustituirla.

8. [x] **Verificación manual del flujo de alias y navegación ADR-067.** Hall,
   LensSwitcher, pins, copy-link, solicitud/aprobación y canonicalización del
   alias, y redirects legacy verificados. La revisión descubrió y corrigió el
   scope ausente en Conversations y la copia denegada en browsers embebidos;
   ambos quedan automatizados.

## Cerrado — bloque 3: Conversations v1.5

10. [x] **Conversations v1.5.** Last contact visible, write path “contacted
    today”, vista por conversación/persona y contrato de `conversation_event`.
    Runtime `ad1b580`; migración de timestamps aplicada, baseline staging desde
    cero verde, RLS 118/118 y E2E de producción verificado. El contrato del event
    log queda congelado sin anticipar la tabla/timeline fuera de alcance.

## Decisiones con coste o autoridad externa

9. [ ] **Supabase leaked-password protection (HIBP).** El proyecto está en plan
   Free y la función requiere Pro. Marco debe decidir el upgrade; después activar
   `password_hibp_enabled` y volver a ejecutar el advisor.

## Cerrado — bloque 4: Money v2

11. [x] **Money v2.** `expected_on`, condición de pago, pagos observados,
    aging y estado paid derivado; payer, gastos union-scoped, neto por línea,
    VAT/IRPF y totales separados por moneda. Runtime `3b7c95e`, baseline
    staging desde cero verde, RLS 120/120 y E2E de producción completo.

## Ahora — planner + identidad, reconciliado y sin desplegar

> Rama `feat/planner-identity`: 29 commits de código rescatados de
> `feat/comms-threads`, donde estaban atrapados detrás de un bloqueo que no era
> suyo. Gates verdes sobre la rama: check 0/0 · unit 348 · build · RLS 120/120.
> **Las migraciones NO se re-aplican**: las cinco de ADR-084 y la de ADR-081 ya
> estaban vivas en producción y absorbidas en el checkpoint de `main`. Esto
> invierte el riesgo habitual — aquí la base de datos iba **por delante** del
> código, no al revés.

14. [ ] **Merge + deploy de `feat/planner-identity`.** Contenido: monograma de
    identidad + paleta 12 (ADR-081), bloques multi-día por serie, ticks de
    readiness, `booking_mode` (ADR-002/084), `/api/dates/series`,
    `/api/projects/[id]`. Falta E2E contra producción antes de desplegar, y
    `wrangler deploy` exige árbol limpio.

15. [ ] **Editar una fecha desde la UI — NO EXISTE.** `PATCH /api/dates/[id]` y
    `DatePatchSchema` están construidos, pero **ningún componente los usa** y el
    chip de fecha del mes es un `<span>`, no un enlace: ensayos, prensa,
    residencias, días off y viajes nunca se han podido abrir, editar ni borrar.
    No es deuda del multi-día — este solo lo hizo evidente, porque crear 25
    fechas de golpe hace que la falta duela.

16. [ ] **Multi-día para PERFORMANCES.** Hoy `performance.performed_at` es un
    solo día. Es simétrico a lo que ya existe para `date`: `performance.series_id`
    + índice, RPC `create_performance_series` atómica calcada de
    `create_date_series` (mismo gate `edit:performance`, conversión día a día
    porque el DST muerde), conmutador «varios días» reusando `BlockDays.svelte`,
    y agrupación en `MonthGrid`. **Dos funciones DISTINTAS el mismo día no se
    colapsan nunca** — los dos nombres tienen que verse.

17. [ ] **Tipos de horario añadibles por el usuario.** Las cinco franjas de
    ADR-023 son **columnas fijas** en `performance` con un CHECK de orden: nadie
    puede añadir «photo call» sin migración. Diagnóstico: son una lista
    disfrazada de columnas — tienen orden, tipo y se recorren en secuencia.
    Propuesta sin decidir: tabla `performance_slot (performance_id, kind, label,
    at, sort)`. Es la pieza más grande pendiente (migración + backfill +
    reescribir road sheet, `ProductionStub`, `ScheduleTable`, whitelist del
    PATCH). Merece ADR propio.

## Bloqueado — comms + acceso (ADR-082/083/085)

> **El modelo está cerrado; la implementación no puede empezar.** Canon en la
> rama `feat/comms-threads` (ADR-082/083/085 + `build/structure-model.md`: dos
> escaleras y la faceta como primitivo) y los 7 prototipos en `app design/`.
> **No hay que rehacer el pensamiento.** Nada de esto está en `main` a propósito:
> son 604 líneas de SQL sin aplicar y **cero código de aplicación** — ni una
> ruta, ni un componente, ni un endpoint.
>
> Verificado contra producción el 2026-07-20, no reconstruido de documentos.

- [ ] **BLOQUEANTE 1 — el `invitat` no tiene forma de autenticarse, y es más
  grave de lo que se escribió.** El schema **puede guardar** un invitado
  (`membership.user_id IS NULL` + `ends_at`) y **nada puede dejarle leer**.
  `workspace_invitation`, que `main` construyó después, **no lo resuelve**: exige
  login por tres cerrojos independientes — el `GRANT` excluye `anon`, las RPC
  hacen `JOIN auth.users ON au.id = auth.uid()`, y además exigen
  `email_confirmed_at IS NOT NULL` con el email coincidiendo. **Lo que no se
  había dicho**: el invitat **escribe**, y hoy en Hour no existe ni un solo
  camino de escritura alcanzable por `anon`. Los dos precedentes de la casa
  (`roadsheet_share`, `calendar_share`) son lectura de una vía que devuelve jsonb
  curado — la proyección *es* la redacción. Esto no es un detalle de etapa 2: es
  abrir la primera escritura anónima en un sistema cuyo modelo de autorización
  entero descansa sobre `auth.uid()`. Si se hace, el patrón a copiar es el de
  `workspace_invitation` (token **hasheado** sha256 + `expires_at` + revocación),
  no el de los shares, que guardan el token **en claro y sin caducidad**.

- [ ] **BLOQUEANTE 2 — RPC de expansión de presets, y la etapa 2 se ha
  encarecido.** Sin ella no se escribe **ninguna** fila en `membership_facet`, así
  que ningún hilo de faceta lo lee nadie salvo un owner/admin: la etapa 1 nace
  muerta. Tiene que expandir preset→filas con `source='preset'`, aplicar
  overrides con `source='override'` (la vista «de dónde sale cada permiso» de
  ADR-082 §4 depende de esa columna) y hacer cumplir la delegación acotada
  (faceta · verbo · nivel) en el servidor. **Además** el plan escrito en la
  migración («apuntar `has_permission()` a `membership` y tirar las dos tablas
  viejas») envejeció mal: `has_permission` se partió en
  `has_permission_for_user` + wrapper, llegó `read:performance`, y hoy dependen
  de ello 8 políticas SELECT reescritas más `list_money_performances` y
  `update_performance_fee`.

- [ ] **Migración `2026-07-20_comms_threads_and_membership.sql` — escrita,
  SIN APLICAR, y ya no bloqueada por lo que decía.** 604 líneas: 2 enums, 7
  tablas, 4 funciones, 9 políticas, triggers y rollback. Aditiva pura. **La
  dependencia declarada ha muerto**: decía depender de
  `2026-07-18_user_profile_person_id.sql`, pero `user_profile.person_id` **ya
  existe y está vivo en producción** — `main` lo resolvió por su cuenta con la
  tanda de identidad. Ninguna de sus 7 tablas existe todavía.

- [ ] **Defecto NUEVO, no listado en el review de 32 hallazgos: todo backfill de
  proyecto nace inerte.** El backfill de `project_membership` no escribe
  `accepted_at`, pero el guard `accepted_at IS NOT NULL` que se añadió al cerrar
  los hallazgos #10/#14/#18 rechaza exactamente esas filas. Resultado: tras
  aplicar, **ninguna membresía de proyecto concede pertenencia ni acceso a
  faceta a nadie**. La otra mitad del remedio del #18 no se aplicó.

- [ ] **Hallazgos del review que siguen abiertos** —
  `_notes/review-comms-migration-2026-07-20.md`. Los 4 conocidos:
  `membership_select` publica la matriz de permisos entera del espacio · el
  backfill aplana roles a `equip`/`direccio` con presets sin grants · nada obliga
  la tabla faceta×nivel en escritura · `message.workspace_id` no está atado al
  del hilo. **Y `main` ya resolvió el patrón del primero**: estrechó
  `workspace_membership_select` a `user_id = auth.uid() OR is_workspace_admin()`,
  así que la política de la rama nace incoherente con la casa. Abiertos además:
  los índices `coalesce(user_id, person_id)` permiten fila de invitado y de
  operador para el mismo humano; falta `guard_immutable_workspace_id` en
  `membership`/`thread`/`message`, contra el patrón de las 13 tablas que lo
  llevan; y comentarios obsoletos que citan un objeto `thread_general` que no
  existe en el fichero.

- [ ] **ADR pendiente: comms sube a la lente Conversations.** Decidido en
  conversación 2026-07-20, sin escribir. Una puerta, **dos proyecciones** (patrón
  ADR-076): *amb qui parles* (difusión, por contraparte, con estado) y *de què es
  parla* (interno, por contenedor, por facetas). Ninguna secundaria. **No
  fusionar las entidades** — 1:1 con estado vs N:N sin estado; lo que unifica es
  la lente, no la tabla.

- [ ] **La puerta de producto, que es de Marco y no técnica.** ADR-085 lleva
  escrita su propia condición: *usar la app en una temporada de difusión real
  antes de construir nada de esto*. Mientras no se cumpla, resolver los dos
  bloqueantes es trabajo especulativo por bueno que sea el modelo.

## Ahora — bloque 5: contenedores

12. [ ] **Revisión diseño+datos — contenedores.** Portada de workspace, project
    detail, line detail y siete módulos; cerrar identidad fiscal y qué datos son
    obligatorios antes de ampliar UI.

13. [ ] **Revisión diseño+datos — fichas y transversales.** Performance, road
    sheet, conversation, person, settings, diálogos; loading/error/empty/offline,
    mobile, light/dark y accesibilidad.

## Producto — después

- [ ] **Email integrado → `conversation_event`.** Empezar por forwarding/BCC o
  conexión de bajo riesgo; evitar doble entrada.
- [ ] **WhatsApp por escalones.** Share-to-Hour/manual asistido → número/bot →
  Business API para cuentas elegibles; nunca scraping de WhatsApp Web.
- [ ] **Road mode mobile/offline.** Paquete de próximos bolos, road sheets y
  contactos con frescura visible y cola de escritura limitada.
- [ ] **AI data-readiness y guardarraíles.** Source, ownership, consent,
  confidence, freshness y visibilidad; aprobación, idempotencia, audit log y
  compensación para cada acción.
- [ ] **Polish de beta.** Mobile completo, GDPR export, accesibilidad WCAG,
  notificaciones y ratificación visual/naming con usuarios externos.

## Deuda aceptada / observar en uso

- Tareas cuyo padre se soft-borra pueden quedar sin contexto en Desk.
- `update_workspace` directo por PostgREST permite a owner/admin saltar las
  validaciones de la API; no es una escalada de privilegios.
- `line.notes` y collab no exigen exactamente el mismo permiso fuera de la API.
- Invoices multilínea/PDF/serie, expiración de shares y
  timezone por ciudad siguen fuera de la profundidad actual.
- `logo_url` existe, pero no hay flujo de subida R2.
- Persona de test huérfana `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8`: invisible;
  purga opcional y exacta, nunca por patrón amplio.

## Cerrado recientemente

- [x] **Bloque 1 — gate operativo completo.** E2E producción 24/24 en
  `7f3de05`; baseline alojado desde cero 114/114 en staging
  ([run 29761298044](https://github.com/marcorubiol/hour/actions/runs/29761298044));
  restore drill desde R2 en 203 s, login + conteos + RLS + ruta crítica
  verificados
  ([run 29761775037](https://github.com/marcorubiol/hour/actions/runs/29761775037)).
- [x] Planner v2 + rename Calendar→Planner, aplicado y desplegado.
- [x] Desk v2: feed mixto, TaskComposer, modo calma y consentimiento IA.
- [x] Identidad workspace-scoped + organizaciones + hardening RLS.
- [x] Fixture limitado y matriz negativa inicial; RLS 114/114.
- [x] Advisors: 0 warnings de rendimiento.
