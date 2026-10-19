<script lang="ts">
  /**
   * El oficio del espacio (ADR-128 § 2): escena o música en directo. Cambia
   * unas pocas palabras de la app (la lente de venta, la función, el reparto,
   * el horario del día, quién compra) para todo el espacio. Lo decide un admin.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t, TRADES, type Trade } from '$lib/i18n';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { trade: Trade; can_edit: boolean };

  const query = createQuery(
    toStore(() => ({
      queryKey: ['workspace-trade', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Setting>(`/api/workspaces/${workspaceId}/trade`, signal),
    })),
  );

  const save = createMutation({
    mutationFn: (trade: Trade) => mutateJSON('PUT', `/api/workspaces/${workspaceId}/trade`, { trade }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-trade'] });
      // The shell reads the trade from the workspaces feed: repaint every label.
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  let value = $derived<Trade>($query.data?.trade ?? 'stage');
  let canEdit = $derived($query.data?.can_edit ?? false);
</script>

<section class="set-group">
  <BlockHead title={t('settings.trade_kicker', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.trade_label', locale)}<ConceptHint concept="trade" /></div>
        <div class="set-row__hint">{t('settings.trade_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg" role="group" aria-label={t('settings.trade_label', locale)}>
          {#each TRADES as trade (trade)}
            <button
              type="button"
              class={value === trade ? 'is-on' : ''}
              aria-pressed={value === trade}
              disabled={!canEdit || $save.isPending}
              onclick={() => $save.mutate(trade)}
            >{t(`settings.trade_${trade}`, locale)}</button>
          {/each}
        </div>
        {#if !canEdit && $query.data}
          <span class="set-row__hint">{t('settings.trade_admin_only', locale)}</span>
        {/if}
      </div>
    </div>
  </div>
</section>
