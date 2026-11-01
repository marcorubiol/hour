<script lang="ts">
  /**
   * Presence badge — surfaces the live "N online" count from the workspace
   * presence channel into the shell topbar. Backed by Supabase Realtime
   * presence (no DB writes); `count` is distinct users, not connections —
   * one user with two tabs still reads as 1.
   *
   * Render contract:
   *   <PresenceBadge count={presence?.count ?? null} />
   *
   * When count is null (presence not yet wired — initial render before
   * onMount fires), nothing renders; alone (count ≤ 1) neither: that you are
   * here is not news (ADR-154). With someone else, the badge animates in via
   * opacity transition.
   *
   * `dots` (the foot of the rail, beside the monogram; ADR-140, enmienda del
   * 20-10): no words on screen, one dot per person here (three at most). The
   * number stays for a screen reader and in the tooltip.
   */

  import { appLocale, t } from '$lib/i18n';

  interface Props {
    count: number | null;
    variant?: 'label' | 'dots';
  }

  let { count = null, variant = 'label' }: Props = $props();

  const locale = appLocale();

  let label = $derived(t('perf.presence_online_other', locale, { n: count ?? 0 }));
  let dots = $derived(variant === 'dots' ? Math.min(Math.max(count ?? 0, 1), 3) : 1);
</script>

{#if count !== null && count > 1}
  <span
    class={['presence-badge', variant === 'dots' && 'presence-badge--dots']
      .filter(Boolean)
      .join(' ')}
    aria-live="polite"
    title={t('perf.presence_others', locale, { n: count })}
  >
    {#each { length: dots } as _, i (i)}
      <span class="presence-badge__dot" aria-hidden="true"></span>
    {/each}
    <span class={variant === 'dots' ? 'visually-hidden' : 'presence-badge__label'}>{label}</span>
  </span>
{/if}

<style>
  /* Presence is ambient info, not a control. No box, no pill shape — pill
     radius is reserved for filter/lens selectors (philosophy: clear category
     taxonomy). Just the dot + the label, inline with the topbar rhythm. */
  .presence-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .presence-badge__dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 var(--line-thick) color-mix(in oklch, var(--success) 25%, transparent);
    flex-shrink: 0;
  }

  /* Beside the monogram: the dots alone, close together, without the ring. */
  .presence-badge--dots {
    gap: var(--space-2xs);
  }
  .presence-badge--dots .presence-badge__dot {
    box-shadow: none;
  }
</style>
