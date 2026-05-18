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

  interface Props {
    count: number | null;
  }

  let { count = null }: Props = $props();

  let label = $derived(count === 1 ? '1 online' : `${count} online`);
  let isAlone = $derived(count !== null && count <= 1);
</script>

{#if count !== null}
  <span
    class={['presence-badge', isAlone && 'presence-badge--alone']
      .filter(Boolean)
      .join(' ')}
    aria-live="polite"
    title={count > 1 ? `${count} users online in this workspace` : 'You are the only one here'}
  >
    <span class="presence-badge__dot" aria-hidden="true"></span>
    <span class="presence-badge__label">{label}</span>
  </span>
{/if}

<style>
  .presence-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border-radius: 999px;
    border: 1px solid var(--neutral-light);
    font-size: var(--text-s);
    color: var(--text-color);
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
