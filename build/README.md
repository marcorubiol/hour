# `build/` — mapa de documentación

La portada del proyecto es [`../_context.md`](../_context.md). Esta carpeta agrupa
documentos técnicos y de producto; ya no mantiene una segunda narrativa de estado.

## Documentos vivos

| Archivo | Autoridad |
|---|---|
| `architecture.md` | Stack, datos, seguridad y entornos |
| `identity-access.md` | Modelo aplicado de identidad portátil y acceso |
| `structure-model.md` | Lentes, contenedores, módulos y tareas |
| `screen-data-spec.md` | Contrato de datos por superficie |
| `screens-inventory.md` | Checklist de revisión de pantallas |
| `competition.md` | Snapshot de competencia; verificar precios antes de usarlos |
| `setup.md` | Desarrollo y deploy del stack actual |
| `strategy-session-prompt.md` | Apertura opcional para sesiones de estrategia |
| `conversations-prompt.md` + `conversations-design-prompt.md` | Conversations v1.5 pendiente |
| `money-model-prompt.md` + `money-prompt.md` + `money-design-prompt.md` | Money v2 pendiente |

## Operaciones

- `runbooks/backup.md` — backup y base del restore drill.
- `runbooks/beta-readiness.md` — gate de beta privada.
- `runbooks/rollback.md` — rollback de Worker.
- `runbooks/test-user-setup.md` — fixtures e2e/RLS.

Los runbooks ejecutados se mueven a `archive/`; un runbook activo debe describir
una operación que todavía puede repetirse.

## Schema y migraciones

- `schema.sql` y `rls-policies.sql` son snapshots históricos, no el schema vivo.
- `migrations/` conserva el historial SQL anterior al uso normalizado de
  `supabase/migrations/`.
- `../supabase/migrations/` contiene el checkpoint y las migraciones gestionadas
  desde el hardening del 2026-07-20.
- El proyecto todavía no dispone de un baseline único para levantar una base
  vacía. Esa limitación está en `_tasks.md` y no debe ocultarse.

## Historia

[`archive/README.md`](archive/README.md) indexa planes, prompts, contratos y
procedimientos terminados. `_notes/` conserva sesiones y pensamiento en curso;
`_decisions.md` conserva los ADR.

**Regla:** memoria en archivos, pero una sola verdad actual: `_context.md` y
`_tasks.md`.
