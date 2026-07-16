<script lang="ts">
  /*
    Hour — Views · Scope v2 (design preview).

    Faithful port of the "Hour Views - Scope v2.html" design: one scoped set of
    lines seen through VIEW AS (Desk · Calendar · Contacts · Money), scope built
    from saved scopes + recents (sidebar) and the ⌘K palette (browse the
    space→project→line tree, type-to-scope, stage tokens, apply as a combined
    scope). Fixture data (data.ts) — not wired to Supabase; the point is the nav.

    Idiomatic Svelte 5: runes + declarative markup (no innerHTML string
    building). Colours consume the design-system tokens so light + dark both
    hold (ADR-059), via local alias vars on the .scope-v2 wrapper.
  */
  import { tick } from 'svelte';
  import {
    SP,
    SPORDER,
    PROJ,
    LINE,
    TASKS,
    DAYS,
    NUMS,
    INITIAL_SAVED,
    INITIAL_RECENT,
    eur,
    dayLabel,
    initials,
    tokParts,
    accentFor,
    labelFor,
    tokMatch,
    facetCount,
    scopeCount,
    sameSet,
    type SavedScope,
    type Scope,
    type SpaceId,
    type Task,
  } from './data';

  type Lens = 'timeline' | 'calendar' | 'people' | 'money';
  interface PalRow {
    tok: string;
    kind: 'space' | 'project' | 'line';
    name: string;
    path: string;
    drill: string | null;
  }

  const LENSES: { id: Lens; label: string }[] = [
    { id: 'timeline', label: 'Desk' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'people', label: 'Contacts' },
    { id: 'money', label: 'Money' },
  ];

  const STATUS_COLOR: Record<'confirmed' | 'hold' | 'pending', string> = {
    confirmed: 'var(--success)',
    hold: 'var(--warning)',
    pending: 'var(--ink-3)',
  };

  // ── scope + lens state ──
  let tokens = $state<string[]>([]);
  let lens = $state<Lens>('timeline');
  let saved = $state<SavedScope[]>([...INITIAL_SAVED]);
  let recent = $state<Scope[]>([...INITIAL_RECENT]);

  const activeSavedId = $derived(
    saved.find((s) => sameSet(s.tokens, tokens))?.id ?? null,
  );

  const workingSet = $derived(
    tokens.length === 0
      ? TASKS
      : TASKS.filter((task) => tokens.some((t) => tokMatch(t, task))),
  );

  const summary = $derived.by(() => {
    const spaces = new Set(workingSet.map((t) => t.sp)).size;
    const desc =
      tokens.length === 0
        ? 'everything across your 3 spaces'
        : `${tokens.length} filter${tokens.length > 1 ? 's' : ''} · spanning ${spaces} space${spaces > 1 ? 's' : ''}`;
    return { count: workingSet.length, desc };
  });

  // ── view shaping ──
  const timelineGroups = $derived.by(() => {
    const byDay = new Map<number, Task[]>();
    for (const t of workingSet) {
      const list = byDay.get(t.day) ?? [];
      list.push(t);
      byDay.set(t.day, list);
    }
    return [...byDay.keys()]
      .sort((a, b) => a - b)
      .map((d) => ({ d, label: dayLabel(d), tasks: byDay.get(d)! }));
  });

  const calendarCols = $derived.by(() =>
    Array.from({ length: 7 }, (_, d) => ({
      d,
      evs: workingSet.filter((t) => t.day === d || (d === 0 && t.day < 0)),
    })),
  );

  const peopleCards = $derived.by(() => {
    const map = new Map<string, { role: string | null; sp: SpaceId; lines: Task[] }>();
    for (const t of workingSet) {
      if (!t.contact) continue;
      const entry = map.get(t.contact) ?? { role: t.role, sp: t.sp, lines: [] };
      entry.lines.push(t);
      map.set(t.contact, entry);
    }
    return [...map.entries()].map(([name, info]) => ({ name, ...info }));
  });

  const moneyData = $derived.by(() => {
    const withAmt = workingSet.filter((t) => t.amount);
    const kinds: { st: 'confirmed' | 'hold' | 'pending'; label: string; col: string }[] = [
      { st: 'confirmed', label: 'Confirmed', col: 'var(--success)' },
      { st: 'hold', label: 'On hold', col: 'var(--warning)' },
      { st: 'pending', label: 'Pending', col: 'var(--ink-3)' },
    ];
    const sum = (st: string) =>
      withAmt.filter((t) => t.status === st).reduce((a, t) => a + (t.amount ?? 0), 0);
    return {
      withAmt,
      groups: kinds.map((k) => ({
        ...k,
        total: sum(k.st),
        rows: withAmt.filter((t) => t.status === k.st),
      })),
    };
  });

  // ── sidebar glyph helpers ──
  function stackAccents(toks: string[]): string[] {
    return [...new Set(toks.map(accentFor))].slice(0, 3);
  }

  // ── scope actions ──
  function setScope(next: string[]) {
    tokens = [...next];
  }
  function removeToken(tok: string) {
    tokens = tokens.filter((t) => t !== tok);
  }
  function saveScope() {
    if (tokens.length === 0) return;
    const nm =
      tokens.map(labelFor).slice(0, 2).join(' + ') +
      (tokens.length > 2 ? ` +${tokens.length - 2}` : '');
    saved = [...saved, { id: 's' + Date.now(), name: nm, tokens: [...tokens] }];
  }

  // ══ command palette ══
  let palOpen = $state(false);
  let palQ = $state('');
  let palDrill = $state<string | null>(null);
  let staged = $state<string[]>([]);
  let cur = $state(0);
  let palInputEl = $state<HTMLInputElement | null>(null);

  const palResults = $derived.by<PalRow[]>(() => {
    const q = palQ.trim().toLowerCase();
    const rows: PalRow[] = [];
    if (q) {
      for (const id of SPORDER)
        if (SP[id].name.toLowerCase().includes(q))
          rows.push({ tok: `space:${id}`, kind: 'space', name: SP[id].name, path: '', drill: null });
      for (const [id, p] of Object.entries(PROJ))
        if (p.name.toLowerCase().includes(q))
          rows.push({ tok: `project:${id}`, kind: 'project', name: p.name, path: SP[p.sp].name, drill: null });
      for (const [id, l] of Object.entries(LINE))
        if (l.name.toLowerCase().includes(q))
          rows.push({ tok: `line:${id}`, kind: 'line', name: l.name, path: PROJ[l.proj].name, drill: null });
      // contact match → suggest the projects they appear in
      const cprojs = new Set<string>();
      for (const t of TASKS) if (t.contact && t.contact.toLowerCase().includes(q)) cprojs.add(t.proj);
      for (const id of cprojs)
        if (!rows.some((r) => r.tok === `project:${id}`))
          rows.push({
            tok: `project:${id}`,
            kind: 'project',
            name: PROJ[id].name,
            path: `${SP[PROJ[id].sp].name} · matches contact`,
            drill: null,
          });
    } else if (palDrill === null) {
      for (const id of SPORDER)
        rows.push({ tok: `space:${id}`, kind: 'space', name: SP[id].name, path: '', drill: `space:${id}` });
    } else {
      const [ty, id] = tokParts(palDrill);
      if (ty === 'space')
        for (const [pid, p] of Object.entries(PROJ))
          if (p.sp === id)
            rows.push({ tok: `project:${pid}`, kind: 'project', name: p.name, path: '', drill: `project:${pid}` });
      else
        for (const [lid, l] of Object.entries(LINE))
          if (l.proj === id)
            rows.push({ tok: `line:${lid}`, kind: 'line', name: l.name, path: '', drill: null });
    }
    return rows;
  });

  async function openPalette() {
    palOpen = true;
    palQ = '';
    palDrill = null;
    staged = [...tokens];
    cur = 0;
    await tick();
    palInputEl?.focus();
  }
  function closePalette() {
    palOpen = false;
  }
  function goHome() {
    palDrill = null;
    palQ = '';
    cur = 0;
  }
  function drillTo(target: string) {
    palDrill = target;
    palQ = '';
    cur = 0;
  }
  function toggleStage(tok: string) {
    staged = staged.includes(tok) ? staged.filter((t) => t !== tok) : [...staged, tok];
  }
  function applyStaged() {
    const toks = [...staged];
    if (
      toks.length &&
      !recent.some((r) => sameSet(r.tokens, toks)) &&
      !saved.some((s) => sameSet(s.tokens, toks))
    ) {
      const nm =
        toks.length === 1
          ? labelFor(toks[0])
          : toks.map(labelFor).slice(0, 2).join(' + ') + (toks.length > 2 ? ` +${toks.length - 2}` : '');
      recent = [{ name: nm, tokens: toks }, ...recent].slice(0, 4);
    }
    setScope(toks);
    closePalette();
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palOpen ? closePalette() : openPalette();
      return;
    }
    if (!palOpen) return;
    if (e.key === 'Escape') {
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = Math.min(palResults.length - 1, cur + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, cur - 1);
    } else if (e.key === 'ArrowRight') {
      const r = palResults[cur];
      if (r?.drill) {
        e.preventDefault();
        drillTo(r.drill);
      }
    } else if (e.key === ' ') {
      const r = palResults[cur];
      if (r) {
        e.preventDefault();
        toggleStage(r.tok);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      applyStaged();
    }
  }
</script>

<svelte:head><title>Hour — Views · Scope v2</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<div class="scope-v2">
  <header class="top">
    <span class="brand">hour</span>
    <button class="search" onclick={openPalette}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <span>Search, or type to scope by space / project / line…</span>
      <span class="kbd">⌘K</span>
    </button>
    <div class="tr">
      <span class="online"><i></i>1 online</span>
      <span class="avatar">M</span>
    </div>
  </header>

  <div class="shell">
    <aside class="side">
      <div>
        <div class="ssec__h"><span>Scopes</span></div>
        <div>
          {#each saved as s (s.id)}
            <button class="srow {s.id === 'every' ? 'every' : ''} {activeSavedId === s.id ? 'on' : ''}" onclick={() => setScope(s.tokens)}>
              {#if s.id === 'every'}
                <span class="sglyph">∑</span>
              {:else if s.tokens.length === 1}
                <span class="sglyph" style="background:{accentFor(s.tokens[0])}">{labelFor(s.tokens[0])[0]}</span>
              {:else}
                <span class="sglyph sglyph--stack"><span class="stack">{#each stackAccents(s.tokens) as a}<i style="background:{a}"></i>{/each}</span></span>
              {/if}
              <span class="sn">{s.name}</span>
              <span class="sc">{scopeCount(s.tokens)}</span>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <div class="ssec__h"><span>Recent</span></div>
        <div>
          {#each recent as r, i (r.name + i)}
            <button class="srow" onclick={() => setScope(r.tokens)}>
              <span class="sglyph sglyph--stack">
                {#if stackAccents(r.tokens).length}
                  <span class="stack">{#each stackAccents(r.tokens) as a}<i style="background:{a}"></i>{/each}</span>
                {:else}∑{/if}
              </span>
              <span class="sn">{r.name}</span>
              <span class="sc">{scopeCount(r.tokens)}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="side-foot">
        <button class="side-add" onclick={openPalette}>⌘K · browse &amp; combine all</button>
      </div>
    </aside>

    <main class="main">
      <div class="col">
        <!-- scope bar -->
        <div class="scopebar">
          <span class="scope-lead">Scope</span>
          {#if tokens.length === 0}
            <span class="scope-all">Everything · all spaces &amp; projects</span>
            <button class="scope-addbtn" onclick={openPalette}>+ narrow</button>
          {:else}
            {#each tokens as t (t)}
              {@const [ty] = tokParts(t)}
              <span class="tok {ty}">
                <span class="tdot" style="background:{accentFor(t)}"></span>
                <span class="tkind">{ty}</span>{labelFor(t)}
                <button class="tx" onclick={() => removeToken(t)} aria-label="Remove {labelFor(t)}">×</button>
              </span>
            {/each}
            <button class="scope-addbtn" onclick={openPalette}>+ add</button>
            <span class="scope-right">
              <button class="scope-save" onclick={saveScope}>☆ Save scope</button>
              <button class="scope-clear" onclick={() => setScope([])}>Clear</button>
            </span>
          {/if}
        </div>

        <!-- stage header -->
        <div class="stagehead">
          <div class="summ">
            <div class="scount">{summary.count} line{summary.count !== 1 ? 's' : ''}</div>
            <div class="sm">{summary.desc}</div>
          </div>
          <div class="lens">
            <span class="lens-lead">view as</span>
            <div class="lens-seg">
              {#each LENSES as l}
                <button class={l.id === lens ? 'on' : ''} onclick={() => (lens = l.id)}>{l.label}</button>
              {/each}
            </div>
          </div>
        </div>

        <!-- stage -->
        <div class="stage">
          {#if lens === 'timeline'}
            {#if !workingSet.length}
              <div class="empty">No lines in this scope.</div>
            {:else}
              {#each timelineGroups as g (g.d)}
                <div class="dayhead {g.d < 0 ? 'over' : ''}">
                  <span class="dl">{g.label[0]}</span>
                  {#if g.label[1]}<span class="df">{g.label[1]}</span>{/if}
                </div>
                {#each g.tasks as t}
                  <div class="lrow">
                    <span class="ltime">{t.time || '—'}</span>
                    <span class="lverb">{t.verb}</span>
                    <span class="lsubj">{t.org}{#if t.contact}<span class="lc"> · {t.contact}</span>{/if}</span>
                    <span class="lright">
                      {#if t.amount}<span class="lamt">{eur(t.amount)}</span>{/if}
                      <span class="prov"><span class="dot" style="background:{SP[t.sp].accent}"></span>{PROJ[t.proj].name}<span class="pl">{LINE[t.line].name}</span></span>
                    </span>
                  </div>
                {/each}
              {/each}
            {/if}
          {:else if lens === 'calendar'}
            <div class="week">
              {#each calendarCols as c (c.d)}
                <div class="wcol {c.d === 0 ? 'today' : ''}">
                  <div class="whead"><span class="wd">{DAYS[c.d]}</span><span class="wn">{NUMS[c.d]}</span></div>
                  {#if c.evs.length}
                    {#each c.evs as t}
                      {@const a = SP[t.sp].accent}
                      <div class="ev" style="background:color-mix(in oklch, {a} 12%, var(--card)); border:1px solid color-mix(in oklch, {a} 35%, var(--card))">
                        <span class="evv" style="color:{a}">{t.verb}{t.time ? ' · ' + t.time : ''}</span>
                        <span class="evn">{t.org}</span>
                      </div>
                    {/each}
                  {:else}
                    <span class="wempty">—</span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if lens === 'people'}
            {#if !peopleCards.length}
              <div class="empty">No contacts in this scope.</div>
            {:else}
              <div class="people">
                {#each peopleCards as p (p.name)}
                  {@const a = SP[p.sp].accent}
                  <div class="pcard">
                    <div class="pcard__top">
                      <span class="pav" style="background:{a}">{initials(p.name)}</span>
                      <span>
                        <div class="pcard__nm">{p.name}</div>
                        <div class="pcard__role">{p.role}</div>
                      </span>
                      <span class="pcard__cnt">{p.lines.length} open</span>
                    </div>
                    {#each p.lines as t}
                      <div class="pline">
                        <span class="pv">{t.verb}</span>
                        <span>{t.org} · <span class="pline__proj">{PROJ[t.proj].name}</span></span>
                        {#if t.amount}<span class="pa">{eur(t.amount)}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          {:else if lens === 'money'}
            {#if !moneyData.withAmt.length}
              <div class="empty">No fees in this scope.</div>
            {:else}
              <div class="mtot">
                {#each moneyData.groups as g (g.st)}
                  <div class="mt">
                    <div class="ml"><span class="dot" style="background:{g.col}"></span>{g.label}</div>
                    <div class="mv">{eur(g.total)}</div>
                  </div>
                {/each}
              </div>
              {#each moneyData.groups as g (g.st)}
                {#if g.rows.length}
                  <div class="mgrouphead">{g.label} · {eur(g.total)}</div>
                  {#each g.rows as x}
                    <div class="mrow">
                      <span class="mn">{x.org} <span class="ms">· {PROJ[x.proj].name}{x.contact ? ' · ' + x.contact : ''}</span></span>
                      <span class="mstate" style="color:{g.col}; background:color-mix(in oklch, {g.col} 14%, var(--card))">{g.label}</span>
                      <span class="mamt">{eur(x.amount ?? 0)}</span>
                    </div>
                  {/each}
                {/if}
              {/each}
            {/if}
          {/if}
        </div>
      </div>
    </main>
  </div>

  <!-- command palette -->
  <div class="scrim {palOpen ? 'open' : ''}" onclick={(e) => { if (e.target === e.currentTarget) closePalette(); }} role="presentation">
    <div class="pal">
      <div class="pal__in">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          bind:this={palInputEl}
          bind:value={palQ}
          oninput={() => { palDrill = null; cur = 0; }}
          placeholder="Filter spaces, projects, lines… (try “gira”, “muk”, “anna”)"
          autocomplete="off"
        />
        <span class="pal__hint">esc to close</span>
      </div>

      <div class="pal__body">
        <div class="pal__grouph">
          {#if palQ}
            <button class="pal__crumb" onclick={goHome}>All</button> › <span>results for “{palQ}”</span>
          {:else if palDrill === null}
            Spaces
          {:else}
            {@const [ty, id] = tokParts(palDrill)}
            {#if ty === 'space'}
              <button class="pal__crumb" onclick={goHome}>Spaces</button> › {SP[id as SpaceId].name}
            {:else}
              <button class="pal__crumb" onclick={goHome}>Spaces</button> ›
              <button class="pal__crumb" onclick={() => drillTo('space:' + PROJ[id].sp)}>{SP[PROJ[id].sp].name}</button> › {PROJ[id].name}
            {/if}
          {/if}
        </div>

        {#if palResults.length}
          {#each palResults as r, i (r.tok + i)}
            <div class="presult {r.kind} {i === cur ? 'cur' : ''}">
              <button class="presult__main" onclick={() => toggleStage(r.tok)} onmouseenter={() => (cur = i)}>
                <span class="rdot" style="background:{accentFor(r.tok)}"></span>
                <span class="rkind">{r.kind}</span>
                <span class="rn">{r.name}{#if r.path}<span class="rpath"> · {r.path}</span>{/if}</span>
                <span class="rc">{facetCount(r.tok)}</span>
                {#if staged.includes(r.tok)}<span class="rin">✓ added</span>{/if}
              </button>
              {#if r.drill}
                <button class="rchev" onclick={() => drillTo(r.drill!)} aria-label="Drill into {r.name}">›</button>
              {/if}
            </div>
          {/each}
        {:else}
          <div class="empty pal__empty">No matches.</div>
        {/if}
      </div>

      <div class="pal__staged">
        <span class="lead">Building</span>
        {#if staged.length === 0}
          <span class="scope-all pal__staged-all">Everything (no filters)</span>
          <button class="apply" onclick={applyStaged}>Apply</button>
        {:else}
          {#each staged as t (t)}
            <span class="tok {tokParts(t)[0]}">
              <span class="tdot" style="background:{accentFor(t)}"></span>{labelFor(t)}
              <button class="tx" onclick={() => toggleStage(t)} aria-label="Unstage {labelFor(t)}">×</button>
            </span>
          {/each}
          <button class="apply" onclick={applyStaged}>Apply {staged.length} filter{staged.length > 1 ? 's' : ''}</button>
        {/if}
      </div>

      <div class="pal__foot">
        <span><span class="k">↑↓</span> move</span>
        <span><span class="k">→</span> drill in</span>
        <span><span class="k">space</span> add / remove</span>
        <span><span class="k">↵</span> apply</span>
      </div>
    </div>
  </div>
</div>

<style>
  /* Local alias contract: the prototype's ad-hoc colours mapped onto the
     design-system tokens (tokens.css), so this page is theme-aware. The
     wrapper declares, children consume (philosophy §3). */
  .scope-v2 {
    --card: var(--bg-ultra-light);
    --panel: var(--bg-light);
    --ink: var(--text-color);
    --ink-2: var(--text-muted);
    --ink-3: var(--text-faint);
    --ink-4: var(--neutral-light);
    --line: var(--border-color-light);
    --line-2: var(--border-color-dark);
    --red: var(--danger);
    --verb: color-mix(in oklch, var(--accent-2), black 15%);
    --dark: var(--text-color);
    --dark-fg: var(--bg);
    --green: var(--success);
    --amber: var(--warning);
    --serif: var(--font-display);
    --sans: var(--font-sans);
    --mono: var(--font-mono);

    min-block-size: 100vh;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
  }

  .top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 16px 30px;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-family: var(--serif);
    font-style: italic;
    font-size: 22px;
  }
  .search {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 9px;
    width: 380px;
    background: var(--card);
    border: 1px solid var(--line-2);
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 13px;
    color: var(--ink-3);
    cursor: text;
    font-family: inherit;
  }
  .search svg {
    width: 14px;
    height: 14px;
    opacity: 0.5;
  }
  .search .kbd {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-4);
  }
  .tr {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .online {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .online i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--dark);
    color: var(--dark-fg);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 600;
  }

  .shell {
    display: flex;
    align-items: flex-start;
  }

  /* ── sidebar : saved scopes + recents (NOT the full hierarchy) ── */
  .side {
    position: sticky;
    top: 0;
    align-self: flex-start;
    width: 250px;
    min-height: calc(100vh - 62px);
    border-right: 1px solid var(--line);
    padding: 22px 16px;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .ssec__h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    margin: 0 4px 8px;
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: 8px 9px;
    border-radius: 8px;
    font-family: var(--sans);
    font-size: 13.5px;
    color: var(--ink-2);
    transition: 0.11s;
  }
  .srow:hover {
    background: color-mix(in oklch, var(--ink) 5%, transparent);
  }
  .srow.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: 0 0 0 1px var(--line-2);
  }
  .srow .sglyph {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    flex: none;
    display: grid;
    place-items: center;
    font-family: var(--serif);
    font-size: 13px;
    color: #fff;
  }
  .srow.every .sglyph {
    background: var(--dark);
    color: var(--dark-fg);
    font-family: var(--sans);
  }
  .sglyph--stack {
    background: transparent;
    box-shadow: none;
    color: var(--ink-4);
  }
  .srow .stack {
    display: flex;
  }
  .srow .stack i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-left: -3px;
    box-shadow: 0 0 0 2px var(--panel);
  }
  .srow.on .stack i {
    box-shadow: 0 0 0 2px var(--card);
  }
  .srow .sn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .srow .sc {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .side-add {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    background: transparent;
    border: 1px dashed var(--line-2);
    cursor: pointer;
    padding: 9px;
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ink-3);
    transition: 0.11s;
  }
  .side-add:hover {
    color: var(--ink);
    border-color: var(--ink-3);
  }
  .side-foot {
    margin-top: auto;
  }

  .main {
    flex: 1;
    min-width: 0;
  }
  .col {
    max-width: 820px;
    margin: 0 auto;
    padding: 26px 40px 70px;
  }

  /* ── scope bar ── */
  .scopebar {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
    padding: 11px 13px;
    background: var(--card);
    border: 1px solid var(--line-2);
    border-radius: 12px;
    min-height: 52px;
  }
  .scope-lead {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-4);
    margin-right: 2px;
  }
  .tok {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 6px 8px 6px 11px;
    font-size: 12.5px;
    border: 1px solid var(--line-2);
    background: var(--panel);
  }
  .tok .tkind {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-4);
  }
  .tok .tdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .tok.line .tdot {
    border-radius: 2px;
  }
  .tok .tx {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: var(--ink-3);
    cursor: pointer;
    font-size: 13px;
    background: transparent;
    border: 0;
  }
  .tok .tx:hover {
    background: color-mix(in oklch, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .scope-all {
    font-size: 13.5px;
    color: var(--ink-3);
    font-style: italic;
    font-family: var(--serif);
  }
  .scope-addbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-3);
    border: 1px dashed var(--line-2);
    border-radius: 999px;
    padding: 6px 12px;
    cursor: pointer;
    background: transparent;
  }
  .scope-addbtn:hover {
    color: var(--ink);
    border-color: var(--ink-3);
  }
  .scope-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .scope-save {
    font-family: var(--sans);
    font-size: 12px;
    color: var(--ink-3);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: 0;
  }
  .scope-save:hover {
    color: var(--ink);
  }
  .scope-clear {
    font-family: var(--sans);
    font-size: 12px;
    color: var(--ink-3);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    background: transparent;
    border: 0;
  }

  /* ── stage header ── */
  .stagehead {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    margin: 24px 0 4px;
  }
  .summ .scount {
    font-family: var(--serif);
    font-size: 26px;
    line-height: 1;
  }
  .summ .sm {
    font-size: 12.5px;
    color: var(--ink-3);
    margin-top: 6px;
  }
  .lens {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lens-lead {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-4);
  }
  .lens-seg {
    display: flex;
    background: var(--card);
    border: 1px solid var(--line-2);
    border-radius: 999px;
    padding: 2px;
  }
  .lens-seg button {
    appearance: none;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--sans);
    font-size: 12px;
    color: var(--ink-3);
    padding: 5px 12px;
    border-radius: 999px;
    transition: 0.12s;
  }
  .lens-seg button:hover {
    color: var(--ink-2);
  }
  .lens-seg button.on {
    background: var(--dark);
    color: var(--dark-fg);
  }
  .stage {
    margin-top: 20px;
  }

  /* ── TIMELINE ── */
  .dayhead {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 20px 0 6px;
  }
  .dayhead .dl {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .dayhead .df {
    font-family: var(--serif);
    font-style: italic;
    font-size: 13px;
    color: var(--ink-4);
  }
  .dayhead.over .dl {
    color: var(--red);
  }
  .lrow {
    display: grid;
    grid-template-columns: 54px 66px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--line);
  }
  .lrow .ltime {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-3);
  }
  .lrow .lverb {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--verb);
  }
  .lrow .lsubj {
    font-size: 14.5px;
  }
  .lrow .lsubj .lc {
    color: var(--ink-3);
    font-size: 13px;
  }
  .lrow .lright {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .lrow .lamt {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-2);
  }
  .prov {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .prov .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .prov .pl {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-4);
  }

  /* ── CALENDAR ── */
  .week {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
  }
  .wcol {
    min-height: 200px;
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 9px 8px;
    background: var(--card);
  }
  .wcol.today {
    border-color: var(--ink-3);
    box-shadow: 0 0 0 1px var(--ink-3) inset;
  }
  .whead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .whead .wd {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .whead .wn {
    font-family: var(--serif);
    font-size: 16px;
  }
  .ev {
    border-radius: 7px;
    padding: 7px 8px;
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 1.3;
    cursor: pointer;
  }
  .ev .evv {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    display: block;
    margin-bottom: 2px;
    opacity: 0.85;
  }
  .ev .evn {
    display: block;
  }
  .wempty {
    font-family: var(--serif);
    font-style: italic;
    font-size: 12px;
    color: var(--ink-4);
  }

  /* ── CONTACTS ── */
  .people {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .pcard {
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--card);
    padding: 16px 17px 12px;
  }
  .pcard__top {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 12px;
  }
  .pav {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--serif);
    font-size: 15px;
    color: #fff;
  }
  .pcard__nm {
    font-size: 15px;
    font-weight: 500;
  }
  .pcard__role {
    font-size: 12px;
    color: var(--ink-3);
  }
  .pcard__cnt {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .pline {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--line);
    font-size: 13.5px;
  }
  .pline .pv {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--verb);
    width: 52px;
  }
  .pline__proj {
    color: var(--ink-3);
  }
  .pline .pa {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-3);
  }

  /* ── MONEY ── */
  .mtot {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 22px;
  }
  .mtot .mt {
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--card);
    padding: 16px 17px;
  }
  .mtot .mt .ml {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .mtot .mt .ml .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .mtot .mt .mv {
    font-family: var(--serif);
    font-size: 30px;
    margin-top: 8px;
  }
  .mgrouphead {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 20px 0 4px;
  }
  .mrow {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 16px;
    padding: 11px 0;
    border-top: 1px solid var(--line);
  }
  .mrow .mn {
    font-size: 14.5px;
  }
  .mrow .mn .ms {
    color: var(--ink-3);
    font-size: 12.5px;
  }
  .mrow .mstate {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 5px;
  }
  .mrow .mamt {
    font-family: var(--mono);
    font-size: 13.5px;
  }

  .empty {
    font-family: var(--serif);
    font-style: italic;
    font-size: 15px;
    color: var(--ink-4);
    padding: 40px 0;
    text-align: center;
  }

  /* ── command palette (⌘K) ── */
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in oklch, var(--neutral-ultra-dark) 34%, transparent);
    backdrop-filter: blur(2px);
    display: none;
    z-index: var(--z-modal);
  }
  .scrim.open {
    display: block;
  }
  .pal {
    position: absolute;
    top: 88px;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    max-width: calc(100vw - 40px);
    background: var(--card);
    border: 1px solid var(--line-2);
    border-radius: 14px;
    box-shadow: var(--box-shadow-3);
    overflow: hidden;
  }
  .pal__in {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 17px;
    border-bottom: 1px solid var(--line);
  }
  .pal__in svg {
    width: 16px;
    height: 16px;
    opacity: 0.5;
  }
  .pal__in input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    font-family: var(--sans);
    font-size: 15px;
    color: var(--ink);
    padding: 0;
    inline-size: auto;
  }
  .pal__in input::placeholder {
    color: var(--ink-4);
  }
  .pal__hint {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-4);
  }
  .pal__body {
    max-height: 52vh;
    overflow: auto;
    padding: 8px;
  }
  .pal__grouph {
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink-4);
    padding: 10px 10px 5px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pal__crumb {
    color: var(--ink-3);
    cursor: pointer;
    background: transparent;
    border: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    padding: 0;
  }
  .pal__crumb:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .presult {
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  .presult:hover,
  .presult.cur {
    background: color-mix(in oklch, var(--ink) 6%, transparent);
  }
  .presult__main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 10px;
    background: transparent;
    border: 0;
    cursor: pointer;
    font: inherit;
    text-align: left;
    color: inherit;
  }
  .presult .rdot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .presult.line .rdot {
    border-radius: 2px;
    width: 8px;
    height: 8px;
  }
  .presult .rkind {
    font-family: var(--mono);
    font-size: 8.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-4);
    width: 52px;
    flex: none;
  }
  .presult .rn {
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .presult .rpath {
    color: var(--ink-4);
    font-size: 12px;
  }
  .presult .rc {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .presult .rchev {
    margin-left: 8px;
    margin-right: 6px;
    color: var(--ink-4);
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 5px;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .presult .rchev:hover {
    background: color-mix(in oklch, var(--ink) 10%, transparent);
    color: var(--ink);
  }
  .presult .rin {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--green);
  }
  .pal__empty {
    padding: 24px;
  }
  .pal__foot {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 16px;
    border-top: 1px solid var(--line);
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .pal__foot .k {
    color: var(--ink-3);
  }
  .pal__staged {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    padding: 11px 14px;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
  .pal__staged .lead {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-4);
  }
  .pal__staged-all {
    font-size: 12.5px;
  }
  .pal__staged .apply {
    margin-left: auto;
    background: var(--dark);
    color: var(--dark-fg);
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    font-family: var(--sans);
    font-size: 12.5px;
    cursor: pointer;
  }
</style>
