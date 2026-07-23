-- Identity palette: allow a custom-hue accent ('h<0-360>') alongside the
-- palette index. Non-destructive — only WIDENS the CHECK; existing values
-- (NULL, '1'..'12') keep passing. Pairs with the 7-hue palette + custom hue
-- picker in the app (accent.ts / AccentSwatchPicker.svelte / tokens.css).
--
-- Applied to hour-phase0 as migration 20260722233239 on 2026-07-23.
-- Rollback: re-add each constraint as
--   check (accent is null or accent ~ '^([1-9]|1[0-2])$')

alter table public.project   drop constraint if exists project_accent_check;
alter table public.project   add  constraint project_accent_check
  check (accent is null or accent ~ '^([1-9]|1[0-2])$' or accent ~ '^h[0-9]{1,3}$');

alter table public.line      drop constraint if exists line_accent_check;
alter table public.line      add  constraint line_accent_check
  check (accent is null or accent ~ '^([1-9]|1[0-2])$' or accent ~ '^h[0-9]{1,3}$');

alter table public.workspace drop constraint if exists workspace_accent_check;
alter table public.workspace add  constraint workspace_accent_check
  check (accent is null or accent ~ '^([1-9]|1[0-2])$' or accent ~ '^h[0-9]{1,3}$');

comment on column public.project.accent is
  'Color identity. ''1''..''7'' = palette index into --accent-N tokens; ''h<0-360>'' = custom hue (oklch L/C fixed by --accent-custom-* tokens); NULL = derive via hash(slug). Stored as text.';
comment on column public.line.accent is
  'Color identity. ''1''..''7'' palette index or ''h<0-360>'' custom hue; NULL = derive via hash(slug). Stored as text.';
comment on column public.workspace.accent is
  'Color identity. ''1''..''7'' palette index or ''h<0-360>'' custom hue; NULL = derive via hash(slug). Stored as text.';
