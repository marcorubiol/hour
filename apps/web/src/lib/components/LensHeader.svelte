<script lang="ts">
  /**
   * LensHeader — the shared header for the four lenses (Desk · Planner ·
   * Conversations · Money). One structure, one set of classes (the global
   * `.lenshead*` family in base.css), so every lens reads identically:
   *
   *   ┌───────────────────────────────────────────────┐
   *   │  <big title> <aside>       [scope ▾] [+] [?] │  ← titlerow (bordered)
   *   │  <sub · sub · sub>                             │  ← optional sub line
   *
   * Each lens passes its own `title` (Desk: "28 need you", Planner: the month)
   * and, when it has one, a `sub` line of indications/links. Content is
   * lens-specific; the shell is not. The section switcher is NOT here: it
   * lives in the shell's frame, the same on every page (ADR-140).
   */
  import type { Snippet } from 'svelte';
  import { t, appLocale } from '$lib/i18n';
  import { cardKey, type HelpSection } from '$lib/help';
  import { help, toggleCard } from '$lib/help-seen.svelte';
  import { scopeDoor } from '$lib/scope-door';
  import ScopePill from '$lib/components/shell/ScopePill.svelte';

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
    /** The section's welcome card (`FirstVisitCard`): its «?» lives here, at the end of the title row. */
    help?: HelpSection;
    /** A lens's own act, in the ring of the «?» and before it (Hoy's «+»,
        ADR-148): a gesture of the whole page, not of the title. */
    tools?: Snippet;
  }
  let { title, sub, titleAside, help: section, tools }: Props = $props();

  // THE SCOPE IS A PILL IN THIS ROW (ADR-152), on every lens and at every
  // width: «Todo» unscoped, the name of what is scoped otherwise, before the
  // lens's own act and its «?». Off the /h shell there is no door, no pill.
  const door = scopeDoor();
</script>

<header class="lenshead">
  <div class="lenshead__titlerow">
    <div class="lenshead__lead">
      <h1 class="lenshead__title">{@render title()}</h1>
      {#if titleAside}
        <span class="lenshead__aside">{@render titleAside()}</span>
      {/if}
    </div>
    {#if section || door || tools}
      <span class="lenshead__tools lenshead__tools--help">
        {#if door}<ScopePill {door} />{/if}
        {#if tools}{@render tools()}{/if}
        {#if section}
        <button
          type="button"
          class="lenshead__help"
          id={`help-${section}`}
          aria-label={t('help.section_aria', appLocale())}
          aria-expanded={help.reopened === cardKey(section)}
          onclick={() => toggleCard(cardKey(section))}><span aria-hidden="true">?</span></button
        >
        {/if}
      </span>
    {/if}
  </div>
  {#if sub}
    <p class="lenshead__sub">{@render sub()}</p>
  {/if}
</header>
