<script lang="ts">
  /**
   * El oficio del espacio (ADR-128 § 2): escena o música en directo. Cambia
   * unas pocas palabras de la app (la lente de venta, la función, el reparto,
   * el horario del día, quién compra) para todo el espacio. Lo decide un admin.
   *
   * Debajo, «Opciones por orden» (ADR-002, tarea 140): si las opciones de una
   * fecha hacen cola (1.ª, 2.ª, 3.ª) o conviven. Por defecto la del oficio
   * (`$lib/booking-mode`): música por orden, escena sin orden. Elegir la del
   * oficio borra la clave, así sigue al oficio si este cambia.
   */
  import Segmented from '$lib/components/Segmented.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t, TRADES, type Trade } from '$lib/i18n';
  import { addToast } from '$lib/components/Toast.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import { bookingModePatch, type BookingMode } from '$lib/booking-mode';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { trade: Trade; booking_mode: BookingMode; can_edit: boolean };

  const query = createQuery(
    toStore(() => ({
      queryKey: ['workspace-trade', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Setting>(`/api/workspaces/${workspaceId}/trade`, signal),
    })),
  );

  // In place (ADR-139 p7): the setting says «guardado» beside itself.
  const saved = new SaveFlash();
  const save = createMutation({
    onSuccess: () => saved.show(),
    mutationFn: (trade: Trade) => mutateJSON('PUT', `/api/workspaces/${workspaceId}/trade`, { trade }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-trade'] });
      // The shell reads the trade from the workspaces feed: repaint every label.
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  const savedOrder = new SaveFlash();
  const saveOrder = createMutation({
    onSuccess: () => savedOrder.show(),
    mutationFn: (mode: BookingMode) =>
      mutateJSON('PATCH', `/api/workspaces/${workspaceId}`, { booking_mode: bookingModePatch(mode, value) }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-trade'] });
      // The planner reads the convention from the workspaces feed.
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  let value = $derived<Trade>($query.data?.trade ?? 'stage');
  let ranked = $derived($query.data?.booking_mode === 'prioritized');
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
        <Segmented
          ariaLabel={t('settings.trade_label', locale)}
          options={TRADES.map((trade) => ({ value: trade, label: t(`settings.trade_${trade}`, locale) }))}
          {value}
          disabled={!canEdit || $save.isPending}
          onchange={(trade) => $save.mutate(trade)}
        />
        <SavedMark shown={saved.is()} />
        {#if !canEdit && $query.data}
          <span class="set-row__hint">{t('settings.trade_admin_only', locale)}</span>
        {/if}
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.holds_ranked_label', locale)}</div>
        <div class="set-row__hint">{t('settings.holds_ranked_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={ranked}
          label={t('settings.holds_ranked_label', locale)}
          testid="holds-ranked-toggle"
          disabled={!canEdit || !$query.data || $saveOrder.isPending || $save.isPending}
          onchange={(next) => $saveOrder.mutate(next ? 'prioritized' : 'simple')}
        />
        <SavedMark shown={savedOrder.is()} />
      </div>
    </div>
  </div>
</section>
