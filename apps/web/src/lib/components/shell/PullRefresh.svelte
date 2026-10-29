<script lang="ts">
  /**
   * PULL TO REFRESH, the frame's (Marco, 24-10). An iPhone's home-screen app
   * has no pull of its own; this one is mounted once by the /h layout, so
   * every lens has it. A finger only (pointer: coarse): the mouse never sees
   * it. The gesture lives in `$lib/pull-refresh`; this draws the mark and
   * asks the screen's active queries again (not a reload: what is on screen
   * stays while they answer). A failed answer shows where each screen
   * already shows one; here it is only said aloud.
   */
  import { onMount } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { t, type Locale } from '$lib/i18n';
  import {
    cssLengthPx,
    pullBlocked,
    pullEnd,
    pullMove,
    pullProgress,
    pullStart,
    type PullState,
  } from '$lib/pull-refresh';

  interface Props {
    locale: Locale;
  }
  let { locale }: Props = $props();

  /** The longest the mark waits for the answers before it goes. */
  const SETTLE_CAP_MS = 10_000;

  const queryClient = useQueryClient();

  let distance = $state(0);
  let dragging = $state(false);
  let refreshing = $state(false);
  let announce = $state('');
  let progress = $derived(pullProgress(distance, threshold()));

  let el = $state<HTMLElement | null>(null);
  let gesture: PullState | null = null;

  function threshold(): number {
    if (!el) return 0;
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return cssLengthPx(getComputedStyle(el).getPropertyValue('--pull-threshold'), root);
  }

  function atTop(): boolean {
    return (document.scrollingElement ?? document.documentElement).scrollTop <= 0;
  }

  async function refresh() {
    refreshing = true;
    distance = threshold();
    announce = t('pull.refreshing', locale);
    const done = queryClient.refetchQueries({ type: 'active' });
    await Promise.race([done, new Promise((r) => setTimeout(r, SETTLE_CAP_MS))]);
    const failed = queryClient
      .getQueryCache()
      .findAll({ type: 'active' })
      .some((q) => q.state.status === 'error');
    announce = t(failed ? 'pull.failed' : 'pull.done', locale);
    refreshing = false;
    distance = 0;
  }

  onMount(() => {
    const coarse = matchMedia('(pointer: coarse)');

    function onStart(e: TouchEvent) {
      gesture = null;
      if (refreshing || !coarse.matches || e.touches.length !== 1) return;
      if (pullBlocked(e.target as Element | null, document)) return;
      const p = e.touches[0];
      gesture = pullStart(p.clientX, p.clientY, atTop());
    }
    function onMove(e: TouchEvent) {
      if (!gesture || gesture.phase === 'refused') return;
      if (e.touches.length !== 1) {
        gesture = null;
        distance = 0;
        dragging = false;
        return;
      }
      const p = e.touches[0];
      // A downward start at the top is the pull's from its first move, so
      // the browser does not begin its own bounce or refresh under it.
      if (gesture.phase === 'pending') {
        const dx = p.clientX - gesture.startX;
        const dy = p.clientY - gesture.startY;
        if (dy > 0 && dy > Math.abs(dx) && e.cancelable) e.preventDefault();
      }
      gesture = pullMove(gesture, p.clientX, p.clientY, { threshold: threshold() });
      if (gesture.phase !== 'pulling') return;
      if (e.cancelable) e.preventDefault();
      dragging = true;
      distance = gesture.distance;
    }
    function onEnd() {
      const g = gesture;
      gesture = null;
      if (!g || g.phase !== 'pulling') return;
      dragging = false;
      if (pullEnd(g, { threshold: threshold() })) void refresh();
      else distance = 0;
    }

    const passive = { passive: true } as const;
    document.addEventListener('touchstart', onStart, passive);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, passive);
    document.addEventListener('touchcancel', onEnd, passive);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  });
</script>

<!-- Drawn under the top bar and out of it as the finger pulls: nothing to
     focus, nothing read but the line that says what happened. -->
<div
  class="pull"
  bind:this={el}
  class:pull--dragging={dragging}
  class:pull--refreshing={refreshing}
  style:--pull-distance="{distance}px"
  style:--pull-progress={progress}
  aria-hidden="true"
>
  <span class="pull__mark"></span>
</div>
<p class="visually-hidden" aria-live="polite">{announce}</p>

<style>
  .pull {
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;
    z-index: calc(var(--z-sticky) - 1);
    display: flex;
    justify-content: center;
    pointer-events: none;
    /* Hidden under the top bar at rest; the mark's own size plus the travel. */
    transform: translateY(calc(var(--pull-distance) - 100%));
    opacity: var(--pull-progress);
    transition:
      transform var(--duration-slow) var(--ease-snappy),
      opacity var(--duration-slow) var(--ease-snappy);
  }
  /* Under the finger it follows the finger, no lag. */
  .pull--dragging {
    transition: none;
  }
  .pull__mark {
    display: block;
    box-sizing: content-box;
    inline-size: var(--pull-mark);
    block-size: var(--pull-mark);
    padding: var(--space-xs);
    margin-block-start: var(--space-s);
    border: var(--line-hairline) solid var(--border-color-light);
    border-radius: var(--radius-circle);
    background: var(--bg);
    box-shadow: var(--box-shadow-2);
    /* The ring is drawn by its pseudo, like the button's spinner. */
    position: relative;
  }
  .pull__mark::before {
    content: '';
    position: absolute;
    inset: var(--space-xs);
    border: var(--line-hairline) solid var(--text-muted);
    border-block-start-color: transparent;
    border-radius: var(--radius-circle);
    /* The ring turns with the pull, three quarters by the threshold. */
    transform: rotate(calc(var(--pull-progress) * 270deg));
  }
  .pull--refreshing .pull__mark::before {
    animation: btn-spin var(--duration-spin) linear infinite;
  }
  /* Reduced motion: no turn under the finger and no spin; the ring stands
     still and its arrival is the only sign. */
  @media (prefers-reduced-motion: reduce) {
    .pull__mark::before {
      transform: none;
    }
    .pull--refreshing .pull__mark::before {
      animation: none;
    }
  }
</style>
