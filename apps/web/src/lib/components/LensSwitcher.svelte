<script lang="ts">
  /**
   * LensSwitcher — the Desk · Planner · Conversations · Money segmented
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

  // Desk is the home/digest, not a peer lens (grill 2026-07-23): it gets its own
  // pill; the segmented "view as" holds only the three concern lenses.
  const VIEW_AS: { id: Lens; label: string }[] = [
    { id: 'planner', label: t('lens.planner', locale) },
    { id: 'conversations', label: t('lens.conversations', locale) },
    { id: 'money', label: t('lens.money', locale) },
  ];

  let active = $derived((page.url.pathname.split('/')[2] ?? 'desk') as Lens);

  function pick(view: Lens) {
    lens.set(view);
    void goto(`/h/${view}`);
  }
</script>

<div class="lensswitch-wrap">
  <button
    type="button"
    class="lensswitch__home"
    class:is-on={active === 'desk'}
    aria-current={active === 'desk' ? 'page' : undefined}
    onclick={() => pick('desk')}
  >
    {t('lens.desk', locale)}
  </button>
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
</div>

<style>
  .lensswitch-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .lensswitch__home {
    appearance: none;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-ultra-light);
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
  .lensswitch__home:hover {
    color: var(--text-color);
  }
  .lensswitch__home.is-on {
    background: var(--text-color);
    color: var(--bg);
    border-color: var(--text-color);
  }
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
