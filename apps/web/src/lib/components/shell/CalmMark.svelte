<script lang="ts">
  /**
   * Calm with its name (ADR-229, amends ADR-208): «-:-» was the mode that
   * helps most and nobody knew what it was until they pressed it. Now a small
   * button that says «Calma»: an outline when it is off, filled when it is
   * on. Its behaviour does not change. One home for it: the phone's top bar
   * and the desktop rail both draw this. The `c` key toggles it too (the /h
   * layout).
   */
  import { appLocale, t } from '$lib/i18n';
  import { useCalm } from '$lib/stores/calm.svelte';

  const calm = useCalm();
  const locale = appLocale();
</script>

<button type="button" class="calmmark" aria-pressed={calm.on} aria-keyshortcuts="C" onclick={() => calm.toggle()}
  >{t('calm.mark_aria', locale)}</button
>

<style>
  .calmmark {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    block-size: var(--control-size-s);
    padding: 0 var(--space-s);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font-size: var(--text-s);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
  }
  /* The finger's target grows past the drawn box, never the box. */
  .calmmark::before {
    content: '';
    position: absolute;
    inset: min(0em, calc((var(--control-size-s) - var(--touch-target)) / 2));
  }
  @media (hover: hover) {
    .calmmark:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }
  }
  .calmmark[aria-pressed='true'] {
    background: var(--heading-color);
    border-color: var(--heading-color);
    color: var(--bg);
  }
</style>
