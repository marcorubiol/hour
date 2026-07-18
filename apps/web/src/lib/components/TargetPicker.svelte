<script lang="ts">
  /**
   * TargetPicker (ADR-068) — single-select entity picker for the task
   * composer's "where". Mirrors the ⌘K scope builder's navigation exactly
   * (CommandPalette): BROWSE the space → project → line tree (→ / chevron
   * drills in, ← / crumb goes back, ↑↓ move, ↵ / click picks), or TYPE to
   * filter flat across every level at once — where shows and conversations
   * also surface (they have no clean home in the container tree, so they are
   * reachable by name, not by browsing). Single-select: ↵ / click commits the
   * parent and closes; no staging, no Apply.
   *
   * Spaces / projects / lines come from the warm nav caches (['workspaces'] /
   * ['projects'] / ['lines']) — free. Shows and conversations are passed in by
   * the host that already has them loaded (the Desk), so no extra fetch fires.
   *
   * A popover, not a modal: the OWNER (TaskComposer) handles outside-click
   * close over the trigger+panel wrapper. This component owns keyboard,
   * drilling and selection only.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { tick } from 'svelte';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import { buildProjectIndex, buildLineIndex, type NavWorkspace } from '$lib/nav';
  import { parsePin } from '$lib/stores/pins.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { lineKindLabel } from '$lib/utils/line-kind';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { TaskTarget, TaskTargetKind } from '$lib/task';

  interface EntityLite {
    id: string;
    name: string;
  }
  interface Props {
    locale: Locale;
    performances?: EntityLite[];
    conversations?: EntityLite[];
    onselect: (target: TaskTarget) => void;
    onclose: () => void;
  }
  let { locale, performances = [], conversations = [], onselect, onclose }: Props = $props();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  let workspaces = $derived(($workspacesQuery.data?.items ?? []) as NavWorkspace[]);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, $linesQuery.data?.items ?? []));

  let query = $state('');
  /** null = top level (spaces); `s:<slug>` = that space's projects;
      `p:<id>` = that project's lines. */
  let drill = $state<string | null>(null);
  let cur = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  interface Row {
    target: TaskTarget;
    /** secondary context (workspace / project name) */
    path?: string;
    /** drill token if this row has a deeper level, else null */
    drill: string | null;
  }
  interface Group {
    key: TaskTargetKind;
    header: string;
    rows: Row[];
  }

  function spaceRow(w: NavWorkspace, canDrill: boolean): Row {
    return {
      target: { kind: 'space', id: w.id, name: w.name, accent: accentVarFor(w) },
      drill: canDrill ? `s:${w.slug}` : null,
    };
  }
  function projectRow(p: (typeof projectIndex)[number], canDrill: boolean, path: string): Row {
    return {
      target: { kind: 'project', id: p.id, name: p.name, accent: p.accent },
      path,
      drill: canDrill ? `p:${p.id}` : null,
    };
  }
  function lineRow(l: (typeof lineIndex)[number], path: string): Row {
    return {
      target: { kind: 'line', id: l.id, name: l.name, accent: l.accent, lineKind: l.kind },
      path,
      drill: null,
    };
  }

  // Results: filter mode surfaces every level at once (including shows +
  // conversations, reachable by name); browse mode shows just the current
  // level's rows — the ⌘K model.
  let groups = $derived.by<Group[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hit = (...s: (string | null | undefined)[]) =>
        s.some((x) => (x ?? '').toLowerCase().includes(q));
      const spaces = workspaces.filter((w) => hit(w.name, w.slug)).map((w) => spaceRow(w, false));
      const projects = projectIndex
        .filter((p) => hit(p.name, p.slug, p.workspaceName))
        .map((p) => projectRow(p, false, p.workspaceName));
      const lines = lineIndex
        .filter((l) => hit(l.name, l.projectName, l.kind))
        .map((l) => lineRow(l, l.projectName));
      const shows: Row[] = performances
        .filter((s) => hit(s.name))
        .map((s) => ({ target: { kind: 'performance', id: s.id, name: s.name }, drill: null }));
      const convs: Row[] = conversations
        .filter((c) => hit(c.name))
        .map((c) => ({ target: { kind: 'conversation', id: c.id, name: c.name }, drill: null }));
      return (
        [
          { key: 'space', header: t('picker.spaces', locale), rows: spaces },
          { key: 'project', header: t('picker.projects', locale), rows: projects },
          { key: 'line', header: t('picker.lines', locale), rows: lines },
          { key: 'performance', header: t('picker.performances', locale), rows: shows },
          { key: 'conversation', header: t('picker.conversations', locale), rows: convs },
        ] as Group[]
      ).filter((g) => g.rows.length > 0);
    }
    if (drill === null) {
      return [
        { key: 'space', header: t('picker.spaces', locale), rows: workspaces.map((w) => spaceRow(w, true)) },
      ];
    }
    const { kind, key } = parsePin(drill);
    if (kind === 'space') {
      return [
        {
          key: 'project',
          header: t('picker.projects', locale),
          rows: projectIndex.filter((p) => p.workspaceSlug === key).map((p) => projectRow(p, true, '')),
        },
      ];
    }
    return [
      {
        key: 'line',
        header: t('picker.lines', locale),
        rows: lineIndex.filter((l) => l.projectId === key).map((l) => lineRow(l, '')),
      },
    ];
  });
  let flat = $derived(groups.flatMap((g) => g.rows));
  let offsets = $derived.by(() => {
    let acc = 0;
    return groups.map((g) => {
      const o = acc;
      acc += g.rows.length;
      return o;
    });
  });

  // Breadcrumb (All › space › project) — clickable, like ⌘K.
  let crumb = $derived.by<{ label: string; up: string | null | ''; here: boolean }[]>(() => {
    if (query.trim())
      return [
        { label: t('picker.all', locale), up: '', here: false },
        { label: t('picker.results', locale), up: null, here: true },
      ];
    if (drill === null) return [{ label: t('picker.all', locale), up: null, here: true }];
    const { kind, key } = parsePin(drill);
    if (kind === 'space') {
      const w = workspaces.find((x) => x.slug === key);
      return [
        { label: t('picker.all', locale), up: '', here: false },
        { label: w?.name ?? key, up: null, here: true },
      ];
    }
    const proj = projectIndex.find((p) => p.id === key);
    return [
      { label: t('picker.all', locale), up: '', here: false },
      { label: proj?.workspaceName ?? '', up: proj ? `s:${proj.workspaceSlug}` : '', here: false },
      { label: proj?.name ?? key, up: null, here: true },
    ];
  });

  $effect(() => {
    tick().then(() => inputEl?.focus());
  });
  // Keep the highlight in range as the level / filter changes.
  $effect(() => {
    if (cur > flat.length - 1) cur = Math.max(0, flat.length - 1);
  });

  function choose(r: Row | undefined) {
    if (r) onselect(r.target);
  }
  function goHome() {
    drill = null;
    query = '';
    cur = 0;
    tick().then(() => inputEl?.focus());
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

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = Math.min(cur + 1, flat.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(cur - 1, 0);
    } else if (e.key === 'ArrowRight') {
      const r = flat[cur];
      const atEnd = !inputEl || inputEl.selectionStart === query.length;
      if (r?.drill && atEnd) {
        e.preventDefault();
        drillTo(r.drill);
      }
    } else if (e.key === 'ArrowLeft') {
      const atStart = inputEl && inputEl.selectionStart === 0 && inputEl.selectionEnd === 0;
      if (atStart && (query.trim() || drill !== null)) {
        e.preventDefault();
        goBack();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[cur]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  const isGlyph = (k: TaskTargetKind) => k === 'space' || k === 'project' || k === 'line';
  const kindLabel = (r: Row) =>
    r.target.kind === 'line'
      ? lineKindLabel(r.target.lineKind ?? '')
      : t(`picker.kind_${r.target.kind}`, locale);
</script>

<div class="tp" role="dialog" aria-label={t('picker.aria', locale)}>
  <div class="tp__search">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder={t('picker.search', locale)}
      aria-label={t('picker.search', locale)}
      oninput={() => {
        drill = null;
        cur = 0;
      }}
      onkeydown={onKey}
    />
  </div>

  <p class="tp__crumb">
    {#each crumb as c, i (i)}
      {#if i > 0}<span class="tp__crumb-sep" aria-hidden="true">›</span>{/if}
      {#if c.here}
        <span>{c.label}</span>
      {:else if c.up === ''}
        <button type="button" class="tp__crumb-link" onclick={goHome}>{c.label}</button>
      {:else if c.up}
        <button type="button" class="tp__crumb-link" onclick={() => c.up && drillTo(c.up)}>{c.label}</button>
      {:else}
        <span>{c.label}</span>
      {/if}
    {/each}
  </p>

  <div class="tp__list" role="listbox" aria-label={t('picker.aria', locale)}>
    {#if flat.length === 0}
      <p class="tp__empty">{t('picker.no_match', locale)}</p>
    {/if}
    {#each groups as g, gi (g.key)}
      <p class="tp__group">{g.header}</p>
      {#each g.rows as r, i (r.target.kind + r.target.id)}
        {@const idx = offsets[gi] + i}
        <div class="tp__row" class:tp__row--on={idx === cur}>
          <button
            type="button"
            class="tp__main"
            role="option"
            aria-selected={idx === cur}
            onmouseenter={() => (cur = idx)}
            onclick={() => choose(r)}
          >
            {#if isGlyph(r.target.kind)}
              <ScopeGlyph
                kind={r.target.kind as 'space' | 'project' | 'line'}
                accent={r.target.accent ?? 'var(--text-faint)'}
                lineKind={r.target.lineKind ?? ''}
              />
            {:else}
              <span class="tp__leaf" aria-hidden="true"></span>
            {/if}
            <span class="tp__kind">{kindLabel(r)}</span>
            <span class="tp__name"
              >{r.target.name}{#if r.path}<span class="tp__path"> · {r.path}</span>{/if}</span
            >
          </button>
          {#if r.drill}
            <button
              type="button"
              class="tp__chev"
              aria-label={`Open ${r.target.name}`}
              onclick={() => r.drill && drillTo(r.drill)}>›</button
            >
          {/if}
        </div>
      {/each}
    {/each}
  </div>

  <div class="tp__foot">
    <span><b>↑↓</b> {t('picker.hint_move', locale)}</span>
    <span><b>→</b> {t('picker.hint_in', locale)}</span>
    <span><b>←</b> {t('picker.hint_back', locale)}</span>
    <span><b>↵</b> {t('picker.hint_pick', locale)}</span>
  </div>
</div>

<style>
  @layer components {
    .tp {
      position: absolute;
      inset-block-start: calc(100% + var(--space-2xs));
      inset-inline-start: 0;
      z-index: var(--z-dropdown, 50);
      inline-size: min(24rem, 92vw);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-l);
      box-shadow: var(--box-shadow-3);
      overflow: hidden;
    }
    .tp__search {
      padding: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }
    .tp__search input {
      inline-size: 100%;
      border: 0;
      outline: none;
      background: none;
      padding-block: var(--space-2xs);
      padding-inline: var(--space-xs);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .tp__search input::placeholder {
      color: color-mix(in oklch, var(--text-faint) 65%, transparent);
    }
    .tp__crumb {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0;
      padding-block: var(--space-xs) var(--space-2xs);
      padding-inline: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tp__crumb-sep {
      color: var(--border-color-dark);
    }
    .tp__crumb-link {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tp__crumb-link:hover {
      color: var(--text-color);
      text-decoration: underline;
    }
    .tp__list {
      max-block-size: 40vh;
      overflow-y: auto;
      padding: var(--space-2xs);
    }
    .tp__group {
      margin: 0;
      padding-block: var(--space-s) var(--space-2xs);
      padding-inline: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tp__row {
      display: flex;
      align-items: center;
      border-radius: var(--radius-m);
    }
    .tp__row--on {
      background: var(--bg-light);
    }
    .tp__main {
      flex: 1;
      min-inline-size: 0;
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-xs);
      border: 0;
      border-radius: var(--radius-m);
      background: none;
      text-align: start;
      cursor: pointer;
      color: var(--text-color);
      font-family: inherit;
    }
    .tp__leaf {
      flex: none;
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--text-faint);
      margin-inline: 0.28rem;
    }
    .tp__kind {
      flex: none;
      inline-size: 3.5rem;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tp__name {
      flex: 1;
      min-inline-size: 0;
      font-size: var(--text-s);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tp__path {
      color: var(--text-faint);
    }
    .tp__chev {
      flex: none;
      inline-size: 2rem;
      align-self: stretch;
      border: 0;
      background: none;
      color: var(--text-faint);
      font-size: var(--text-l);
      cursor: pointer;
      border-radius: var(--radius-m);
    }
    .tp__chev:hover {
      background: color-mix(in oklch, var(--text-color) 10%, transparent);
      color: var(--text-color);
    }
    .tp__empty {
      margin: 0;
      padding: var(--space-m);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-muted);
    }
    .tp__foot {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }
    .tp__foot > span {
      white-space: nowrap;
    }
    .tp__foot b {
      color: var(--text-muted);
      font-weight: 500;
    }
  }
</style>
