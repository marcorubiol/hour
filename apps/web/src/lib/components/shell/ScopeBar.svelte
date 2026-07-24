<script lang="ts">
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useScopes, type Scope } from '$lib/stores/scopes.svelte';

  interface Props {
    /** Token → display helpers stay in the /h layout (they feed its
        scopeAutoName too) and arrive here as functions over the nav caches. */
    tokenLabel: (tok: string) => string;
    tokenAccent: (tok: string) => string;
    tokenKind: (tok: string) => 'space' | 'project' | 'line';
    tokenLineKind: (tok: string) => string;
    /** Save ⇄ Update ⇄ Delete state, derived in the layout (it owns
        editingBaseTokens). */
    exactSaved: Scope | null;
    isModified: boolean;
    /** Scope-CRUD actions shared with the rest of the shell — kept in the
        layout, passed down. */
    saveCurrentScope: () => void;
    updateScope: () => void;
    clearScope: () => void;
    /** ⌘K palette lives in the layout. */
    openPaletteAdd: () => void;
  }

  let {
    tokenLabel,
    tokenAccent,
    tokenKind,
    tokenLineKind,
    exactSaved,
    isModified,
    saveCurrentScope,
    updateScope,
    clearScope,
    openPaletteAdd,
  }: Props = $props();

  const pins = usePins();
  const scopes = useScopes();

  // Copy link — the ADR-022 level-3 gesture: the URL already carries the
  // scope, canonical id-form by construction (pins hold slugs, never aliases).
  async function copyScopeLink() {
    if (await copyText(location.href)) {
      addToast({ tone: 'success', message: 'Link copied — scope included.' });
    } else {
      addToast({ tone: 'danger', message: 'Could not copy the link.' });
    }
  }
</script>

<div class="shell__lenschrome">
  <div class="scopebar">
    {#if pins.pins.length === 0}
      <span class="scopebar__scope">
        <span class="scopebar__lead">Scope</span>
        <span class="scopebar__all">Everything · all spaces &amp; projects</span>
      </span>
      <button type="button" class="scopebar__add" onclick={openPaletteAdd}>
        + narrow
      </button>
      <span class="scopebar__right">
        <button type="button" class="scopebar__save" onclick={copyScopeLink}
          >⧉ Copy link</button
        >
      </span>
    {:else}
      <span class="scopebar__lead">Scope</span>
      {#each pins.pins as tok (tok)}
        <span class="tok tok--{tokenKind(tok)}">
          <ScopeGlyph kind={tokenKind(tok)} accent={tokenAccent(tok)} lineKind={tokenLineKind(tok)} />
          <span class="tok__label">
            <span class="tok__kind">{tokenKind(tok)}</span>
            <span class="tok__name">{tokenLabel(tok)}</span>
          </span>
          <button
            type="button"
            class="tok__x"
            onclick={() => pins.remove(tok)}
            aria-label={`Remove ${tokenLabel(tok)}`}>×</button
          >
        </span>
      {/each}
      <button type="button" class="scopebar__add" onclick={openPaletteAdd}>
        + add
      </button>
      <span class="scopebar__right">
        {#if exactSaved}
          <button
            type="button"
            class="scopebar__save"
            onclick={() => scopes.remove(pins.pins)}>× Delete scope</button
          >
        {:else if isModified}
          <button type="button" class="scopebar__save" onclick={updateScope}
            >↺ Update scope</button
          >
          <button type="button" class="scopebar__save" onclick={saveCurrentScope}
            >☆ Save new scope</button
          >
        {:else}
          <button type="button" class="scopebar__save" onclick={saveCurrentScope}
            >☆ Save scope</button
          >
        {/if}
        <button type="button" class="scopebar__save" onclick={copyScopeLink}
          >⧉ Copy link</button
        >
        <button type="button" class="scopebar__clear" onclick={clearScope}
          >Clear</button
        >
      </span>
    {/if}
  </div>
</div>

<style>
  /* ── lens chrome: scope bar + VIEW AS (Scope v2) ── */
  .shell__lenschrome {
    display: flex;
    flex-direction: column;
    gap: var(--space-m);
    padding-block: var(--space-m) 0;
    padding-inline: var(--space-l);
    /* Sibling of .shell__content, so it needs the same cap to stay aligned
       with the body underneath it. */
    inline-size: 100%;
    max-inline-size: calc(var(--page-width) + var(--space-l) * 2);
    margin-inline: auto;
  }
  .scopebar {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    flex-wrap: wrap;
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-l);
    min-block-size: 3rem;
  }
  /* The mono micro-label + serif descriptor are one unit: baseline-aligned to
     each other INSIDE this group, then the group is centered as a block by the
     bar's align-items. (Setting baseline on the bar itself dragged the whole
     row upward — the fix is to decouple the pair's internal alignment from the
     bar's vertical centering.) */
  .scopebar__scope {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-s);
  }
  .scopebar__lead {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .scopebar__all {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .tok {
    --glyph: 11px; /* compact glyph inside the scope-bar pills */
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-xs) var(--space-xs);
    font-size: var(--text-s);
    line-height: 1;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-light);
  }
  /* Kind label + name share a baseline INSIDE this group (so the mono
     "PROJECT" doesn't float above the sans name); the group, the glyph and
     the × stay centered as boxes via .tok's align-items. Same fix as the
     scope descriptor. */
  .tok__label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }
  .tok__kind {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    letter-spacing: var(--mono-letter-spacing);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .tok__name {
    line-height: 1;
  }
  .tok__x {
    display: grid;
    place-items: center;
    inline-size: 1rem;
    block-size: 1rem;
    border: 0;
    border-radius: var(--radius-circle);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    font-size: var(--text-m);
    line-height: 1;
  }
  .tok__x:hover {
    background: color-mix(in oklch, var(--text-color) 10%, transparent);
    color: var(--text-color);
  }
  .scopebar__add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-s);
    cursor: pointer;
    background: transparent;
  }
  .scopebar__add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  .scopebar__right {
    margin-inline-start: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
  }
  .scopebar__save,
  .scopebar__clear {
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .scopebar__save:hover,
  .scopebar__clear:hover {
    color: var(--text-color);
  }
  .scopebar__clear {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
