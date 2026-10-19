<script lang="ts">
  /**
   * FirstTimeNote: el aviso de primera vez (ayuda contextual, enfoque A). Una
   * línea dentro del propio bloque, la primera vez que tiene contenido de ese
   * tipo (`when`), con «Entendido». Sale una vez por persona (`help_seen`).
   */
  import { t, appLocale } from '$lib/i18n';
  import { eventKey, noteVisible, type HelpEvent } from '$lib/help';
  import { help, ensureHelp, markHelpSeen } from '$lib/help-seen.svelte';

  interface Props {
    event: HelpEvent;
    /** El bloque tiene ya el contenido que el aviso explica. */
    when: boolean;
  }
  let { event, when }: Props = $props();

  const locale = appLocale();
  let key = $derived(eventKey(event));

  $effect(() => {
    if (when) void ensureHelp();
  });
</script>

{#if noteVisible(help, key, when)}
  <p class="first-note" data-testid="first-time-note" data-event={event}>
    <span>{t(`help.event.${event}`, locale)}</span>
    <button type="button" class="block-head__act" onclick={() => markHelpSeen(key)}>{t('help.got_it', locale)}</button>
  </p>
{/if}

<style>
  @layer components {
    .first-note {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2xs) var(--space-s);
      margin: var(--space-xs) 0;
      padding: var(--space-xs) var(--space-s);
      border-inline-start: var(--focus-width) solid var(--info);
      background: var(--bg-ultra-light);
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .first-note .block-head__act {
      text-decoration: underline;
    }
  }
</style>
