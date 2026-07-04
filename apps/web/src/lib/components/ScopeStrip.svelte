<script lang="ts">
  /**
   * Scope strip (Adaptive Digest) — the pins row + "Pin" picker. Shared
   * across Today / Calendar / Money so scope stays consistent wherever you
   * are. A pin is a whole space (workspace) or a single line. Clicking a
   * line pin opens its workbench; × unpins. The picker lists spaces, each
   * expandable to pin one of its lines.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { workspacesQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { buildLineIndex, type NavLine, type NavWorkspace } from '$lib/nav';
  import { usePins, spacePin, linePin } from '$lib/stores/pins.svelte';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';

  interface Props {
    onOpenLine: (line: NavLine) => void;
    compact?: boolean;
  }
  let { onOpenLine, compact = false }: Props = $props();

  const pins = usePins();
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let lineIndex = $derived(buildLineIndex(workspaces, $linesQuery.data?.items ?? []));
  let wsBySlug = $derived(new Map(workspaces.map((w) => [w.slug, w])));
  let lineById = $derived(new Map(lineIndex.map((l) => [l.id, l])));

  let pickerOpen = $state(false);
  let expandedWs = $state<string | null>(null);
  let pickerEl = $state<HTMLElement | null>(null);

  // Chip descriptors resolved from the current pins.
  type Chip =
    | { pin: string; kind: 'space'; name: string; accent: string }
    | { pin: string; kind: 'line'; name: string; project: string; accent: string; line: NavLine };
  let chips = $derived.by<Chip[]>(() => {
    const out: Chip[] = [];
    for (const pin of pins.pins) {
      if (pin.startsWith('s:')) {
        const ws = wsBySlug.get(pin.slice(2));
        if (ws) out.push({ pin, kind: 'space', name: ws.name, accent: `var(--accent-${accentIdx(ws.slug)})` });
      } else {
        const line = lineById.get(pin.slice(2));
        if (line) out.push({ pin, kind: 'line', name: line.name, project: line.projectName, accent: line.accent, line });
      }
    }
    return out;
  });

  // Local accent index (mirror of accent util) for space chips without a
  // resolved NavLine to borrow from.
  function accentIdx(slug: string): number {
    let h = 2166136261;
    for (let i = 0; i < slug.length; i++) {
      h ^= slug.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h % 8) + 1;
  }

  $effect(() => {
    function onDoc(e: MouseEvent) {
      if (pickerEl && !pickerEl.contains(e.target as Node)) {
        pickerOpen = false;
        expandedWs = null;
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  function pinSpace(ws: NavWorkspace) {
    pins.add(spacePin(ws.slug));
    pickerOpen = false;
    expandedWs = null;
  }
  function pinLine(line: NavLine) {
    pins.add(linePin(line.id));
    pickerOpen = false;
    expandedWs = null;
  }
  function linesFor(wsId: string): NavLine[] {
    return lineIndex.filter((l) => l.workspaceId === wsId);
  }
</script>

<div class="scope" class:scope--compact={compact}>
  {#each chips as chip (chip.pin)}
    <button
      type="button"
      class="scope__pin"
      style={`--c: ${chip.accent}`}
      onclick={() => chip.kind === 'line' && onOpenLine(chip.line)}
      title={chip.kind === 'line' ? `Open ${chip.name}` : chip.name}
    >
      <span class="scope__dot" aria-hidden="true"></span>
      {#if chip.kind === 'line'}
        {chip.project} <span class="scope__pin-sub">· {chip.name}</span>
      {:else}
        {chip.name}
      {/if}
      <span
        class="scope__rm"
        role="button"
        tabindex="0"
        aria-label="Unpin"
        onclick={(e) => { e.stopPropagation(); pins.remove(chip.pin); }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pins.remove(chip.pin); } }}
      >×</span>
    </button>
  {/each}

  <div class="scope__picker" bind:this={pickerEl}>
    <button
      type="button"
      class="scope__addpin"
      aria-expanded={pickerOpen}
      onclick={() => (pickerOpen = !pickerOpen)}
    >
      <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M7 2.5v9M2.5 7h9" />
      </svg>
      Pin
    </button>
    {#if pickerOpen}
      <div class="pop" role="menu">
        <p class="pop__label">Bring forward — space or line</p>
        <div class="pop__list">
          {#each workspaces as ws (ws.id)}
            {@const expanded = expandedWs === ws.id}
            <div class="pop__group">
              <div class="pop__opt">
                <span class="scope__dot" style={`--c: var(--accent-${accentIdx(ws.slug)})`} aria-hidden="true"></span>
                <button type="button" class="pop__opt-name" onclick={() => pinSpace(ws)}>{ws.name}</button>
                <button type="button" class="pop__pinspace" onclick={() => pinSpace(ws)}>pin space</button>
                <button
                  type="button"
                  class="pop__chev"
                  class:pop__chev--on={expanded}
                  aria-label={expanded ? 'Hide lines' : 'Show lines'}
                  onclick={() => (expandedWs = expanded ? null : ws.id)}
                >›</button>
              </div>
              {#if expanded}
                <div class="pop__lines">
                  {#each linesFor(ws.id) as line (line.id)}
                    <button type="button" class="pop__line" onclick={() => pinLine(line)}>
                      <span class="pop__line-g">{lineKindGlyph(line.kind)}</span>
                      <span class="pop__line-n">{line.name}</span>
                      <span class="pop__line-k">{lineKindLabel(line.kind)}</span>
                    </button>
                  {:else}
                    <p class="pop__empty">No lines in this space yet.</p>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .scope {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    flex-wrap: wrap;
    margin-block-end: var(--space-s);
  }
  .scope--compact {
    margin-block-end: var(--space-xs);
  }

  .scope__pin {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-ultra-light);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-s);
    color: var(--text-color);
    transition: border-color var(--transition);
  }
  .scope__pin:hover {
    border-color: var(--c, var(--text-muted));
  }
  .scope__pin-sub {
    color: var(--text-muted);
  }
  .scope__dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    flex: none;
    border-radius: var(--radius-circle);
    background: var(--c, var(--text-faint));
  }
  .scope__rm {
    display: inline-flex;
    margin-inline-start: var(--space-2xs);
    color: var(--text-faint);
    font-size: var(--text-m);
    line-height: 1;
    cursor: pointer;
  }
  .scope__rm:hover {
    color: var(--danger);
  }

  .scope__picker {
    position: relative;
  }
  .scope__addpin {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: none;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-s);
    color: var(--text-muted);
    transition: color var(--transition), border-color var(--transition);
  }
  .scope__addpin:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }

  .pop {
    position: absolute;
    inset-block-start: calc(100% + var(--space-xs));
    inset-inline-start: 0;
    z-index: var(--z-dropdown);
    inline-size: 300px;
    max-inline-size: 80vw;
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-l);
    box-shadow: var(--box-shadow-3);
    overflow: hidden;
  }
  .pop__label {
    margin: 0;
    padding-block: var(--space-s) var(--space-xs);
    padding-inline: var(--space-m);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .pop__list {
    max-block-size: 360px;
    overflow: auto;
    padding-block-end: var(--space-xs);
  }
  .pop__opt {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
  }
  .pop__opt:hover {
    background: var(--bg-light);
  }
  .pop__opt-name {
    flex: 1;
    min-inline-size: 0;
    border: 0;
    background: none;
    text-align: start;
    font-family: inherit;
    font-size: var(--text-s);
    color: var(--text-color);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop__pinspace {
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: none;
    padding-block: var(--space-2xs);
    padding-inline: var(--space-s);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .pop__pinspace:hover {
    border-color: var(--text-muted);
    color: var(--text-color);
  }
  .pop__chev {
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    font-size: var(--text-m);
    line-height: 1;
    padding: var(--space-2xs);
    transition: transform var(--transition);
  }
  .pop__chev--on {
    transform: rotate(90deg);
    color: var(--text-color);
  }
  .pop__lines {
    padding-block-end: var(--space-xs);
    padding-inline-start: calc(var(--space-m) + var(--space-m));
  }
  .pop__line {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: 100%;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border: 0;
    border-radius: var(--radius-m);
    background: none;
    text-align: start;
    cursor: pointer;
    font-family: inherit;
  }
  .pop__line:hover {
    background: var(--bg-light);
  }
  .pop__line-g {
    inline-size: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-s);
  }
  .pop__line-n {
    flex: 1;
    min-inline-size: 0;
    font-size: var(--text-s);
    color: var(--text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop__line-k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .pop__empty {
    margin: 0;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    font-size: var(--text-xs);
    color: var(--text-faint);
    font-style: italic;
  }
</style>
