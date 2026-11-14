<script lang="ts">
  /**
   * Presence badge — surfaces the live "N online" count from the network
   * presence (every space you belong to) into the shell. Backed by Supabase Realtime
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
   * At the foot of the rail, beside the monogram, it says «2 en línea»
   * (tarea 132: the dots alone said nothing to anyone who did not already
   * know). On a phone the bar has no room for it: there the monogram carries
   * a dot and this badge is a line inside the account menu (ADR-204).
   *
   * The figure is the whole network (NetworkPresenceStore: every space you
   * belong to, you included), and the title says so.
   */

  import { appLocale, t } from '$lib/i18n';

  interface Props {
    count: number | null;
  }

  let { count = null }: Props = $props();

  const locale = appLocale();

  let label = $derived(t('perf.presence_online_other', locale, { n: count ?? 0 }));
</script>

{#if count !== null && count > 1}
  <span class="presence-badge" aria-live="polite" title={t('perf.presence_others', locale, { n: count })}>
    <span class="presence-badge__dot" aria-hidden="true"></span>
    <span class="presence-badge__label">{label}</span>
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

  .presence-badge__label {
    white-space: nowrap;
  }
</style>
