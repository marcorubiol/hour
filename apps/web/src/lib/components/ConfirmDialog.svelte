<script lang="ts">
  /**
   * The confirmation of what cannot be undone (tarea 134). One rule for
   * removing anything: what can be undone goes at once, with «Deshacer» in
   * its toast (`$lib/undo-remove`); what cannot, or what reaches other people
   * (revoking access, a link others hold, a function with its bolo, someone's
   * data), asks first, here. The two-tap button («Borrar → ¿Borrar del
   * todo?») is gone.
   *
   * The same paper as the function's delete: what will happen in a sentence,
   * «Cancelar» quiet, the verb in the warn tone.
   */
  import type { Snippet } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    open?: boolean;
    title: string;
    /** What will happen, in one or two sentences. */
    body?: string;
    /** The verb on the button («Revocar», «Borrar», «Quitar»). */
    confirm: string;
    busy?: boolean;
    locale: Locale;
    onconfirm: () => void;
    children?: Snippet;
  }

  let { open = $bindable(false), title, body, confirm, busy = false, locale, onconfirm, children }: Props = $props();
</script>

<Dialog bind:open {title} size="s">
  {#if body}<p class="confirm__body">{body}</p>{/if}
  {#if children}{@render children()}{/if}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button variant="secondary" tone="warn" loading={busy} onclick={onconfirm}>{confirm}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .confirm__body {
      margin: 0;
    }
  }
</style>
