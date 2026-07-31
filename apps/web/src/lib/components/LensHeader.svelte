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
    /**
     * Controls that belong TO THE TITLE, beside it (ADR-095): the Planner's
     * `‹ › today` are the controls OF the date, and a date you can walk
     * through is one object — so they ride with it instead of sitting in the
     * row of controls, where they read as a fourth way to change the drawing.
     */
    titleAside?: Snippet;
  }
  let { title, sub, titleAside }: Props = $props();
</script>

<header class="lenshead">
  <div class="lenshead__titlerow">
    <h1 class="lenshead__title">{@render title()}</h1>
    {#if titleAside}
      <span class="lenshead__aside">{@render titleAside()}</span>
    {/if}
    <LensSwitcher />
  </div>
  {#if sub}
    <p class="lenshead__sub">{@render sub()}</p>
  {/if}
</header>
