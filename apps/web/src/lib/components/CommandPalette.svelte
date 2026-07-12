<script lang="ts">
  /**
   * ⌘K command palette (Adaptive Digest) — makes every line and space
   * addressable in one hop. A flat index: lines first (that's the work),
   * spaces after. Type, arrow, enter. Installs the global ⌘K / Escape
   * shortcut itself; the shell also opens it from the top-bar search box
   * (bindable `open`). Navigation decisions live in the parent via the
   * onPick callbacks, so this component stays about search + keyboard.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { tick } from 'svelte';
  import { workspacesQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { buildLineIndex, type NavLine, type NavWorkspace } from '$lib/nav';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';

  interface Props {
    open: boolean;
    onPickLine: (line: NavLine) => void;
    onPickSpace: (ws: NavWorkspace) => void;
    onPickView: (view: 'agenda' | 'calendar' | 'contacts' | 'money') => void;
    onPickAction: (action: CreateAction) => void;
  }
  let { open = $bindable(), onPickLine, onPickSpace, onPickView, onPickAction }: Props = $props();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let query = $state('');
  let sel = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let lineIndex = $derived(buildLineIndex(workspaces, $linesQuery.data?.items ?? []));

  type ViewTarget = 'agenda' | 'calendar' | 'contacts' | 'money';
  type CreateAction = 'new-line' | 'new-project' | 'new-space';
  type ViewItem = { type: 'view'; id: string; target: ViewTarget; name: string };
  type LineItem = { type: 'line'; id: string; line: NavLine };
  type SpaceItem = { type: 'space'; id: string; ws: NavWorkspace };
  type ActionItem = { type: 'action'; id: string; action: CreateAction; name: string };
  type Item = ViewItem | LineItem | SpaceItem | ActionItem;

  const VIEW_ITEMS: ViewItem[] = [
    { type: 'view', id: 'v:agenda', target: 'agenda', name: 'Agenda' },
    { type: 'view', id: 'v:calendar', target: 'calendar', name: 'Calendar' },
    { type: 'view', id: 'v:contacts', target: 'contacts', name: 'Contacts' },
    { type: 'view', id: 'v:money', target: 'money', name: 'Money' },
  ];

  // Creation actions (ADR-056) — the template picker + the two dialogs
  // live in the layout; the palette only announces them.
  const ACTION_ITEMS: ActionItem[] = [
    { type: 'action', id: 'a:new-line', action: 'new-line', name: 'New line…' },
    { type: 'action', id: 'a:new-project', action: 'new-project', name: 'New project…' },
    { type: 'action', id: 'a:new-space', action: 'new-space', name: 'New space…' },
  ];

  let viewResults = $derived.by<ViewItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return VIEW_ITEMS;
    return VIEW_ITEMS.filter((it) => it.name.toLowerCase().includes(q));
  });
  let actionResults = $derived.by<ActionItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTION_ITEMS;
    return ACTION_ITEMS.filter((it) => it.name.toLowerCase().includes(q));
  });
  let lineResults = $derived.by<LineItem[]>(() => {
    const q = query.trim().toLowerCase();
    const lines: LineItem[] = lineIndex.map((line) => ({ type: 'line', id: `l:${line.id}`, line }));
    if (!q) return lines;
    return lines.filter(
      (it) =>
        it.line.name.toLowerCase().includes(q) ||
        it.line.projectName.toLowerCase().includes(q) ||
        it.line.kind.includes(q),
    );
  });
  let spaceResults = $derived.by<SpaceItem[]>(() => {
    const q = query.trim().toLowerCase();
    const spaces: SpaceItem[] = workspaces.map((ws) => ({ type: 'space', id: `s:${ws.slug}`, ws }));
    if (!q) return spaces;
    return spaces.filter((it) => it.ws.name.toLowerCase().includes(q) || it.ws.slug.includes(q));
  });
  // Lines first — they're the work. Views then actions last (quick jumps).
  let ordered = $derived<Item[]>([
    ...lineResults,
    ...spaceResults,
    ...viewResults,
    ...actionResults,
  ]);

  // Reset + focus whenever the palette opens.
  $effect(() => {
    if (open) {
      query = '';
      sel = 0;
      tick().then(() => inputEl?.focus());
    }
  });

  // Global ⌘K toggle + Escape close.
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open = !open;
      } else if (e.key === 'Escape' && open) {
        open = false;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function pick(it: Item) {
    if (it.type === 'line') onPickLine(it.line);
    else if (it.type === 'space') onPickSpace(it.ws);
    else if (it.type === 'action') onPickAction(it.action);
    else onPickView(it.target);
    open = false;
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(sel + 1, ordered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (e.key === 'Enter' && ordered[sel]) {
      e.preventDefault();
      pick(ordered[sel]);
    }
  }
</script>

{#if open}
  <!-- Scrim: click outside closes. The panel stops propagation. -->
  <div
    class="cmdk__scrim"
    role="presentation"
    onmousedown={() => (open = false)}
  >
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Jump to a line or space" tabindex={-1} onmousedown={(e) => e.stopPropagation()}>
      <div class="cmdk__search">
        <svg viewBox="0 0 14 14" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="6.2" cy="6.2" r="4.2" />
          <path d="M9.4 9.4 12 12" />
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          placeholder="Jump to a line or space…"
          aria-label="Search lines and spaces"
          oninput={() => (sel = 0)}
          onkeydown={onInputKey}
        />
        <kbd class="kbd">esc</kbd>
      </div>

      <div class="cmdk__list" role="listbox" aria-label="Results">
        {#if ordered.length === 0}
          <p class="cmdk__empty">No match.</p>
        {/if}
        {#if lineResults.length > 0}
          <p class="cmdk__group">Lines — where you work</p>
          {#each lineResults as it, i (it.id)}
            <button
              type="button"
              class="cmdk__row"
              class:cmdk__row--on={i === sel}
              role="option"
              aria-selected={i === sel}
              onmouseenter={() => (sel = i)}
              onclick={() => pick(it)}
            >
              <span class="cmdk__glyph" style={`--c: ${it.line.accent}`}>{lineKindGlyph(it.line.kind)}</span>
              <span class="cmdk__name">{it.line.name}</span>
              <span class="cmdk__ctx">
                <span class="cmdk__kind">{lineKindLabel(it.line.kind)}</span>
                <span class="cmdk__in">{it.line.projectName}</span>
              </span>
              <span class="cmdk__enter" aria-hidden="true">↵</span>
            </button>
          {/each}
        {/if}
        {#if spaceResults.length > 0}
          <p class="cmdk__group">Spaces</p>
          {#each spaceResults as it, i (it.id)}
            {@const idx = lineResults.length + i}
            <button
              type="button"
              class="cmdk__row"
              class:cmdk__row--on={idx === sel}
              role="option"
              aria-selected={idx === sel}
              onmouseenter={() => (sel = idx)}
              onclick={() => pick(it)}
            >
              <span class="cmdk__glyph cmdk__glyph--space">
                <span class="cmdk__dot"></span>
              </span>
              <span class="cmdk__name">{it.ws.name}</span>
              <span class="cmdk__ctx"><span class="cmdk__kind">space</span></span>
              <span class="cmdk__enter" aria-hidden="true">↵</span>
            </button>
          {/each}
        {/if}
        {#if viewResults.length > 0}
          <p class="cmdk__group">Views</p>
          {#each viewResults as it, i (it.id)}
            {@const idx = lineResults.length + spaceResults.length + i}
            <button
              type="button"
              class="cmdk__row"
              class:cmdk__row--on={idx === sel}
              role="option"
              aria-selected={idx === sel}
              onmouseenter={() => (sel = idx)}
              onclick={() => pick(it)}
            >
              <span class="cmdk__glyph cmdk__glyph--space"><span class="cmdk__dot"></span></span>
              <span class="cmdk__name">{it.name}</span>
              <span class="cmdk__ctx"><span class="cmdk__kind">view</span></span>
              <span class="cmdk__enter" aria-hidden="true">↵</span>
            </button>
          {/each}
        {/if}
        {#if actionResults.length > 0}
          <p class="cmdk__group">New</p>
          {#each actionResults as it, i (it.id)}
            {@const idx = lineResults.length + spaceResults.length + viewResults.length + i}
            <button
              type="button"
              class="cmdk__row"
              class:cmdk__row--on={idx === sel}
              role="option"
              aria-selected={idx === sel}
              onmouseenter={() => (sel = idx)}
              onclick={() => pick(it)}
            >
              <span class="cmdk__glyph cmdk__glyph--space"><span class="cmdk__plus" aria-hidden="true">+</span></span>
              <span class="cmdk__name">{it.name}</span>
              <span class="cmdk__ctx"><span class="cmdk__kind">create</span></span>
              <span class="cmdk__enter" aria-hidden="true">↵</span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="cmdk__foot">
        <span>↑↓ move</span>
        <span>↵ open</span>
        <span class="cmdk__foot-hint">a <b>line</b> is a tour · season · campaign · press line</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .cmdk__scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: color-mix(in oklch, var(--neutral) 28%, transparent);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-block-start: 12vh;
  }

  .cmdk {
    inline-size: min(560px, 92vw);
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-xl);
    box-shadow: var(--box-shadow-3);
    overflow: hidden;
  }

  .cmdk__search {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-m);
    padding-inline: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
    color: var(--text-muted);
  }
  .cmdk__search input {
    flex: 1;
    min-inline-size: 0;
    border: 0;
    outline: none;
    background: none;
    font-family: var(--font-sans);
    font-size: var(--text-l);
    color: var(--text-color);
  }
  .cmdk__search input::placeholder {
    color: var(--text-faint);
  }

  .cmdk__list {
    max-block-size: 52vh;
    overflow: auto;
    padding: var(--space-xs);
  }
  .cmdk__group {
    margin: 0;
    padding-block: var(--space-s) var(--space-xs);
    padding-inline: var(--space-s);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .cmdk__row {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: 100%;
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    border: 0;
    border-radius: var(--radius-l);
    background: none;
    text-align: start;
    cursor: pointer;
    font-family: inherit;
    color: var(--text-color);
  }
  .cmdk__row--on {
    background: var(--bg-light);
  }
  .cmdk__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.6rem;
    block-size: 1.6rem;
    flex: none;
    border-radius: var(--radius-l);
    font-size: var(--text-m);
    color: var(--c, var(--primary));
    background: color-mix(in oklch, var(--c, var(--primary)) 12%, var(--bg-ultra-light));
  }
  .cmdk__glyph--space {
    background: var(--bg-light);
  }
  .cmdk__dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: var(--radius-circle);
    background: var(--text-faint);
  }
  .cmdk__plus {
    font-size: var(--text-m);
    line-height: 1;
    color: var(--text-muted);
  }
  .cmdk__name {
    flex: 1;
    min-inline-size: 0;
    font-size: var(--text-m);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmdk__ctx {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    flex: none;
  }
  .cmdk__kind {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .cmdk__in {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .cmdk__enter {
    color: var(--text-faint);
    font-size: var(--text-s);
    opacity: 0;
  }
  .cmdk__row--on .cmdk__enter {
    opacity: 1;
  }
  .cmdk__empty {
    margin: 0;
    padding: var(--space-l);
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    font-family: var(--font-display);
  }
  .cmdk__foot {
    display: flex;
    align-items: center;
    gap: var(--space-m);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-start: 1px solid var(--border-color-light);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }
  .cmdk__foot-hint {
    margin-inline-start: auto;
    font-family: var(--font-sans);
    letter-spacing: 0;
  }
  .cmdk__foot-hint b {
    color: var(--text-muted);
  }
</style>
