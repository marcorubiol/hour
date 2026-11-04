<script lang="ts">
  /**
   * Alta a mano de una persona en una lista (tarea 101; plan § 4.4,
   * `add_audience_subscription`). Correo, nombre si lo da e idioma si la lista
   * tiene varios. Queda sin confirmar y le sale la confirmación: el aviso dice
   * qué pasó (`AddPersonOutcome`). Lo abren la página de la lista y la fila de
   * la lista en Envíos; quien lo abre decide si se ofrece (editar el público,
   * lista no archivada, con texto vigente).
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { AddPersonResult, AudienceLanguage } from '$lib/audience';

  interface Props {
    open: boolean;
    audienceId: string;
    listName: string;
    languages: AudienceLanguage[];
    defaultLanguage: AudienceLanguage;
    locale: Locale;
  }

  let { open = $bindable(), audienceId, listName, languages, defaultLanguage, locale }: Props = $props();

  const queryClient = useQueryClient();
  const ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  let address = $state('');
  let name = $state('');
  let language = $state<string>('es');

  $effect(() => {
    if (!open) return;
    address = '';
    name = '';
    language = defaultLanguage;
  });

  let valid = $derived(ADDRESS_RE.test(address.trim()) && address.trim().length <= 254);

  const add = createMutation({
    mutationFn: () =>
      mutateJSON<AddPersonResult>('POST', `/api/audience/${audienceId}/people`, {
        address: address.trim(),
        name: name.trim() || null,
        language,
      }),
    onSuccess: (r) => {
      const shown = address.trim().toLowerCase();
      open = false;
      if (r) {
        const ok = r.outcome === 'sent' || r.outcome === 'confirmed';
        addToast({ tone: ok ? 'success' : 'warning', message: t(`audience.added_${r.outcome}`, locale, { address: shown }) });
      }
      void queryClient.invalidateQueries({ queryKey: ['audience', audienceId] });
      void queryClient.invalidateQueries({ queryKey: ['audience-lists'] });
    },
    onError: (err) => {
      const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
      const known = code && t(`audience.err_${code}`, locale) !== `audience.err_${code}` ? t(`audience.err_${code}`, locale) : '';
      addToast({ tone: 'danger', title: t('audience.not_saved', locale), message: known || (err instanceof Error ? err.message : '') });
    },
  });
</script>

<Dialog bind:open title={t('audience.add_person', locale)} description={listName} size="s">
  <form
    class="aap"
    data-testid="audience-add-person"
    onsubmit={(e) => {
      e.preventDefault();
      if (valid && !$add.isPending) $add.mutate();
    }}
  >
    <Input type="email" label={t('audience.add_email', locale)} bind:value={address} required autocomplete="off" maxlength={254} autofocus />
    <Input label={t('audience.add_name', locale)} bind:value={name} autocomplete="off" maxlength={200} />
    {#if languages.length > 1}
      <Select
        label={t('audience.add_language', locale)}
        options={languages.map((l) => ({ value: l, label: t(`mailout.lang_${l}`, locale) }))}
        bind:value={language}
      />
    {/if}
    <p class="aap__hint">{t('audience.add_hint', locale)}</p>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button loading={$add.isPending} disabled={!valid} onclick={() => $add.mutate()}>{t('audience.add_go', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .aap {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .aap__hint {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
  }
</style>
