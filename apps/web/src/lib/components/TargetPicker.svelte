<script lang="ts">
  /**
   * TargetPicker (ADR-068) — single-select entity picker for the task
   * composer's "where". The scope-bar vocabulary reused for authoring: same
   * ScopeGlyph glyphs (space circle · project rhombus · line tile), same warm
   * nav caches (['workspaces'] / ['projects'] / ['lines']) the ⌘K scope
   * builder reads — but single-select, no staging / Apply. Spaces, projects
   * and lines come from those caches (free); shows and conversations are
   * passed in by the host that already has them loaded (the Desk), so the
   * picker never fires its own heavy fetch.
   *
   * A popover, not a modal: the OWNER (TaskComposer) handles outside-click
   * close over the trigger+panel wrapper — a listener here would fight the
   * trigger's own toggle. This component only owns keyboard + selection.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { tick } from 'svelte';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import { buildProjectIndex, buildLineIndex, type NavWorkspace } from '$lib/nav';
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
    /** shows the host already has loaded (Desk) — offered as parents */
    performances?: EntityLite[];
    /** conversations the host already has loaded — offered as parents */
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
  let cur = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  interface Row extends TaskTarget {
    path?: string;
  }
  interface Group {
    key: TaskTargetKind;
    header: string;
    rows: Row[];
  }

  let groups = $derived.by<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = (...s: (string | null | undefined)[]) =>
      !q || s.some((x) => (x ?? '').toLowerCase().includes(q));
    const spaces: Row[] = workspaces
      .filter((w) => hit(w.name, w.slug))
      .map((w) => ({ kind: 'space', id: w.id, name: w.name, accent: accentVarFor(w) }));
    const projects: Row[] = projectIndex
      .filter((p) => hit(p.name, p.workspaceName, p.slug))
      .map((p) => ({ kind: 'project', id: p.id, name: p.name, accent: p.accent, path: p.workspaceName }));
    const lines: Row[] = lineIndex
      .filter((l) => hit(l.name, l.projectName, l.kind))
      .map((l) => ({
        kind: 'line',
        id: l.id,
        name: l.name,
        accent: l.accent,
        lineKind: l.kind,
        path: l.projectName,
      }));
    const perfs: Row[] = performances
      .filter((p) => hit(p.name))
      .map((p) => ({ kind: 'performance', id: p.id, name: p.name }));
    const convs: Row[] = conversations
      .filter((c) => hit(c.name))
      .map((c) => ({ kind: 'conversation', id: c.id, name: c.name }));
    return (
      [
        { key: 'space', header: t('picker.spaces', locale), rows: spaces },
        { key: 'project', header: t('picker.projects', locale), rows: projects },
        { key: 'line', header: t('picker.lines', locale), rows: lines },
        { key: 'performance', header: t('picker.performances', locale), rows: perfs },
        { key: 'conversation', header: t('picker.conversations', locale), rows: convs },
      ] as Group[]
    ).filter((g) => g.rows.length > 0);
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

  $effect(() => {
    tick().then(() => inputEl?.focus());
  });
  // Keep the highlight in range as the filter narrows.
  $effect(() => {
    if (cur > flat.length - 1) cur = Math.max(0, flat.length - 1);
  });

  function choose(r: Row) {
    onselect({ kind: r.kind, id: r.id, name: r.name, accent: r.accent, lineKind: r.lineKind });
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = Math.min(cur + 1, flat.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(cur - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[cur]) choose(flat[cur]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  const isGlyph = (k: TaskTargetKind) => k === 'space' || k === 'project' || k === 'line';
  const kindLabel = (r: Row) =>
    r.kind === 'line' ? lineKindLabel(r.lineKind ?? '') : t(`picker.kind_${r.kind}`, locale);
</script>

<div class="tp" role="dialog" aria-label={t('picker.aria', locale)}>
  <div class="tp__search">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder={t('picker.search', locale)}
      aria-label={t('picker.search', locale)}
      oninput={() => (cur = 0)}
      onkeydown={onKey}
    />
  </div>
  <div class="tp__list" role="listbox" aria-label={t('picker.aria', locale)}>
    {#if flat.length === 0}
      <p class="tp__empty">{t('picker.no_match', locale)}</p>
    {/if}
    {#each groups as g, gi (g.key)}
      <p class="tp__group">{g.header}</p>
      {#each g.rows as r, i (r.kind + r.id)}
        {@const idx = offsets[gi] + i}
        <button
          type="button"
          class="tp__row"
          class:tp__row--on={idx === cur}
          role="option"
          aria-selected={idx === cur}
          onmouseenter={() => (cur = idx)}
          onclick={() => choose(r)}
        >
          {#if isGlyph(r.kind)}
            <ScopeGlyph
              kind={r.kind as 'space' | 'project' | 'line'}
              accent={r.accent ?? 'var(--text-faint)'}
              lineKind={r.lineKind ?? ''}
            />
          {:else}
            <span class="tp__leaf" aria-hidden="true"></span>
          {/if}
          <span class="tp__kind">{kindLabel(r)}</span>
          <span class="tp__name"
            >{r.name}{#if r.path}<span class="tp__path"> · {r.path}</span>{/if}</span
          >
        </button>
      {/each}
    {/each}
  </div>
</div>

<style>
  @layer components {
    .tp {
      position: absolute;
      inset-block-start: calc(100% + var(--space-2xs));
      inset-inline-start: 0;
      z-index: var(--z-dropdown, 50);
      inline-size: min(22rem, 90vw);
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
    .tp__list {
      max-block-size: 42vh;
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
      inline-size: 100%;
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
    .tp__row--on {
      background: var(--bg-light);
    }
    .tp__leaf {
      flex: none;
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--text-faint);
      /* the glyph column ScopeGlyph reserves is ~15px; center this dot in it */
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
    .tp__empty {
      margin: 0;
      padding: var(--space-m);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-muted);
    }
  }
</style>
