# `build/archive/`

Documentación histórica y artefactos terminados. Nada de esta carpeta es una
instrucción vigente ni crea trabajo por sí solo.

## Reglas

1. No ejecutar prompts o runbooks archivados.
2. Para reactivar una idea, contrastarla primero con `_context.md`, `_tasks.md`,
   el código y el schema vivo; crear un documento activo nuevo.
3. No “actualizar” el texto histórico para que parezca actual. Añadir una nota
   fechada o escribir un documento vivo nuevo.
4. Migraciones y ADR no se archivan aquí: son evidencia estructural y
   cronológica permanente.

## Índice

### Fundación e importación

| Archivo | Qué conserva |
|---|---|
| `2026-04-bootstrap.md` | Bootstrap Astro/Supabase inicial, anterior a SvelteKit |
| `2026-04-reset-v2-prompt-original.md` | Prompt original de reset v2 |
| `2026-05-reset-v2-prompt-postreview.md` | Versión posterior/revisada del prompt |
| `2026-05-import-plan.md` | Plan ejecutado de importación de contactos |
| `2026-05-url-architecture-dossier.md` | Dossier que sustentó ADR-022 |
| `2026-05-director-prompt.md` | Prompt de estrategia ligado al workflow/herramientas de mayo |
| `2026-05-design-system-prompt.md` | Prompt visual basado en la navegación House/Room ya retirada |
| `2026-07-17-architecture-snapshot.md` | Arquitectura obsoleta tras identidad, Planner y hardening |

### Planificación histórica

| Archivo | Qué conserva |
|---|---|
| `2026-07-roadmap-snapshot.md` | Roadmap por fases 0.0–1; dejó de ser fiable como cola |

### Builds ejecutados

| Archivo | Qué conserva |
|---|---|
| `2026-07-hall-prompt.md` | Hall status sentence |
| `2026-07-task-model-prompt.md` | Entidad y API de tareas |
| `2026-07-desk-prompt.md` | Desk v2, feed mixto |
| `2026-07-desk-design-prompt.md` | Contrato visual de Desk v2 |
| `2026-07-rename-conversation-prompt.md` | Rename engagement→conversation |
| `2026-07-calendar-model-prompt.md` | Modelo que acabó en Planner v2 |
| `2026-07-calendar-ui-prompt.md` | UI Calendar v2 previa al rename Planner |
| `2026-07-planner-design-prompt.md` | Iteración visual Calendar/Planner |
| `2026-07-calendar-v2-api-contract.md` | Contrato as-built del build Calendar v2 |

### Operaciones ya ejecutadas

| Archivo | Qué conserva |
|---|---|
| `2026-07-calendar-v2-apply-runbook.md` | Apply/merge/deploy completado |
| `2026-07-identity-migration-apply-runbook.md` | Apply de identidad/hardening completado |

## Volver al presente

- Estado: [`../../_context.md`](../../_context.md)
- Cola: [`../../_tasks.md`](../../_tasks.md)
- Arquitectura: [`../architecture.md`](../architecture.md)
- Operaciones activas: [`../runbooks/`](../runbooks/)
