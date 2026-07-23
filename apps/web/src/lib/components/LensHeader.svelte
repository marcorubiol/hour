<script lang="ts">
  /**
   * LensHeader — the shared header for the four lenses (Desk · Planner ·
   * Conversations · Money). One structure, one set of classes (the global
   * `.lenshead*` family in base.css), so every lens reads identically:
   *
   *   ┌───────────────────────────────────────────────┐
   *   │  <big title>                    [LensSwitcher] │  ← titlerow (bordered)
   *   │  <sub · sub · sub>                             │  ← optional sub line
   *
   * Each lens passes its own `title` (Desk: "28 need you", Planner: the month)
   * and, when it has one, a `sub` line of indications/links. Content is
   * lens-specific; the shell is not.
   */
  import type { Snippet } from 'svelte';
  import LensSwitcher from '$lib/components/LensSwitcher.svelte';

  interface Props {
    /** the big display title — whatever the lens wants to say */
    title: Snippet;
    /** the small ·-separated line below (indications / links); omit if none */
    sub?: Snippet;
  }
  let { title, sub }: Props = $props();
</script>

<header class="lenshead">
  <div class="lenshead__titlerow">
    <h1 class="lenshead__title">{@render title()}</h1>
    <LensSwitcher />
  </div>
  {#if sub}
    <p class="lenshead__sub">{@render sub()}</p>
  {/if}
</header>
