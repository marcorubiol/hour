<script lang="ts">
  /**
   * ⌘K — scope builder (Scope v2). Browse the space → project → line tree
   * (→ drills in), or type to filter across all FOUR axes at once — the three
   * containers plus people, who are not a level of that tree but can be
   * narrowed by all the same; stage tokens into a "building" set and Apply
   * them as the active scope (pins). This
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
  import { toStore } from 'svelte/store';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
    teamQueryOptions,
  } from '$lib/nav-queries';
  import {
    buildLineIndex,
    buildProjectIndex,
    projectUrl,
    lineUrl,
    type NavWorkspace,
  } from '$lib/nav';
  import { parsePin, personPin } from '$lib/stores/pins.svelte';
  import { parseDayQuery } from '$lib/day-query';
  import { dayKeyInTz } from '$lib/planner';
  import { localeDayMonth } from '$lib/datetime';
  import { detectLocale } from '$lib/i18n';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { lineKindLabel } from '$lib/utils/line-kind';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';

  // El mismo par que usa el Planner: el locale detectado y su etiqueta BCP-47.
  const localeTag = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }[detectLocale(navigator.language)];
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  /** Hoy, en el huso del lector. `parseDayQuery` es puro y lo exige inyectado. */
  let todayIso = $derived(dayKeyInTz(new Date().toISOString(), viewerTz));

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

  /**
   * The team — the fourth thing you can narrow by, and the only one that is
   * not a container. On the key the planner and the blackout dialog already
   * share, so it is usually warm before you ever open this.
   *
   * It is the TEAM (cast ∪ crew), never the contact book: a workspace's
   * person table holds hundreds of programmers who are not "us", and putting
   * them in this list would bury the eight people who carry the work.
   *
   * NOT gated on `open`, and that was a real bug rather than a preference:
   * gating it meant the fetch STARTED when the palette opened, and this is a
   * surface you open and type into inside a second. The People group only
   * renders when it has rows, so an unresolved fetch looked exactly like a
   * workspace with nobody in it — the search appeared broken. It loads with
   * the other three nav queries now, and while it is in flight the group says
   * so (below) instead of being absent.
   */
  const teamStore = toStore(() => teamQueryOptions(workspaces.map((w) => w.id)));
  const teamQuery = createQuery(teamStore);

  type PersonEntry = {
    person_id: string;
    full_name: string;
    slug: string;
    workspaceSlug: string;
    workspaceName: string;
    projectIds: string[];
  };
  /** One entry per person even when they serve two workspaces: the identity is
   *  portable, so the first workspace wins the path and the projects merge. */
  let people = $derived.by<PersonEntry[]>(() => {
    const wsById = new Map(workspaces.map((w) => [w.id, w]));
    const byPerson = new Map<string, PersonEntry>();
    for (const item of $teamQuery.data?.items ?? []) {
      const ws = wsById.get(item.workspace_id);
      const found = byPerson.get(item.person_id);
      if (found) {
        for (const id of item.project_ids ?? []) {
          if (!found.projectIds.includes(id)) found.projectIds.push(id);
        }
        continue;
      }
      byPerson.set(item.person_id, {
        person_id: item.person_id,
        full_name: item.full_name,
        slug: item.slug,
        workspaceSlug: ws?.slug ?? '',
        workspaceName: ws?.name ?? '',
        projectIds: [...(item.project_ids ?? [])],
      });
    }
    return [...byPerson.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  });

  let query = $state('');
  /** null = top-level (spaces); `s:<slug>` = that space's projects;
      `p:<id>` = that project's lines. */
  let drill = $state<string | null>(null);
  let staged = $state<string[]>([]);
  let cur = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  /**
   * `day` NO ES UN CONTENEDOR, y por eso va el último y no se puede fijar.
   * Los otros cuatro son cosas que existen y se pueden apilar en el scope; un
   * día es un DESTINO. Comparte la lista porque comparte el gesto —escribes y
   * te lleva— y porque el ⌘K ya es la única puerta de navegación que esta app
   * tiene: inventarle otra ventana para escribir una fecha sería la segunda.
   */
  type Kind = 'space' | 'project' | 'line' | 'person' | 'day';
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
    /** Shown INSTEAD of rows when a group has none but still has something
     *  true to say — "still loading" is not the same fact as "nobody". */
    note?: string;
  }

  function labelFor(token: string): string {
    const { kind, key } = parsePin(token);
    // Chokepoint: this label is the staged chip AND its "Unstage …" aria-label.
    if (kind === 'space') return spaceName(workspaces.find((w) => w.slug === key)?.name ?? key);
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.name ?? 'project';
    if (kind === 'person')
      return people.find((p) => p.person_id === key)?.full_name ?? 'person';
    return lineIndex.find((l) => l.id === key)?.name ?? 'line';
  }
  function accentFor(token: string): string {
    const { kind, key } = parsePin(token);
    if (kind === 'space') {
      const w = workspaces.find((x) => x.slug === key);
      return w ? accentVarFor(w) : 'var(--text-faint)';
    }
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.accent ?? 'var(--text-faint)';
    // Hue is project identity: a person is drawn in ink (ScopeGlyph ignores
    // this value for `person`, and the staged chip stays honest too).
    if (kind === 'person') return 'var(--text-faint)';
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
  /** Lowercased and stripped of diacritics \u2014 "Vill\u00e9" \u2192 "ville". */
  function fold(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  function hintWord(name: string): string {
    return fold(name).match(/[a-z0-9]{2,}/)?.[0] ?? '';
  }
  let examples = $derived(
    [workspaces[0]?.name, projectIndex[0]?.name, lineIndex[0]?.name]
      .filter((n): n is string => !!n)
      .map(hintWord)
      .filter(Boolean),
  );
  let placeholder = $derived(
    examples.length > 0
      ? `Filter spaces, projects, lines, people… (try ${examples.map((e) => `“${e}”`).join(', ')})`
      : 'Filter spaces, projects, lines, people…',
  );

  function spaceRow(w: NavWorkspace, canDrill: boolean): Row {
    // Chokepoint: `name` feeds both the row and its "Drill into …" aria-label.
    return { token: `s:${w.slug}`, kind: 'space', name: spaceName(w.name), path: '', drill: canDrill ? `s:${w.slug}` : null };
  }
  function projectRow(p: (typeof projectIndex)[number], canDrill: boolean, path: string): Row {
    return { token: `p:${p.id}`, kind: 'project', name: p.name, path, drill: canDrill ? `p:${p.id}` : null };
  }
  function lineRow(l: (typeof lineIndex)[number], path: string): Row {
    return { token: `l:${l.id}`, kind: 'line', name: l.name, path, drill: null, lineKind: l.kind };
  }
  /** A person never drills: they hold nothing to descend into. */
  function personRow(p: PersonEntry, path: string): Row {
    return { token: personPin(p.person_id), kind: 'person', name: p.full_name, path, drill: null };
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
        .map((p) => projectRow(p, false, spaceName(p.workspaceName)));
      const lines = lineIndex
        .filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.projectName.toLowerCase().includes(q) ||
            l.kind.includes(q),
        )
        .map((l) => lineRow(l, l.projectName));
      // Names are the one field where diacritics are unavoidable and nobody
      // types them: "ville" has to find "Anouk Villé". The other three match
      // on slugs and kinds, which are already ASCII, so only people normalise.
      const nq = fold(q);
      // Una fecha escrita es un destino, y solo aparece si se puede leer
      // ENTERA: `parseDayQuery` devuelve el día o nada, nunca una aproximación.
      const parsedDay = parseDayQuery(q, { today: todayIso, locales: [localeTag, 'es', 'ca', 'en'] });
      const dayRows: Row[] = parsedDay
        ? [
            {
              token: `d:${parsedDay}`,
              kind: 'day',
              name: localeDayMonth(parsedDay, localeTag),
              path: parsedDay,
              // No se fija: un día no es un contenedor (ver `Kind`).
              drill: null,
            },
          ]
        : [];
      const persons = people
        .filter((p) => fold(p.full_name).includes(nq) || p.slug.includes(q))
        .map((p) => personRow(p, spaceName(p.workspaceName)));
      // An empty People group has three different meanings and they must not
      // look alike: still fetching · the feed could not be read · nobody
      // matches. Only the last one is silence.
      const peopleNote =
        persons.length > 0
          ? undefined
          : $teamQuery.isLoading
            ? 'Looking up the team…'
            : $teamQuery.data?.absent
              ? 'The team feed is unavailable right now'
              : people.length === 0
                ? 'Nobody is on a cast or crew yet'
                : undefined;
      return (
        [
          { key: 'space', header: 'Spaces', rows: spaces },
          { key: 'project', header: 'Projects', rows: projects },
          { key: 'line', header: 'Working lines', rows: lines },
          // Last, because it is the axis that is not a level of the others.
          { key: 'person', header: 'People', rows: persons, note: peopleNote },
          { key: 'day', header: 'Day', rows: dayRows },
        ] as Group[]
      ).filter((g) => g.rows.length > 0 || g.note);
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
    // Inside a project: its lines, and who is on it. The people are here
    // because this is the one place that knows the project — `project_ids` on
    // the team feed is what makes "who is on this show" answerable without a
    // second request.
    return (
      [
        {
          key: 'line',
          header: 'Working lines',
          rows: lineIndex.filter((l) => l.projectId === key).map((l) => lineRow(l, '')),
        },
        {
          key: 'person',
          header: 'People',
          rows: people.filter((p) => p.projectIds.includes(key)).map((p) => personRow(p, '')),
        },
      ] as Group[]
    ).filter((g) => g.rows.length > 0);
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
    // Antes de `parsePin`: `d:` no es un pin y su gramática no lo conoce.
    if (r.kind === 'day') {
      void goto(`/h/planner?view=day&d=${r.path}`);
      open = false;
      return;
    }
    const { kind, key } = parsePin(r.token);
    if (kind === 'space') void goto(`/h/${key}/`);
    else if (kind === 'project') {
      const p = projectIndex.find((x) => x.id === key);
      if (p) void goto(projectUrl(p));
    } else if (kind === 'person') {
      // The dossier is per workspace, so the path needs one: the first
      // workspace this person was found in (see `people`).
      const p = people.find((x) => x.person_id === key);
      if (p?.workspaceSlug && p.slug) void goto(`/h/${p.workspaceSlug}/person/${p.slug}/`);
    } else {
      const l = lineIndex.find((x) => x.id === key);
      if (l) void goto(lineUrl(l));
    }
    open = false;
  }

  // Breadcrumb parts (label + optional up-target for the clickable crumbs).
  // `space: true` marks the one crumb that is a space name — it opts out of the
  // trail's uppercase (see .cmdk__crumb--space) so the norm is not fought by CSS.
  let crumb = $derived.by<{ label: string; up: string | null; here: boolean; space?: boolean }[]>(() => {
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
        { label: spaceName(w?.name ?? key), up: null, here: true, space: true },
      ];
    }
    const proj = projectIndex.find((p) => p.id === key);
    return [
      { label: 'All', up: '', here: false },
      {
        label: spaceName(proj?.workspaceName ?? ''),
        up: proj ? `s:${proj.workspaceSlug}` : '',
        here: false,
        space: true,
      },
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
          aria-label="Filter spaces, projects, lines and people"
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
              <span class:cmdk__crumb--space={c.space}>{c.label}</span>
            {:else if c.up === ''}
              <button type="button" class="cmdk__crumb-link" class:cmdk__crumb--space={c.space} onclick={goHome}>{c.label}</button>
            {:else if c.up}
              <button type="button" class="cmdk__crumb-link" class:cmdk__crumb--space={c.space} onclick={() => c.up && drillTo(c.up)}>{c.label}</button>
            {:else}
              <span class:cmdk__crumb--space={c.space}>{c.label}</span>
            {/if}
          {/each}
        </p>

        {#if flatRows.length === 0 && !groups.some((g) => g.note)}
          <p class="cmdk__empty">No match.</p>
        {/if}

        {#each groups as g, gIdx (g.key)}
          <p class="cmdk__group">{g.header}</p>
          {#if g.rows.length === 0 && g.note}
            <p class="cmdk__note">{g.note}</p>
          {/if}
          {#each g.rows as r, i (r.token)}
            {@const gi = groupOffsets[gIdx] + i}
            <div class="cmdk__row" class:cmdk__row--on={gi === cur} class:cmdk__row--staged={isStaged(r.token)}>
              <!-- UN DÍA NO SE FIJA, SE ABRE. La fila principal apila un
                   contenedor en el scope, y eso solo tiene sentido para algo
                   que existe y filtra. Un día es un destino: su fila entera
                   hace lo que hace el botón `open` de las demás, así que no
                   hay dos gestos donde solo hay uno. -->
              <button
                type="button"
                class="cmdk__main"
                role="option"
                aria-selected={gi === cur}
                onmouseenter={() => (cur = gi)}
                onclick={() => (r.kind === 'day' ? openRow(r) : toggleStage(r.token))}
              >
                {#if r.kind === 'day'}
                  <!-- No es `ScopeGlyph`: eso dibuja SCOPES, y un día no lo es
                       (ver `Kind`). Añadirle un caso sería estirar su
                       significado para un solo llamador. -->
                  <span class="cmdk__dayglyph" aria-hidden="true">◷</span>
                {:else}
                  <ScopeGlyph kind={r.kind} accent={accentFor(r.token)} lineKind={r.lineKind ?? ''} />
                {/if}
                <span class="cmdk__kind">{r.kind === 'line' ? lineKindLabel(r.lineKind ?? '') : r.kind}</span>
                <span class="cmdk__name">
                  {r.name}{#if r.path}<span class="cmdk__path"> · {r.path}</span>{/if}
                </span>
                {#if isStaged(r.token)}<span class="cmdk__added">✓ added</span>{/if}
              </button>
              {#if r.kind !== 'day'}
                <button type="button" class="cmdk__open" onclick={() => openRow(r)}>
                  open <span aria-hidden="true">↗</span>
                </button>
              {/if}
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
  /* El glifo del día: mismo hueco y mismo peso que `ScopeGlyph`, para que la
     fila no se descuadre; distinto símbolo, porque no es un scope. */
  .cmdk__dayglyph {
    display: inline-grid;
    place-items: center;
    inline-size: 1rem;
    block-size: 1rem;
    font-size: 0.8rem;
    color: var(--text-faint);
  }

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
  /* Only the space crumb drops the trail's uppercase — the rest keeps its caps
     and every crumb keeps the mono letter-spacing. */
  .cmdk__crumb--space {
    text-transform: none;
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
  /* A group with nothing to list but something to say. Quieter than a row
     and quieter than the global empty state: it is a status, not a result. */
  .cmdk__note {
    margin: 0;
    padding: var(--space-2xs) var(--space-m) var(--space-s);
    color: var(--text-faint);
    font-size: var(--text-xs);
    font-style: italic;
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
