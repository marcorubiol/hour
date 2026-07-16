<script lang="ts">
  /**
   * ⌘K — scope builder (Scope v2). Browse the space → project → line tree
   * (→ drills in), or type to filter across all three at once; stage tokens
   * into a "building" set and Apply them as the active scope (pins). This
   * replaces the flat jump palette: with a visible VIEW AS + a saved-scopes
   * sidebar, ⌘K's job is composing scope, not switching views.
   *
   * Keys: ↵ / click add-or-remove a token (NOT space — real names contain
   * spaces, so space stays a normal filter character); ⌘↵ opens the highlighted
   * entity's page; ⇧↵ applies the built scope (advanced — the Apply button is
   * the discoverable path). Creation (new space/project/line) stays reachable
   * from the footer. Installs the global ⌘K / Escape shortcut; the shell also
   * opens it from the top-bar search and the sidebar "browse & combine" button.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import {
    buildLineIndex,
    buildProjectIndex,
    projectUrl,
    lineUrl,
    type NavWorkspace,
  } from '$lib/nav';
  import { parsePin } from '$lib/stores/pins.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { lineKindLabel } from '$lib/utils/line-kind';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';

  type CreateAction = 'new-line' | 'new-project' | 'new-space';

  interface Props {
    open: boolean;
    /** the currently-applied scope — pre-staged when the palette opens */
    initialTokens?: string[];
    onApplyScope: (tokens: string[]) => void;
    onPickAction: (action: CreateAction) => void;
  }
  let {
    open = $bindable(),
    initialTokens = [],
    onApplyScope,
    onPickAction,
  }: Props = $props();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaces = $derived(($workspacesQuery.data?.items ?? []) as NavWorkspace[]);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, $linesQuery.data?.items ?? []));

  let query = $state('');
  /** null = top-level (spaces); `s:<slug>` = that space's projects;
      `p:<id>` = that project's lines. */
  let drill = $state<string | null>(null);
  let staged = $state<string[]>([]);
  let cur = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  type Kind = 'space' | 'project' | 'line';
  interface Row {
    token: string;
    kind: Kind;
    name: string;
    path: string;
    drill: string | null;
    /** for lines: the raw kind (tour/season/…) driving its glyph + label */
    lineKind?: string;
  }
  interface Group {
    key: Kind;
    header: string;
    rows: Row[];
  }

  function labelFor(token: string): string {
    const { kind, key } = parsePin(token);
    if (kind === 'space') return workspaces.find((w) => w.slug === key)?.name ?? key;
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.name ?? 'project';
    return lineIndex.find((l) => l.id === key)?.name ?? 'line';
  }
  function accentFor(token: string): string {
    const { kind, key } = parsePin(token);
    if (kind === 'space') {
      const w = workspaces.find((x) => x.slug === key);
      return w ? accentVarFor(w) : 'var(--text-faint)';
    }
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.accent ?? 'var(--text-faint)';
    return lineIndex.find((l) => l.id === key)?.accent ?? 'var(--text-faint)';
  }
  function lineKindFor(token: string): string {
    const { kind, key } = parsePin(token);
    if (kind !== 'line') return '';
    return lineIndex.find((l) => l.id === key)?.kind ?? '';
  }

  // Placeholder examples — pulled per-user from their OWN loaded nav data
  // (one space · project · line), never hardcoded: in a multi-tenant app a
  // fixed "muk/mamemi" would leak one tenant's names to everyone.
  function hintWord(name: string): string {
    const norm = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return norm.match(/[a-z0-9]{2,}/)?.[0] ?? '';
  }
  let examples = $derived(
    [workspaces[0]?.name, projectIndex[0]?.name, lineIndex[0]?.name]
      .filter((n): n is string => !!n)
      .map(hintWord)
      .filter(Boolean),
  );
  let placeholder = $derived(
    examples.length > 0
      ? `Filter spaces, projects, lines… (try ${examples.map((e) => `“${e}”`).join(', ')})`
      : 'Filter spaces, projects, lines…',
  );

  function spaceRow(w: NavWorkspace, canDrill: boolean): Row {
    return { token: `s:${w.slug}`, kind: 'space', name: w.name, path: '', drill: canDrill ? `s:${w.slug}` : null };
  }
  function projectRow(p: (typeof projectIndex)[number], canDrill: boolean, path: string): Row {
    return { token: `p:${p.id}`, kind: 'project', name: p.name, path, drill: canDrill ? `p:${p.id}` : null };
  }
  function lineRow(l: (typeof lineIndex)[number], path: string): Row {
    return { token: `l:${l.id}`, kind: 'line', name: l.name, path, drill: null, lineKind: l.kind };
  }

  // Results grouped under section headers (Spaces / Projects / Working lines).
  // Filter mode surfaces all three; browsing shows just the current level's.
  let groups = $derived.by<Group[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const spaces = workspaces
        .filter((w) => w.name.toLowerCase().includes(q) || w.slug.includes(q))
        .map((w) => spaceRow(w, false));
      const projects = projectIndex
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.slug.includes(q) ||
            p.workspaceName.toLowerCase().includes(q),
        )
        .map((p) => projectRow(p, false, p.workspaceName));
      const lines = lineIndex
        .filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.projectName.toLowerCase().includes(q) ||
            l.kind.includes(q),
        )
        .map((l) => lineRow(l, l.projectName));
      return (
        [
          { key: 'space', header: 'Spaces', rows: spaces },
          { key: 'project', header: 'Projects', rows: projects },
          { key: 'line', header: 'Working lines', rows: lines },
        ] as Group[]
      ).filter((g) => g.rows.length > 0);
    }
    if (drill === null) {
      return [{ key: 'space', header: 'Spaces', rows: workspaces.map((w) => spaceRow(w, true)) }];
    }
    const { kind, key } = parsePin(drill);
    if (kind === 'space') {
      return [
        {
          key: 'project',
          header: 'Projects',
          rows: projectIndex.filter((p) => p.workspaceSlug === key).map((p) => projectRow(p, true, '')),
        },
      ];
    }
    return [
      {
        key: 'line',
        header: 'Working lines',
        rows: lineIndex.filter((l) => l.projectId === key).map((l) => lineRow(l, '')),
      },
    ];
  });
  let flatRows = $derived(groups.flatMap((g) => g.rows));
  let groupOffsets = $derived.by(() => {
    let acc = 0;
    return groups.map((g) => {
      const o = acc;
      acc += g.rows.length;
      return o;
    });
  });

  function openRow(r: Row) {
    const { kind, key } = parsePin(r.token);
    if (kind === 'space') void goto(`/h/${key}/`);
    else if (kind === 'project') {
      const p = projectIndex.find((x) => x.id === key);
      if (p) void goto(projectUrl(p));
    } else {
      const l = lineIndex.find((x) => x.id === key);
      if (l) void goto(lineUrl(l));
    }
    open = false;
  }

  // Breadcrumb parts (label + optional up-target for the clickable crumbs).
  let crumb = $derived.by<{ label: string; up: string | null; here: boolean }[]>(() => {
    if (query.trim())
      return [
        { label: 'All', up: '', here: false },
        { label: `results for “${query.trim()}”`, up: null, here: true },
      ];
    if (drill === null) return [{ label: 'All', up: null, here: true }];
    const { kind, key } = parsePin(drill);
    if (kind === 'space') {
      const w = workspaces.find((x) => x.slug === key);
      return [
        { label: 'All', up: '', here: false },
        { label: w?.name ?? key, up: null, here: true },
      ];
    }
    const proj = projectIndex.find((p) => p.id === key);
    return [
      { label: 'All', up: '', here: false },
      { label: proj?.workspaceName ?? '', up: proj ? `s:${proj.workspaceSlug}` : '', here: false },
      { label: proj?.name ?? key, up: null, here: true },
    ];
  });

  function goHome() {
    drill = null;
    query = '';
    cur = 0;
  }
  function drillTo(target: string) {
    drill = target;
    query = '';
    cur = 0;
    tick().then(() => inputEl?.focus());
  }
  /** Up one level: filter → tree, project's lines → its space, space → top. */
  function goBack() {
    if (query.trim()) {
      query = '';
      cur = 0;
      return;
    }
    if (drill === null) return;
    const { kind, key } = parsePin(drill);
    if (kind === 'space') {
      drill = null;
    } else {
      const proj = projectIndex.find((p) => p.id === key);
      drill = proj ? `s:${proj.workspaceSlug}` : null;
    }
    cur = 0;
    tick().then(() => inputEl?.focus());
  }
  function isStaged(token: string): boolean {
    return staged.includes(token);
  }
  function toggleStage(token: string) {
    staged = staged.includes(token) ? staged.filter((t) => t !== token) : [...staged, token];
  }
  function apply() {
    onApplyScope([...staged]);
    open = false;
  }

  // Reset + pre-stage the active scope whenever the palette opens.
  $effect(() => {
    if (open) {
      query = '';
      drill = null;
      staged = [...initialTokens];
      cur = 0;
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

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = Math.min(cur + 1, flatRows.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(cur - 1, 0);
    } else if (e.key === 'ArrowRight') {
      const r = flatRows[cur];
      // Only drill when the caret is at the end (so → can still move within
      // the typed text); with an empty query the caret is always at the end.
      const atEnd = !inputEl || inputEl.selectionStart === query.length;
      if (r?.drill && atEnd) {
        e.preventDefault();
        drillTo(r.drill);
      }
    } else if (e.key === 'ArrowLeft') {
      // Go up a level only when the caret is at the start — otherwise ← moves
      // within the typed text as usual.
      const atStart = inputEl && inputEl.selectionStart === 0 && inputEl.selectionEnd === 0;
      if (atStart && (query.trim() || drill !== null)) {
        e.preventDefault();
        goBack();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        // ⌘↵ → open the highlighted entity's page
        if (flatRows[cur]) openRow(flatRows[cur]);
      } else if (e.shiftKey) {
        // ⇧↵ → apply the built scope (advanced; the Apply button is the
        // discoverable path, ⌘↵ being reserved for "open")
        apply();
      } else if (flatRows[cur]) {
        // ↵ → add / remove from the scope
        toggleStage(flatRows[cur].token);
      }
    }
  }
</script>

{#if open}
  <div class="cmdk__scrim" role="presentation" onmousedown={() => (open = false)}>
    <div
      class="cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="Build a scope"
      tabindex={-1}
      onmousedown={(e) => e.stopPropagation()}
    >
      <div class="cmdk__search">
        <svg viewBox="0 0 14 14" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="6.2" cy="6.2" r="4.2" />
          <path d="M9.4 9.4 12 12" />
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          {placeholder}
          aria-label="Filter spaces, projects and lines"
          oninput={() => {
            drill = null;
            cur = 0;
          }}
          onkeydown={onInputKey}
        />
        <span class="cmdk__esc">esc to close</span>
      </div>

      <div class="cmdk__list" role="listbox" aria-label="Results">
        <p class="cmdk__crumb">
          {#each crumb as c, i (i)}
            {#if i > 0}<span class="cmdk__crumb-sep" aria-hidden="true">›</span>{/if}
            {#if c.here}
              <span>{c.label}</span>
            {:else if c.up === ''}
              <button type="button" class="cmdk__crumb-link" onclick={goHome}>{c.label}</button>
            {:else if c.up}
              <button type="button" class="cmdk__crumb-link" onclick={() => c.up && drillTo(c.up)}>{c.label}</button>
            {:else}
              <span>{c.label}</span>
            {/if}
          {/each}
        </p>

        {#if flatRows.length === 0}
          <p class="cmdk__empty">No match.</p>
        {/if}

        {#each groups as g, gIdx (g.key)}
          <p class="cmdk__group">{g.header}</p>
          {#each g.rows as r, i (r.token)}
            {@const gi = groupOffsets[gIdx] + i}
            <div class="cmdk__row" class:cmdk__row--on={gi === cur} class:cmdk__row--staged={isStaged(r.token)}>
              <button
                type="button"
                class="cmdk__main"
                role="option"
                aria-selected={gi === cur}
                onmouseenter={() => (cur = gi)}
                onclick={() => toggleStage(r.token)}
              >
                <ScopeGlyph kind={r.kind} accent={accentFor(r.token)} lineKind={r.lineKind ?? ''} />
                <span class="cmdk__kind">{r.kind === 'line' ? lineKindLabel(r.lineKind ?? '') : r.kind}</span>
                <span class="cmdk__name">
                  {r.name}{#if r.path}<span class="cmdk__path"> · {r.path}</span>{/if}
                </span>
                {#if isStaged(r.token)}<span class="cmdk__added">✓ added</span>{/if}
              </button>
              <button type="button" class="cmdk__open" onclick={() => openRow(r)}>
                open <span aria-hidden="true">↗</span>
              </button>
              {#if r.drill}
                <button
                  type="button"
                  class="cmdk__chev"
                  aria-label={`Drill into ${r.name}`}
                  onclick={() => r.drill && drillTo(r.drill)}>›</button
                >
              {/if}
            </div>
          {/each}
        {/each}
      </div>

      <div class="cmdk__staged">
        <span class="cmdk__staged-lead">Building</span>
        {#if staged.length === 0}
          <span class="cmdk__staged-all">Everything (no filters)</span>
        {:else}
          {#each staged as t (t)}
            <span class="cmdk__tok">
              <ScopeGlyph kind={parsePin(t).kind} accent={accentFor(t)} lineKind={lineKindFor(t)} />
              <span class="cmdk__tok-label">{labelFor(t)}</span>
              <button type="button" class="cmdk__tok-x" aria-label={`Unstage ${labelFor(t)}`} onclick={() => toggleStage(t)}>×</button>
            </span>
          {/each}
        {/if}
        <button type="button" class="cmdk__apply" onclick={apply}>
          {staged.length === 0 ? 'Apply' : `Apply ${staged.length} filter${staged.length > 1 ? 's' : ''}`}
        </button>
      </div>

      <div class="cmdk__foot">
        <span><b>↑↓</b> move</span>
        <span><b>→</b> drill in</span>
        <span><b>←</b> back</span>
        <span><b>↵</b> add / remove</span>
        <span><b>⌘↵</b> open</span>
        <span><b>⇧↵</b> apply</span>
        <span class="cmdk__foot-new">
          New:
          <button type="button" onclick={() => onPickAction('new-space')}>space</button>
          <button type="button" onclick={() => onPickAction('new-project')}>project</button>
          <button type="button" onclick={() => onPickAction('new-line')}>line</button>
        </span>
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
    inline-size: min(640px, 94vw);
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-xl);
    box-shadow: var(--box-shadow-3);
    overflow: hidden;
  }

  .cmdk__search {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-s);
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
    font-size: var(--text-m);
    color: var(--text-color);
  }
  .cmdk__search input::placeholder {
    font-size: var(--text-s);
    color: color-mix(in oklch, var(--text-faint) 55%, transparent);
  }
  .cmdk__esc {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }

  .cmdk__list {
    max-block-size: 52vh;
    overflow: auto;
    padding: var(--space-xs);
  }
  .cmdk__crumb {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0;
    padding-block: var(--space-s) var(--space-xs);
    padding-inline: var(--space-s);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .cmdk__crumb-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--text-muted);
    cursor: pointer;
  }
  .cmdk__crumb-link:hover {
    color: var(--text-color);
    text-decoration: underline;
  }
  .cmdk__group {
    margin: 0;
    padding-block: var(--space-s) var(--space-2xs);
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
    border-radius: var(--radius-l);
  }
  .cmdk__row--on {
    background: var(--bg-light);
  }
  .cmdk__main {
    flex: 1;
    min-inline-size: 0;
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    border: 0;
    background: none;
    text-align: start;
    cursor: pointer;
    font-family: inherit;
    color: var(--text-color);
  }
  .cmdk__kind {
    flex: none;
    inline-size: 3.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .cmdk__name {
    flex: 1;
    min-inline-size: 0;
    font-size: var(--text-s);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmdk__path {
    color: var(--text-faint);
    font-size: var(--text-s);
  }
  .cmdk__added {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--success);
  }
  .cmdk__open {
    flex: none;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
    cursor: pointer;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border-radius: var(--radius-s);
    white-space: nowrap;
  }
  .cmdk__open:hover {
    color: var(--text-color);
    background: color-mix(in oklch, var(--text-color) 8%, transparent);
  }
  .cmdk__chev {
    flex: none;
    inline-size: 2rem;
    align-self: stretch;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: var(--text-l);
    cursor: pointer;
    border-radius: var(--radius-l);
  }
  .cmdk__chev:hover {
    background: color-mix(in oklch, var(--text-color) 10%, transparent);
    color: var(--text-color);
  }
  .cmdk__empty {
    margin: 0;
    padding: var(--space-l);
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
    font-family: var(--font-display);
  }

  .cmdk__staged {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-xs);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-start: 1px solid var(--border-color-light);
    background: var(--bg-light);
  }
  .cmdk__staged-lead {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .cmdk__staged-all {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .cmdk__tok {
    --glyph: 11px; /* smaller glyph inside the compact building pills */
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding-block: 2px;
    padding-inline: var(--space-xs) var(--space-xs);
    border-radius: var(--radius-circle);
    border: 1px solid var(--border-color-dark);
    background: var(--bg-ultra-light);
    font-size: var(--text-s);
    line-height: 1;
  }
  .cmdk__tok-label {
    line-height: 1;
  }
  .cmdk__tok-x {
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    font-size: var(--text-s);
    padding: 0;
  }
  .cmdk__tok-x:hover {
    color: var(--text-color);
  }
  .cmdk__apply {
    margin-inline-start: auto;
    border: 0;
    border-radius: var(--radius-m);
    background: var(--text-color);
    color: var(--bg);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    cursor: pointer;
  }
  .cmdk__apply:hover {
    background: var(--neutral-semi-dark);
  }

  .cmdk__foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-s);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-start: 1px solid var(--border-color-light);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }
  .cmdk__foot > span {
    white-space: nowrap;
  }
  .cmdk__foot b {
    color: var(--text-muted);
    font-weight: 500;
  }
  .cmdk__foot-new {
    margin-inline-start: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .cmdk__foot-new button {
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-faint);
    font-family: inherit;
    font-size: var(--text-xs);
    padding-block: 1px;
    padding-inline: var(--space-xs);
    cursor: pointer;
  }
  .cmdk__foot-new button:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
</style>
