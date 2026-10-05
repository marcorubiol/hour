@_context.md

## Coordinación de sesiones

Este proyecto usa la skill `coordinador` (`.claude/skills/coordinador/SKILL.md`) cuando hay varias sesiones de Claude
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
- **Diario de uso:** ninguno por ahora.
- **Repo público:** sí. No escribas en git nada que no pueda ser público (claves, estado interno de carriles).
