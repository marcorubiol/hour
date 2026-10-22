<script lang="ts">
  /**
   * Ajustes › Equipo, junto a las invitaciones (plan 2026-10-22, fase 3):
   *
   *   FICHAS DE PERSONA
   *   Sin unir
   *   Inés Ortega        Aceptó como Inés · ines@sala.example      Unir
   *   Fusiones recientes
   *   «Inés Ortega Ruiz» pasó a «Inés Ortega»    22 oct 2026      Deshacer la fusión
   *
   * «Sin unir»: invitaciones aceptadas por una cuenta que ya era otra
   * persona (`list_unmerged_invitations`); «Unir» abre el diálogo de fusión
   * con las dos fichas ya elegidas. «Fusiones recientes»: las de 30 días sin
   * deshacer, con su «Deshacer». Solo para el admin (lo monta el bloque de
   * accesos, que ya solo ve él); sin nada que decir, no se dibuja.
   */
  import { toStore } from 'svelte/store';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import PersonMergeDialog, { type MergeResult } from '$lib/components/PersonMergeDialog.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useScopes } from '$lib/stores/scopes.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { CREATED_TOAST_MS } from '$lib/created';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { dayMonthYearTs } from '$lib/datetime';
  import { t, appLocale } from '$lib/i18n';
  import { undoOpen, type RecentMerge, type UnmergedInvitation } from '$lib/person-merge';

  interface Props {
    workspace: { id: string; slug: string };
  }
  let { workspace }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  // The shell's pins (absent outside `/h`, e.g. in a component test).
  const pins = usePins() as ReturnType<typeof usePins> | undefined;
  const scopes = useScopes() as ReturnType<typeof useScopes> | undefined;

  const merges = createQuery(
    toStore(() => ({
      queryKey: ['person-merges', workspace.id] as const,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ unmerged: UnmergedInvitation[]; recent: RecentMerge[] }>(
          `/api/workspaces/${workspace.id}/person-merges`,
          signal,
        ),
    })),
  );
  let unmerged = $derived($merges.data?.unmerged ?? []);
  let recent = $derived(($merges.data?.recent ?? []).filter((m) => undoOpen(m.merged_at)));

  const personHref = (slug: string) => `/h/${workspace.slug}/person/${encodeURIComponent(slug)}`;

  // ── Unir: the dialog of phase 2, with both files chosen ────────────────
  let dialogOpen = $state(false);
  let target = $state<UnmergedInvitation | null>(null);
  function unite(u: UnmergedInvitation) {
    target = u;
    dialogOpen = true;
  }

  async function refresh() {
    await Promise.all(
      [['person-merges'], ['person'], ['planner-team'], ['project-cast'], ['conversations']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }

  async function undo(id: string, name: string) {
    try {
      const body = await mutateJSON<{ undo: { skipped?: number } }>('DELETE', `/api/person-merges/${id}`);
      await refresh();
      const skipped = body?.undo.skipped ?? 0;
      addToast({
        tone: 'info',
        message: t('person.merge_undone', locale, { name }),
        ...(skipped > 0 ? { title: t('person.merge_undone_skipped', locale, { n: skipped }) } : {}),
      });
    } catch (err) {
      const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
      addToast({
        tone: 'danger',
        title: t('person.merge_undo_failed', locale),
        message:
          code === 'undo_expired'
            ? t('person.merge_err_expired', locale)
            : code === 'already_undone'
              ? t('person.merge_err_undone', locale)
              : code === 'later_merge'
                ? t('person.merge_err_later', locale)
                : err instanceof Error
                  ? err.message
                  : t('perf.unexpected', locale),
      });
    }
  }

  async function onMerged(m: MergeResult) {
    await refresh();
    // A pin on the file that went pins the one that stayed (§ 6.2).
    const moved = new Map([[m.drop_person_id, m.keep_person_id]]);
    pins?.rewritePersons(moved);
    scopes?.rewritePersons(moved);
    addToast({
      tone: 'success',
      message: t('person.merge_done', locale),
      duration: CREATED_TOAST_MS,
      action: { label: t('ui.undo', locale), run: () => void undo(m.merge_id, m.drop_name) },
    });
  }
</script>

{#if $merges.isError && !($merges.error instanceof ApiError && $merges.error.status === 403)}
  <p class="set-merges__error" role="status">{t('settings.merges_load_error', locale)}</p>
{:else if unmerged.length > 0 || recent.length > 0}
  <section class="set-group set-merges" aria-labelledby="set-merges-title" data-testid="settings-person-merges">
    <BlockHead title={t('settings.merges_title', locale)} id="set-merges-title" />

    {#if unmerged.length > 0}
      <h3 class="eyebrow eyebrow--sub set-merges__sub">{t('settings.merges_unmerged', locale)}</h3>
      <ul class="set-merges__list" role="list">
        {#each unmerged as u (u.invitation_id)}
          <li class="set-merges__row" data-testid="settings-unmerged">
            <a class="set-merges__name" href={personHref(u.drop_slug)}>{u.drop_name}</a>
            <span class="set-merges__meta"
              >{t('settings.merges_unmerged_line', locale, { name: u.keep_name, email: u.email })}</span
            >
            <button
              type="button"
              class="btn--secondary btn--s"
              aria-label={t('settings.merges_unite_full', locale, { drop: u.drop_name, keep: u.keep_name })}
              onclick={() => unite(u)}>{t('settings.merges_unite', locale)}</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    {#if recent.length > 0}
      <h3 class="eyebrow eyebrow--sub set-merges__sub">{t('settings.merges_recent', locale)}</h3>
      <ul class="set-merges__list" role="list">
        {#each recent as m (m.id)}
          {@const keep = m.keep_name ?? t('settings.merges_keep_gone', locale)}
          <li class="set-merges__row" data-testid="settings-recent-merge">
            <span class="set-merges__name">
              {#if m.keep_slug}
                <a href={personHref(m.keep_slug)}
                  >{t('settings.merges_recent_line', locale, { drop: m.drop_name ?? '?', keep })}</a
                >
              {:else}
                {t('settings.merges_recent_line', locale, { drop: m.drop_name ?? '?', keep })}
              {/if}
            </span>
            <span class="set-merges__meta">{dayMonthYearTs(m.merged_at)}</span>
            <button type="button" class="btn--secondary btn--s" onclick={() => undo(m.id, m.drop_name ?? '')}
              >{t('person.merge_line_undo', locale)}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if target}
  <PersonMergeDialog
    bind:open={dialogOpen}
    workspaceId={workspace.id}
    person={{ id: target.drop_person_id, full_name: target.drop_name }}
    other={{ person_id: target.keep_person_id, full_name: target.keep_name }}
    invitationId={target.invitation_id}
    {locale}
    onmerged={onMerged}
  />
{/if}

<style>
  .set-merges__sub {
    margin: var(--space-s) 0 0;
  }
  .set-merges__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .set-merges__row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2xs) var(--space-m);
    padding-block: var(--space-s);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-merges__row:last-child {
    border-block-end: 0;
  }
  .set-merges__name {
    flex: 1 1 auto;
    min-inline-size: 0;
    font-size: var(--text-s);
    color: var(--text-color);
  }
  .set-merges__name a,
  a.set-merges__name {
    color: inherit;
    text-decoration: none;
  }
  .set-merges__name a:hover,
  a.set-merges__name:hover,
  .set-merges__name a:focus-visible,
  a.set-merges__name:focus-visible {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .set-merges__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-s);
    color: var(--text-faint);
  }
  .set-merges__row > button {
    margin-inline-start: auto;
  }
  .set-merges__error {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
</style>
