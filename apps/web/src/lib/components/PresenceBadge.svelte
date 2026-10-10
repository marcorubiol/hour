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
   * onMount fires), nothing renders. Once connected, the badge animates
   * in via opacity transition.
   */

  import { appLocale, t } from '$lib/i18n';

  interface Props {
    count: number | null;
  }

  let { count = null }: Props = $props();

  const locale = appLocale();

  let label = $derived(
    t(count === 1 ? 'perf.presence_online_one' : 'perf.presence_online_other', locale, {
      n: count ?? 0,
    }),
  );
  let isAlone = $derived(count !== null && count <= 1);
</script>

{#if count !== null}
  <span
    class={['presence-badge', isAlone && 'presence-badge--alone']
      .filter(Boolean)
      .join(' ')}
    aria-live="polite"
    title={count > 1
      ? t('perf.presence_others', locale, { n: count })
      : t('perf.presence_alone', locale)}
  >
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
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--success) 25%, transparent);
    flex-shrink: 0;
  }

  .presence-badge--alone .presence-badge__dot {
    background: var(--neutral);
    box-shadow: none;
    opacity: 0.55;
  }

  .presence-badge--alone {
    color: var(--text-dark-muted);
  }
</style>
