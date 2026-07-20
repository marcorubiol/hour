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

## Ahora — bloque 4: Money v2

11. [ ] **Money v2.** `expected_on`, condición de pago, pagos observados,
    aging y estado paid derivado. Orden activo: `build/money-model-prompt.md` →
    `build/money-prompt.md` → `build/money-design-prompt.md`.

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
- Money suma monedas distintas sin dimensión; no mostrarlo como total económico
  fiable hasta resolver multi-currency.
- Expenses globales, invoices multilínea/PDF/serie, expiración de shares y
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
