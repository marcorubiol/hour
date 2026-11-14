<script lang="ts">
  /**
   * LensHeader — the shared header for the four lenses (Desk · Planner ·
   * Conversations · Money). One structure, one set of classes (the global
   * `.lenshead*` family in base.css), so every lens reads identically:
   *
   *   ┌───────────────────────────────────────────────┐
   *   │  <big title> <aside>                     [+]  │  ← titlerow (bordered)
   *   │  <sub · sub · sub>                             │  ← optional sub line
   *
   * Each lens passes its own `title` (Planner: the month) and, when it has
   * one, a `sub` line of indications/links. Content is lens-specific; the
   * shell is not. The section switcher is NOT here: it lives in the shell's
   * frame, the same on every page (ADR-140). Nor the scope: it is a tag in
   * the frame's field (ADR-202 § 12). Nor the «?»: it is a row of the
   * account menu (ADR-203 § 1), which this head tells which card to bring.
   */
  import type { Snippet } from 'svelte';
  import type { HelpSection } from '$lib/help';
  import { provideHelpSection } from '$lib/help-seen.svelte';

  interface Props {
    /** the big display title — whatever the lens wants to say */
    title: Snippet;
    /** the small ·-separated line below (indications / links); omit if none */
    sub?: Snippet;
    /**
     * Controls that belong TO THE TITLE, beside it: the Planner's `‹ › Now`
     * move the window its title names (ADR-136). Outside the `h1`, so the
     * heading's name stays the title alone.
     */
    titleAside?: Snippet;
    /** The section's welcome card (`FirstVisitCard`): the account menu's
        «Ayuda de esta sección» brings it back. */
    help?: HelpSection;
    /** A lens's own act at the end of the title row: a gesture of the whole
        page, not of the title. */
    tools?: Snippet;
    /** The title is heard and not seen: Hoy, where the piece says the day
        and the frame's clock the date (ADR-203 § 1). No title row is drawn. */
    heard?: boolean;
  }
  let { title, sub, titleAside, help: section, tools, heard = false }: Props = $props();

  provideHelpSection(() => section);
</script>

{#if heard}
  <h1 class="visually-hidden">{@render title()}</h1>
{:else}
<header class="lenshead">
  <div class="lenshead__titlerow">
    <div class="lenshead__lead">
      <h1 class="lenshead__title">{@render title()}</h1>
      {#if titleAside}
        <span class="lenshead__aside">{@render titleAside()}</span>
      {/if}
    </div>
    {#if tools}
      <span class="lenshead__tools lenshead__tools--lens">{@render tools()}</span>
    {/if}
  </div>
  {#if sub}
    <p class="lenshead__sub">{@render sub()}</p>
  {/if}
</header>
{/if}
