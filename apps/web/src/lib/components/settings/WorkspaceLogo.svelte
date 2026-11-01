<script lang="ts">
  /**
   * El logo de la compañía (ADR-172): la cabecera de la plantilla de los
   * correos de difusión. Se reduce en el navegador (PNG, a lo sumo 480×128,
   * el doble de lo que pinta el correo) y se guarda en R2; lo cambia un admin.
   * La pantalla del envío lo enseña en su vista previa.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON, uploadBlob } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { shrinkImage } from '$lib/image-shrink';
  import { SaveFlash } from '$lib/save-flash.svelte';

  interface Props {
    workspaceId: string;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  type Setting = { logo_url: string | null; name: string; can_edit: boolean };

  let endpoint = $derived(`/api/workspaces/${workspaceId}/logo`);
  const query = createQuery(
    toStore(() => ({
      queryKey: ['workspace-logo', workspaceId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<Setting>(endpoint, signal),
    })),
  );

  const saved = new SaveFlash();
  function failed(err: unknown) {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    const known = code && t(`media.err_${code}`, locale) !== `media.err_${code}` ? t(`media.err_${code}`, locale) : '';
    addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: known || (err instanceof Error ? err.message : String(err)) });
  }
  function settled() {
    void queryClient.invalidateQueries({ queryKey: ['workspace-logo', workspaceId] });
    // La pantalla del envío lee el logo con su detalle.
    void queryClient.invalidateQueries({ queryKey: ['mailout'] });
  }

  const upload = createMutation({
    mutationFn: async (file: File) => {
      const blob = await shrinkImage(file, { maxWidth: 480, maxHeight: 128, type: 'image/png', maxBytes: 200_000 });
      return uploadBlob<{ logo_url: string | null }>(endpoint, blob);
    },
    onSuccess: () => saved.show(),
    onError: failed,
    onSettled: settled,
  });
  const remove = createMutation({
    mutationFn: () => mutateJSON('DELETE', endpoint),
    onSuccess: () => saved.show(),
    onError: failed,
    onSettled: settled,
  });

  let input = $state<HTMLInputElement | null>(null);
  function picked(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) $upload.mutate(file);
    (e.currentTarget as HTMLInputElement).value = '';
  }

  let logo = $derived($query.data?.logo_url ?? null);
  let canEdit = $derived($query.data?.can_edit ?? false);
  let busy = $derived($upload.isPending || $remove.isPending);
</script>

<section class="set-group" id="logo">
  <BlockHead title={t('settings.logo_kicker', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.logo_label', locale)}</div>
        <div class="set-row__hint">{t('settings.logo_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl logo">
        {#if logo}
          <img class="logo__img" src={logo} alt={t('settings.logo_alt', locale, { name: $query.data?.name ?? '' })} />
        {:else if $query.data}
          <span class="set-row__hint">{t('settings.logo_none', locale)}</span>
        {/if}
        {#if canEdit}
          <input bind:this={input} class="logo__file" type="file" accept="image/png,image/jpeg,image/webp" onchange={picked} />
          <Button size="s" variant="secondary" loading={$upload.isPending} disabled={busy} onclick={() => input?.click()}>
            {t(logo ? 'settings.logo_replace' : 'settings.logo_upload', locale)}
          </Button>
          {#if logo}
            <Button size="s" variant="quiet" tone="warn" loading={$remove.isPending} disabled={busy} onclick={() => $remove.mutate()}>
              {t('settings.logo_remove', locale)}
            </Button>
          {/if}
        {:else if $query.data}
          <span class="set-row__hint">{t('settings.trade_admin_only', locale)}</span>
        {/if}
        <SavedMark shown={saved.is()} />
      </div>
    </div>
  </div>
</section>

<style>
  @layer components {
    .logo {
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s);
    }
    /* Como en el correo: sobre fondo claro, a la altura de la cabecera. */
    .logo__img {
      display: block;
      max-block-size: 4rem;
      max-inline-size: 15rem;
      padding: var(--space-xs);
      background: var(--bg-ultra-light);
      border: var(--border);
      border-radius: var(--radius-s);
    }
    .logo__file {
      display: none;
    }
  }
</style>
