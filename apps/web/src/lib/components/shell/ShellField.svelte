<script lang="ts">
  /**
   * The frame's one field: search and scope in one place, on every lens and
   * at every width (ADR-202 § 12, design-system rule 15). Unscoped it says
   * «Buscar en todo»; scoped, what is scoped sits inside it as a tag with its
   * × (`ScopeTag`) and the field says only «Buscar» (at 390 px «Search in
   * MaMeMi» broke in two).
   *
   * It is a door, not an input: pressing it opens the palette (ADR-178), whose
   * first rows with nothing typed are the saved scopes and the recents
   * (ADR-203 § 6). The field's own button takes every press the tag does not:
   * its hit area spans the whole field, and the tag sits above it.
   */
  import { appLocale, t } from '$lib/i18n';
  import { usePins } from '$lib/stores/pins.svelte';
  import type { ScopeDoor } from '$lib/scope-door';
  import ScopeTag from './ScopeTag.svelte';

  let { door, onopen }: { door: ScopeDoor; onopen: () => void } = $props();

  const pins = usePins();
  const locale = appLocale();

  let scoped = $derived(pins.pins.length > 0);
  let openEl: HTMLButtonElement | undefined = $state();
</script>

<search class="field">
  <svg class="field__glass" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="6.2" cy="6.2" r="4.2" />
    <path d="M9.4 9.4 12 12" />
  </svg>
  {#if scoped}<ScopeTag {door} onclear={() => openEl?.focus()} />{/if}
  <button bind:this={openEl} type="button" class="field__open" aria-keyshortcuts="Meta+K" onclick={onopen}>
    <span class="field__label">{t(scoped ? 'shell.search' : 'shell.search_everything', locale)}</span>
    <kbd class="kbd keys field__kbd" aria-hidden="true">⌘K</kbd>
  </button>
</search>

<style>
  /* The field's frame: a rounded box on the page's raised paper. Its height
     is the frame's (`--shell-field-size`, the /h layout), its width the
     cell's. One line, always: what does not fit ellipsizes. */
  .field {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
    block-size: var(--shell-field-size, auto);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m) var(--space-s);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-ultra-light);
    color: var(--text-faint);
    white-space: nowrap;
    transition: border-color var(--transition);
  }
  @media (hover: hover) {
    .field:hover {
      border-color: var(--text-muted);
    }
  }
  /* The ring of the field's button is the field's: the box it draws is not
     the button's (which only spans what follows the tag). */
  .field:has(.field__open:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: var(--focus-offset);
  }
  .field__glass {
    flex: none;
    inline-size: 0.875rem;
    block-size: 0.875rem;
    fill: none;
    stroke: currentColor;
    stroke-width: var(--mark-stroke);
  }
  .field__open {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: text;
  }
  .field__open:focus-visible {
    outline: none;
  }
  /* Every press on the field that is not the tag's is this button's. */
  .field__open::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .field__label {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  /* ⌘K is a keyboard's promise: from 48 rem, and only while there is room. */
  .field__kbd {
    flex: none;
  }
  @media (max-width: 47.999rem) {
    .field__kbd {
      display: none;
    }
  }
</style>
