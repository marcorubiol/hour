@_context.md
@vault/_context.md

Si tu herramienta no ha expandido los `@` de arriba, lee antes de trabajar `_context.md` (en la raíz de este repo) y
`vault/_context.md` (el contexto del proyecto en el vault, si existe en tu máquina). El núcleo del sistema llega por
`~/Developer/AGENTS.md`. No hay `CLAUDE.md` a propósito: si existe uno (o un `CLAUDE.local.md`), Claude Code deja de
leer los `AGENTS.md`.

## Coordinación de sesiones

Este proyecto usa la skill `coordinador` (skill universal de Marco, en `~/.claude/skills/coordinador/`) cuando hay varias sesiones de Claude
en paralelo, o cuando Marco te abre como «coordinador» o pregunta «¿cómo vamos?». Con una sola sesión no hace falta.

Ficha del proyecto:
- **Cola de trabajo:** `_tasks.md` es la única cola activa y no se duplica; el coordinador la lee y la actualiza, no la
  sustituye. Decisiones en `_decisions.md`; estado general en `_context.md`.
- **Estado de coordinación:** `build/coordination/` (en `.gitignore`: este repo es público, el estado no va a git).
  `STATUS.md` lo lleva el coordinador; cada carril lleva `<rama con - en vez de />.md`. En una sesión en la nube esa
  carpeta se pierde al acabar la sesión: allí, el coordinador deja lo que importe en `_tasks.md`.
- **Carriles:** máximo 3 en paralelo; dos que tocan el mismo fichero van uno detrás de otro.
- **Rama principal:** `main` es producción; sólo el coordinador integra y empuja. Los carriles trabajan en
  `claude/<nombre>`.
- **Entornos que se bloquean:** el E2E se corre contra un origen desplegado, no contra `vite preview` (ver `_tasks.md`,
  tarea 21); una sola sesión a la vez contra producción.
- **Checkout principal:** `/Users/marcorubiol/Developer/hour`.
- **Puerta** (verde antes de integrar y empujar): `pnpm --filter web check` 0/0 y `pnpm --filter web test:unit`;
  si toca schema o permisos, `pnpm --filter web test:rls`; si toca pantalla, el E2E contra un origen desplegado tras
  el deploy. Una migración a producción sigue su gate propio (`_tasks.md § 34`: backup, staging si es destructiva,
  plan, apply).
- **Producto (skill `producto`):** el roadmap es `_tasks.md`, no hay `ROADMAP.md` (Marco, 2026-10-09). Hour no tiene
  versiones: un destino es una sección de `_tasks.md` («AHORA», «Producto — después», un `§`), y el tamaño se mide en
  carriles. `CHANGELOG.md` en la raíz, por meses. Commit de un cambio que solo toca la cola o el CHANGELOG: directo a
  `main` con push en el mismo paso. Un bug mandado arreglar no se integra antes de que Marco valide su línea.
- **Drop:** https://claude.ai/artifact/31K3hLooqc7ak2JujNNHS7 (vista de la cola: copia de `_tasks.md` como
  `roadmap.md`). Tipos: `bug` (roto), `x` (interfaz confusa o mejorable), `idea`. Archivo de notas:
  `~/Zerø System/03_AGENCY/Hour/drop-archive.md` (en el vault y no en el repo, que es público).
- **Repo público:** sí. No escribas en git nada que no pueda ser público (claves, estado interno de carriles).
