# Hour — cola vigente

> **ÚNICA COLA ACTIVA.** Última reconciliación: 2026-07-20.
> Estado general y evidencia: `_context.md`. Historia: `_decisions.md` y
> `_notes/sessions-log.md`. Los documentos de `build/archive/` no crean tareas.

## Ahora

1. [ ] **Reconciliar e2e con el producto actual y recuperar 24/24 contra
   producción.** Verificación real: 16 passed, 5 failed, 3 did not run.
   - `performance-write`: aún busca “Add to calendar”; la superficie es Planner.
   - `person`: espera la estructura anterior de conversaciones en la ficha.
   - `scope-url` ×2: espera `.hall__door`, eliminado por el Hall actual.
   - `tasks`: espera `form.desk__task-add`, sustituido por `TaskComposer`.
   - Reejecutar la suite completa; no corregirla ocultando fallos con skips.

2. [ ] **Cerrar un baseline reproducible de base de datos y crear staging.** El
   historial está dividido entre `build/migrations/` y `supabase/migrations/`;
   el checkpoint actual aborta en una base vacía. Resultado esperado: una base
   nueva se levanta de cero, recibe fixtures sintéticos y pasa 114/114 RLS.

3. [ ] **Ejecutar y documentar el restore drill.** Restaurar el último dump R2
   en staging, medir tiempo y verificar login, datos, RLS y una ruta crítica.
   Runbook de origen: `build/runbooks/backup.md`.

## Antes de la primera beta externa

4. [ ] **Matriz RBAC completa.** Definir y probar owner/admin/member/performer/
   guest/external por superficie. Resolver el gap descubierto: hoy no existe
   permiso read-only de performance; la lectura depende de `edit:performance`.
   Incluir revocación con JWT previo y cierre/reautorización de sockets collab.

5. [ ] **Onboarding y administración sin SQL.** Invitación, aceptación, rol
   comprensible, revocación inmediata, soporte mínimo y separación clara entre
   datos demo/staging/producción.

6. [ ] **Identidad completamente externa de fixture.** Debe probar cero acceso
   antes de invitación, acceso tras aceptar y revocación sin depender del usuario
   admin ni de `limited@hour.test`.

7. [ ] **Regla Cloudflare edge de rate-limit en `/api/auth/login`.** El código
   de aplicación ya limita; falta la regla edge. Requiere `Zone WAF:Edit`.
   Procedimiento: `build/runbooks/beta-readiness.md`.

8. [ ] **Verificación manual del flujo de alias y navegación ADR-067.** Hall,
   LensSwitcher, pins, copy-link, solicitud/aprobación de alias y redirects
   legacy. Automatizar los casos estables después de la comprobación.

## Decisiones con coste o autoridad externa

9. [ ] **Supabase leaked-password protection (HIBP).** El proyecto está en plan
   Free y la función requiere Pro. Marco debe decidir el upgrade; después activar
   `password_hibp_enabled` y volver a ejecutar el advisor.

## Producto — siguiente profundidad, elegir explícitamente

10. [ ] **Conversations v1.5.** Last contact visible, write path “contacted
    today”, vista por conversación/persona y contrato de `conversation_event`.
    Prompts activos: `build/conversations-prompt.md` y
    `build/conversations-design-prompt.md`.

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

- [x] Planner v2 + rename Calendar→Planner, aplicado y desplegado.
- [x] Desk v2: feed mixto, TaskComposer, modo calma y consentimiento IA.
- [x] Identidad workspace-scoped + organizaciones + hardening RLS.
- [x] Fixture limitado y matriz negativa inicial; RLS 114/114.
- [x] Advisors: 0 warnings de rendimiento.
