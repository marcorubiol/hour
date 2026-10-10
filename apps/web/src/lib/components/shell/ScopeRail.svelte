<script lang="ts">
  import { tick } from 'svelte';
  import { detectLocale, LOCALE_TAG, t } from '$lib/i18n';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useScopes, sameSet as scopesSameSet, type Scope } from '$lib/stores/scopes.svelte';
  import RailPulse from './RailPulse.svelte';

  interface Props {
    /** The hall greets outside any scope — no row lights up there. */
    atHome: boolean;
    /** Applying a scope routes + touches editingBaseTokens, so the action
        stays in the /h layout and arrives here as a prop. */
    applyScope: (s: Scope) => void;
    /** ⌘K palette lives in the layout. */
    openPaletteFresh: () => void;
    /** On a phone the rail is a drawer (base.css § Drawer) and the layout
        owns whether it is out: the menu button lives in the top bar. On a
        desktop this changes nothing — the rail is always there. */
    open?: boolean;
    onclose?: () => void;
    /** THE SHELL'S ONE CLOCK, ticking in the layout: on a phone the same
        time is drawn in the top bar as the door to this drawer, and two
        timers could disagree about the minute. `clockTime` is its HH:MM,
        formatted once for both faces. */
    clockNow: Date;
    clockTime: string;
  }

  let {
    atHome,
    applyScope,
    openPaletteFresh,
    open = false,
    onclose,
    clockNow,
    clockTime,
  }: Props = $props();

  const pins = usePins();
  const scopes = useScopes();
  const calm = useCalm();

  // Sidebar scope list: Everything + user-saved bundles only (no auto
  // per-space rows — spaces are reached from ⌘K; the sidebar is curated).
  const everything: Scope = { name: 'Everything', tokens: [] };

  // Session locale — feeds both Intl (rail clock) and the dictionary (lens
  // labels). /h is client-only (ssr = false), so navigator is safe at init.
  const locale = detectLocale(navigator.language);

  // "dilluns · 13 jul" — CSS mono-caps does the shouting; strip the
  // abbreviation dot some locales append to the short month.
  let clockDate = $derived(
    `${new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'long' }).format(clockNow)} · ${clockNow.getDate()} ${new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'short' }).format(clockNow).replace(/\.$/, '')}`,
  );

  // Inline rename of a saved scope (double-click its name).
  const scopeKey = (s: Scope) => s.tokens.join(',');
  let editingScopeKey = $state<string | null>(null);
  let editingScopeName = $state('');
  let renameInputEl = $state<HTMLInputElement | null>(null);
  function startRename(s: Scope) {
    editingScopeKey = scopeKey(s);
    editingScopeName = s.name;
    tick().then(() => renameInputEl?.select());
  }
  function commitRename(s: Scope) {
    scopes.rename(s.tokens, editingScopeName);
    editingScopeKey = null;
  }
  function cancelRename() {
    editingScopeKey = null;
  }
</script>

{#if open}
  <button
    type="button"
    class="drawer__backdrop"
    aria-label={t('shell.menu_close', locale)}
    onclick={() => onclose?.()}
  ></button>
{/if}
<aside id="shell-rail" class="shell__side drawer" data-open={open || undefined} aria-label={t('shell.scopes', locale)}>
  <div class="side-clock">
    <!-- THE CLOCK IS THE WAY HOME. It took the door the wordmark used to
         hold: «here, now» is already what it says, and a clock you can press
         to get back to the top of the app is a smaller promise than a logo
         that navigates. -->
    <a class="side-clock__now" href="/h" aria-label={t('hall.home', locale)}>
      <time class="side-clock__time clock-face" datetime={clockTime}>{clockTime}</time>
      <p class="side-clock__date">{clockDate}</p>
    </a>
    <button
      type="button"
      class="side-calm"
      class:is-on={calm.on}
      aria-pressed={calm.on}
      title={t('desk.calm', locale)}
      onclick={() => calm.toggle()}
    >
      <span>{t('desk.calm', locale)}</span><span class="side-calm__k">C</span>
    </button>
  </div>
  <!-- THE PULSE reads the clock's own tick: one timer in the rail, and the
       two can never disagree about what minute it is. It sits ABOVE the
       scopes because it is not filtered by them — see RailPulse. -->
  <RailPulse now={clockNow} {locale} />
  <div class="side-sec">
    <div class="side-sec__h">{t('shell.scopes', locale)}</div>
    <!-- The hall greets outside any scope: no row lights up there, not
         even Everything — highlighting starts once you're on a surface
         the scope actually filters. -->
    <button
      type="button"
      class="srow srow--every"
      class:is-on={!atHome && scopesSameSet([], pins.pins)}
      onclick={() => applyScope(everything)}
    >
      <span class="sglyph sglyph--every" aria-hidden="true">∑</span>
      <span class="srow__name">{t('shell.everything', locale)}</span>
    </button>
    {#each scopes.saved as s (s.tokens.join(','))}
      {#if editingScopeKey === scopeKey(s)}
        <div class="srow srow--editing">
          <input
            class="srow__rename"
            bind:this={renameInputEl}
            bind:value={editingScopeName}
            onblur={() => commitRename(s)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(s);
              else if (e.key === 'Escape') cancelRename();
            }}
          />
        </div>
      {:else}
        <button
          type="button"
          class="srow"
          class:is-on={!atHome && scopesSameSet(s.tokens, pins.pins)}
          onclick={() => applyScope(s)}
          ondblclick={() => startRename(s)}
          title={t('shell.rename_hint', locale)}
        >
          <span class="srow__name">{s.name}</span>
        </button>
      {/if}
    {/each}
  </div>

  {#if scopes.recent.length > 0}
    <div class="side-sec">
      <div class="side-sec__h">{t('shell.recent', locale)}</div>
      {#each scopes.recent as r (r.name + r.tokens.join(','))}
        <button
          type="button"
          class="srow"
          class:is-on={!atHome && scopesSameSet(r.tokens, pins.pins)}
          onclick={() => applyScope(r)}
        >
          <span class="srow__name">{r.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="side-foot">
    <button type="button" class="side-browse" onclick={openPaletteFresh}>
      ⌘K · {t('shell.browse', locale)}
    </button>
  </div>
</aside>

<style>
  /* ── scopes sidebar (Scope v2) — saved scopes + recents, NOT the tree.
     The space→project→line hierarchy is browsed from ⌘K; this rail holds
     one-click named scopes (Everything, each space, saved bundles) + the
     recents. Replaces the ADR-057 space rail. */
  .shell__side {
    inline-size: 15.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-l);
    /* No top padding: the clock block owns the top offset so it can match
       the header's wordmark exactly (see .side-clock). */
    padding-block: 0 var(--space-l);
    padding-inline: var(--space-m);
    border-inline-end: 1px solid var(--border-color-light);
    background: var(--bg-light);
  }
  /* In the flow only where there is room for it. Below 48rem `.drawer`
     (base.css) places it instead: off-canvas until the menu opens it. These
     are the only rules the two places disagree on, so they are the only
     ones fenced — everything inside the rail draws the same in both. */
  @media (min-width: 48rem) {
    .shell__side {
      grid-column: 1;
      grid-row: 1 / -1;
      position: sticky;
      inset-block-start: 0;
      align-self: start;
      z-index: var(--z-sticky);
      min-block-size: 100vh;
    }
  }
  .side-clock {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-s);
    padding-inline: var(--space-xs);
    /* Same top offset as the header's wordmark, by construction: the
       BrandMark (size m = --text-xl, line-height 1) centers inside the
       --header-height band, so its top sits at (band − type)/2. */
    padding-block-start: calc((var(--header-height) - var(--text-xl)) / 2);
  }
  .side-clock__now {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    text-decoration: none;
    color: inherit;
  }
  .side-clock__now:hover .side-clock__time {
    color: var(--text-color);
  }
  /* Calm toggle — the mode control lives by the clock (spec § Desk · Calm).
     outline = available / solid = active, so it reads as a control. */
  .side-calm {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    /* NO FILL WHEN IT IS OFF (Marco, 2026-07-31). The outline alone says
       «available»; a fill on a control that is not doing anything reads as a
       state. The solid ground stays for `.is-on`, where it IS the state. */
    background: none;
    /* Desk lens button shape (sans, --space-2xs/--space-m, radius-circle) but
       a micro-label one step under the smallest named step — 9px is the
       Planner's own margin voice, and this is furniture beside a clock. */
    font-family: var(--font-sans);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
  }
  .side-calm:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  .side-calm.is-on {
    background: var(--text-color);
    border-color: var(--text-color);
    color: var(--bg);
  }
  .side-calm__k {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.35em;
    block-size: 1.35em;
    border: 1px solid currentColor;
    border-radius: var(--radius-s);
    /* The key stays mono even though the label is now sans. */
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.6;
    text-transform: none;
  }
  /* The face itself is `.clock-face` (base.css): the top bar draws the same
     time on a phone, and one face cannot have two type rules. */
  .side-clock__date {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .side-sec {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .side-sec__h {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
    padding-inline: var(--space-xs);
    margin-block-end: var(--space-xs);
  }
  .srow {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: 100%;
    text-align: start;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: var(--space-xs);
    border-radius: var(--radius-m);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    transition: background var(--transition), color var(--transition);
  }
  .srow:hover {
    background: color-mix(in oklch, var(--text-color) 5%, transparent);
  }
  .srow.is-on {
    background: var(--bg-ultra-light);
    color: var(--text-color);
    box-shadow: 0 0 0 1px var(--border-color-dark);
  }
  .sglyph {
    inline-size: 1.4rem;
    block-size: 1.4rem;
    flex: none;
    border-radius: var(--radius-s);
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    color: #fff;
  }
  .sglyph--every {
    background: var(--text-color);
    color: var(--bg);
    font-family: var(--font-mono);
  }
  .srow__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* inline rename (double-click a saved scope) */
  .srow--editing {
    padding: 0;
  }
  .srow__rename {
    inline-size: 100%;
    padding-block: var(--space-xs);
    padding-inline: var(--space-xs);
    border: 1px solid var(--primary);
    border-radius: var(--radius-m);
    background: var(--bg-ultra-light);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-color);
    outline: none;
  }
  .side-foot {
    margin-block-start: auto;
  }
  .side-browse {
    inline-size: 100%;
    background: transparent;
    border: 1px dashed var(--border-color-dark);
    cursor: pointer;
    padding: var(--space-s);
    border-radius: var(--radius-m);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    transition: color var(--transition), border-color var(--transition);
  }
  .side-browse:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
</style>
