<script lang="ts">
  /**
   * Las lentes del espacio (ADR-132): Planner, la lente de venta y Cuentas se
   * encienden o se apagan para todo el espacio, porque no todas las compañías
   * lo usan todo (hay quien no factura en Hour). Apagar quita la entrada, no
   * los datos. Desk no es una lente y no está aquí. Lo decide un admin; los
   * demás lo ven.
   */
  import Switch from '$lib/components/Switch.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { TOGGLE_LENSES, type ToggleLens } from '$lib/lenses.svelte';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { lenses_off: ToggleLens[]; can_edit: boolean; admins: string[] };

  const query = createQuery(
    toStore(() => ({
      queryKey: ['workspace-lenses', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Setting>(`/api/workspaces/${workspaceId}/lenses`, signal),
    })),
  );

  const save = createMutation({
    mutationFn: (lensesOff: ToggleLens[]) =>
      mutateJSON('PUT', `/api/workspaces/${workspaceId}/lenses`, { lenses_off: lensesOff }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-lenses'] });
      // The shell reads the lenses from the workspaces feed: redraw the nav.
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  let off = $derived(new Set($query.data?.lenses_off ?? []));
  let canEdit = $derived($query.data?.can_edit ?? false);

  // The label is the lens's own word: «Difusión» or «Contratación» by trade.
  const LABEL: Record<ToggleLens, string> = {
    planner: 'lens.planner',
    conversations: 'lens.conversations',
    books: 'lens.money',
  };

  function toggle(lens: ToggleLens) {
    const next = new Set(off);
    if (next.has(lens)) next.delete(lens);
    else next.add(lens);
    $save.mutate(TOGGLE_LENSES.filter((l) => next.has(l)));
  }
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.lenses_kicker', locale) }]} title={t('settings.nav_lenses', locale)}>
  {#snippet facts()}<span>{t('settings.lenses_sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group" data-testid="settings-lenses">
  <BlockHead title={t('settings.lenses_group', locale)} />
  <div class="set-group__body">
    {#each TOGGLE_LENSES as lens (lens)}
      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">{t(LABEL[lens], locale)}</div>
          <div class="set-row__hint">{t(`settings.lenses_hint_${lens}`, locale)}</div>
        </div>
        <div class="set-row__ctrl">
          <Switch
            checked={!off.has(lens)}
            label={t(LABEL[lens], locale)}
            testid="lens-toggle-{lens}"
            disabled={!canEdit || !$query.data || $save.isPending}
            onchange={() => toggle(lens)}
          />
        </div>
      </div>
    {/each}
    {#if !canEdit && $query.data}
      <div class="set-row">
        <span class="set-row__hint">{t('settings.lenses_admin_only', locale)}</span>
      </div>
    {/if}
  </div>
</section>
