<script lang="ts">
  /**
   * Ajustes › Espacios: las importaciones de contactos del espacio (138).
   *
   *   IMPORTACIONES DE CONTACTOS
   *   difusion-2026.xlsx · contactos: 415 · Anna · 13 nov     hasta el 20 nov   Deshacer
   *   Pegado desde la hoja · contactos: 22 · tú · 2 nov       ya no se deshace
   *
   * Quien importa ve las suyas; el owner o admin, todas las del espacio (la
   * RLS de `contact_import`). Deshacer pide confirmación (ADR-194 § 1). Sin
   * importaciones, o sin la migración, no se dibuja.
   */
  import { toStore } from 'svelte/store';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { fetchJSON } from '$lib/api';
  import { dayMonthYearTs } from '$lib/datetime';
  import { t, appLocale } from '$lib/i18n';
  import { session } from '$lib/session.svelte';
  import { UNDO_DAYS, undoDaysLeft, type ContactImportItem } from '$lib/contact-import';
  import { undoContactImport } from '$lib/contact-import-undo';

  interface Props {
    workspace: { id: string };
    /** Los nombres de las personas del espacio, por cuenta, si quien mira los tiene (admin). */
    names?: ReadonlyMap<string, string>;
  }
  let { workspace, names = new Map() }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const imports = createQuery(
    toStore(() => ({
      queryKey: ['contact-imports', workspace.id] as const,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ContactImportItem[]; absent?: boolean }>(
          `/api/contact-imports?workspace_id=${encodeURIComponent(workspace.id)}`,
          signal,
        ),
    })),
  );
  let items = $derived($imports.data?.items ?? []);

  function who(createdBy: string | null): string {
    if (createdBy && createdBy === session.user?.sub) return t('contact_import.by_you', locale);
    return (createdBy && names.get(createdBy)) || '';
  }

  function line(i: (typeof items)[number]): string {
    return [
      i.filename || t('contact_import.pasted', locale),
      t('contact_import.settings_count', locale, { n: i.persons_created + i.organizations_created }),
      who(i.created_by),
      dayMonthYearTs(i.created_at),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function until(createdAt: string): string {
    return dayMonthYearTs(new Date(Date.parse(createdAt) + UNDO_DAYS * 86_400_000).toISOString());
  }

  let target = $state<(typeof items)[number] | null>(null);
  let confirmOpen = $state(false);
  let busy = $state(false);

  function ask(i: (typeof items)[number]) {
    target = i;
    confirmOpen = true;
  }

  async function undo() {
    if (!target) return;
    busy = true;
    await undoContactImport(target.id, locale, queryClient);
    busy = false;
    confirmOpen = false;
  }
</script>

{#if items.length > 0}
  <section class="set-group set-imports" aria-labelledby="set-imports-title" data-testid="settings-contact-imports">
    <BlockHead title={t('contact_import.settings_title', locale)} id="set-imports-title" />
    <ul class="set-imports__list" role="list">
      {#each items as i (i.id)}
        {@const left = undoDaysLeft(i)}
        <li class="set-imports__row" data-testid="settings-contact-import">
          <span class="set-imports__name">{line(i)}</span>
          <span class="set-imports__meta">
            {i.status === 'undone'
              ? t('contact_import.settings_undone', locale)
              : left > 0
                ? t('contact_import.settings_until', locale, { date: until(i.created_at) })
                : t('contact_import.settings_no_undo', locale)}
          </span>
          {#if i.status !== 'undone' && left > 0}
            <button type="button" class="btn--secondary btn--s" onclick={() => ask(i)}>{t('contact_import.settings_undo', locale)}</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if target}
  <ConfirmDialog
    bind:open={confirmOpen}
    title={t('contact_import.undo_title', locale, { name: target.filename || t('contact_import.pasted', locale) })}
    body={t('contact_import.undo_body', locale, { persons: target.persons_created, orgs: target.organizations_created, notes: target.notes_created })}
    confirm={t('contact_import.undo_confirm', locale)}
    {busy}
    {locale}
    onconfirm={undo}
  />
{/if}

<style>
  .set-imports__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .set-imports__row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2xs) var(--space-m);
    padding-block: var(--space-s);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-imports__row:last-child {
    border-block-end: 0;
  }
  .set-imports__name {
    flex: 1 1 auto;
    min-inline-size: 0;
    font-size: var(--text-s);
    color: var(--text-color);
    overflow-wrap: anywhere;
  }
  .set-imports__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-s);
    color: var(--text-faint);
  }
  .set-imports__row > button {
    margin-inline-start: auto;
  }
</style>
