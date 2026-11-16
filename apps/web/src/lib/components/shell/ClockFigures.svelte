<script lang="ts">
  /**
   * The shell clock's figures (ADR-208). Entering calm they give way to the
   * clock without figures for a moment, then the hour is back: the two share
   * one cell, so the clock keeps the hour's width and nothing beside it moves.
   * One home: the rail's clock and the phone's top bar both draw this.
   */
  import { useCalm } from '$lib/stores/calm.svelte';

  let { time }: { time: string } = $props();
  const calm = useCalm();
</script>

<span class="figures" class:figures--blank={calm.blank}>
  <span class="figures__time">{time}</span>
  <span class="figures__blank" aria-hidden="true">--:--</span>
</span>

<style>
  .figures {
    display: inline-grid;
    justify-items: center;
  }
  .figures > * {
    grid-area: 1 / 1;
    transition: opacity var(--duration-slow) var(--transition-timing);
  }
  .figures__blank,
  .figures--blank .figures__time {
    opacity: 0;
  }
  .figures--blank .figures__blank {
    opacity: 1;
  }
</style>
