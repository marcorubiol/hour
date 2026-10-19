<script lang="ts">
  /**
   * Ajuste del espacio (ADR-099, añadido del 2026-10-11): las conversaciones
   * nuevas nacen privadas de quien las crea (por defecto) o compartidas. Lo
   * decide un admin; cada persona cambia después las suyas desde la ficha.
   */
  import Segmented from '$lib/components/Segmented.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { new_conversations_private: boolean; can_edit: boolean };

  const query = createQuery(
    toStore(() => ({
      queryKey: ['conversation-privacy', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Setting>(`/api/workspaces/${workspaceId}/conversation-privacy`, signal),
    })),
  );

  const save = createMutation({
    mutationFn: (value: boolean) =>
      mutateJSON('PUT', `/api/workspaces/${workspaceId}/conversation-privacy`, { new_conversations_private: value }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['conversation-privacy'] }),
  });

  let value = $derived($query.data?.new_conversations_private ?? true);
  let canEdit = $derived($query.data?.can_edit ?? false);
</script>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.conv_privacy_kicker', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.conv_privacy_label', locale)}</div>
        <div class="set-row__hint">{t('settings.conv_privacy_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.conv_privacy_label', locale)}
          options={[
            { value: 'private', label: t('settings.conv_privacy_private', locale) },
            { value: 'shared', label: t('settings.conv_privacy_shared', locale) },
          ]}
          value={value ? 'private' : 'shared'}
          disabled={!canEdit || $save.isPending}
          onchange={(v) => $save.mutate(v === 'private')}
        />
        {#if !canEdit && $query.data}
          <span class="set-row__hint">{t('settings.conv_privacy_admin_only', locale)}</span>
        {/if}
      </div>
    </div>
  </div>
</section>
