<script lang="ts">
  /**
   * El mes en que empieza la temporada del espacio (tarea 78): septiembre por
   * defecto. Cuentas, Conversaciones y Hoy cuentan la temporada desde él
   * (`$lib/season-year`). Lo decide un admin.
   */
  import Select from '$lib/components/Select.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, appLocaleTag, t } from '$lib/i18n';
  import { addToast } from '$lib/components/Toast.svelte';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { DEFAULT_SEASON_START_MONTH, normalizeStartMonth } from '$lib/season-year';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { season_start_month: number; can_edit: boolean };

  const query = createQuery(
    toStore(() => ({
      queryKey: ['workspace-season', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Setting>(`/api/workspaces/${workspaceId}/season`, signal),
    })),
  );

  // In place (ADR-139 p7): the setting says «guardado» beside itself.
  const saved = new SaveFlash();
  const save = createMutation({
    onSuccess: () => saved.show(),
    mutationFn: (month: number) =>
      mutateJSON('PUT', `/api/workspaces/${workspaceId}/season`, { season_start_month: month }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-season'] });
      // The shell reads the month from the workspaces feed; the overview counts with it.
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
    },
  });

  let value = $derived(String(normalizeStartMonth($query.data?.season_start_month ?? DEFAULT_SEASON_START_MONTH)));
  let canEdit = $derived($query.data?.can_edit ?? false);

  // Month names in the reader's language; the 15th keeps every zone in the month.
  const monthName = new Intl.DateTimeFormat(appLocaleTag(), { month: 'long', timeZone: 'UTC' });
  const options = Array.from({ length: 12 }, (_, i) => {
    const name = monthName.format(new Date(Date.UTC(2026, i, 15)));
    return { value: String(i + 1), label: name.charAt(0).toLocaleUpperCase() + name.slice(1) };
  });
</script>

<section class="set-group">
  <BlockHead title={t('settings.season_kicker', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.season_label', locale)}</div>
        <div class="set-row__hint">{t('settings.season_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Select
          ariaLabel={t('settings.season_label', locale)}
          {options}
          {value}
          disabled={!canEdit || $save.isPending}
          saved={saved.is()}
          onchange={(e) => $save.mutate(Number((e.currentTarget as HTMLSelectElement).value))}
        />
        {#if !canEdit && $query.data}
          <span class="set-row__hint">{t('settings.season_admin_only', locale)}</span>
        {/if}
      </div>
    </div>
  </div>
</section>
