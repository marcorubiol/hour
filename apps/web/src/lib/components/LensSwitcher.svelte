<script lang="ts">
  /**
   * LensSwitcher — the Desk · Calendar · Conversations · Money segmented
   * control (ADR-065/067/075). Extracted from the shell chrome so a lens can
   * host it in its OWN header row, beside its title (the Desk does this; the
   * design puts the title and the switcher on one line). The active lens is
   * read from the route so a direct URL visit highlights correctly; picking
   * one sets the lens store (instant feedback) and navigates.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useLens, type Lens } from '$lib/stores/lens.svelte';
  import { detectLocale, t } from '$lib/i18n';

  const lens = useLens();
  const locale = detectLocale(navigator.language);

  const VIEW_AS: { id: Lens; label: string }[] = [
    { id: 'desk', label: t('lens.desk', locale) },
    { id: 'calendar', label: t('lens.calendar', locale) },
    { id: 'conversations', label: t('lens.conversations', locale) },
    { id: 'money', label: t('lens.money', locale) },
  ];

  let active = $derived((page.url.pathname.split('/')[2] ?? 'desk') as Lens);

  function pick(view: Lens) {
    lens.set(view);
    void goto(`/h/${view}`);
  }
</script>

<div class="lensswitch" role="tablist" aria-label="View as">
  {#each VIEW_AS as v (v.id)}
    <button
      type="button"
      role="tab"
      aria-selected={active === v.id}
      class:is-on={active === v.id}
      onclick={() => pick(v.id)}
    >
      {v.label}
    </button>
  {/each}
</div>

<style>
  .lensswitch {
    display: inline-flex;
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding: 2px;
  }
  .lensswitch button {
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border-radius: var(--radius-circle);
    transition:
      background var(--transition),
      color var(--transition);
  }
  .lensswitch button:hover {
    color: var(--text-color);
  }
  .lensswitch button.is-on {
    background: var(--text-color);
    color: var(--bg);
  }
</style>
