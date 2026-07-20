# Hour — contexto de `build/`

> Este archivo ya no contiene un segundo estado del proyecto. El estado canónico
> vive en [`../_context.md`](../_context.md) y la cola en
> [`../_tasks.md`](../_tasks.md).

## Qué contiene esta carpeta

- `architecture.md` — arquitectura técnica viva.
- `structure-model.md` — estructura de producto viva.
- `screen-data-spec.md` y `screens-inventory.md` — revisión diseño+datos activa.
- `conversations-*.md` y `money-*.md` — únicos prompts de build aún no ejecutados.
- `runbooks/` — procedimientos operativos activos.
- `migrations/` — historial SQL legacy/aplicado; no constituye por sí solo un
  baseline reconstruible.
- `archive/` — prompts, planes, contratos y runbooks terminados.

## Regla de lectura

No convertir una frase fechada de un prompt, ADR o sesión en estado actual. Para
afirmar qué está vivo, comprobar código, Git, `/health/live`, Supabase o tests y
actualizar `_context.md` / `_tasks.md`.

Los documentos del archivo pueden explicar una decisión, pero nunca se ejecutan
sin que Marco los reactive explícitamente y se reconcilien primero con el código.
