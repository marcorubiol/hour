<script lang="ts">
  /**
   * «No esta vez», con el día de volver a escribir si lo hay (ADR-138 § 4).
   * Uno para el menú de la relación (fila y ficha) y para la barra de la
   * selección: las dos piden lo mismo. Devuelve el día (o null) a `onsave`;
   * quien llama escribe.
   */
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    open: boolean;
    locale: Locale;
    /** A quién: «23 conversaciones»; sin ella, la de la fila ya se sabe. */
    who?: string;
    onsave: (until: string | null) => void;
  }

  let { open = $bindable(), locale, who, onsave }: Props = $props();

  let until = $state('');
  $effect(() => {
    if (open) until = '';
  });

  function save() {
    onsave(until || null);
    open = false;
  }
</script>

<Dialog bind:open title={t('conversations.relation_not_now', locale)} size="s">
  {#if who}<p class="not-now-who">{who}</p>{/if}
  <p class="not-now-hint">{t('conversations.not_now_hint', locale)}</p>
  <Input label={t('conversations.not_now_back', locale)} type="date" bind:value={until} />
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={save}>{t('blackout.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .not-now-who,
    .not-now-hint {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
  }
</style>
