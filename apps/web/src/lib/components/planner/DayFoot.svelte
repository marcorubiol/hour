<script module lang="ts">
  /** One upcoming thing, page-shaped: the page picks and labels them. */
  export type DayNextVM = {
    id: string;
    /** «19 jul» — the day it happens, already localized. */
    day: string;
    /** «show» / «show?» — certainty is in the word, geometry has no room here. */
    kind: string;
    name: string;
    city: string | null;
    country: string | null;
    project: {
      name: string;
      slug: string | null;
      initials?: string | null;
      accent?: string | null;
    } | null;
    href: string | null;
    held: boolean;
  };
</script>

<script lang="ts">
  /**
   * THE DAY'S FOOT — notes and next, one band, two columns (the design's
   * `.ag3day__marg`, risen from the right margin into the flow: notes get a
   * reading measure, next gets the narrow column).
   *
   * The lids fold, and A CLOSED LID STILL SAYS WHAT IT KEEPS («notes · 3»,
   * «next · 19 jul», «empty») — written law. Notes here are MY post-its
   * (ADR-093): always private, so the only word the writer needs is
   * `private` — before you write, the one thing to know is who will read
   * it. The team's signed notes are comms, and comms is not built.
   */
  import type { NoteEvent } from '$lib/month-events';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';

  interface Props {
    notes: NoteEvent[];
    /** Absent feed (pre-migration DB) ⇒ the writer is not drawn. */
    canWrite: boolean;
    onCreate: (body: string) => Promise<boolean>;
    onDelete: (id: string) => void;
    next: DayNextVM[];
    notesWord?: string;
    nextWord?: string;
    emptyWord?: string;
    privateWord?: string;
    placeholder?: string;
    deleteLabel?: string;
  }

  let {
    notes,
    canWrite,
    onCreate,
    onDelete,
    next,
    notesWord = 'notes',
    nextWord = 'next',
    emptyWord = 'empty',
    privateWord = 'private',
    placeholder = 'write it down…',
    deleteLabel = 'Delete note',
  }: Props = $props();

  let notesOpen = $state(true);
  let nextOpen = $state(true);
  let draft = $state('');
  let pending = $state(false);

  async function save() {
    const body = draft.trim();
    if (!body || pending) return;
    pending = true;
    const ok = await onCreate(body);
    pending = false;
    if (ok) draft = '';
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }
</script>

<div class="df">
  <section class="df__col df__col--notes">
    <!-- The lid: fold state + the count, one row, one button. -->
    <button type="button" class="df__lid" aria-expanded={notesOpen} onclick={() => (notesOpen = !notesOpen)}>
      <span class="df__lid-w">{notesWord}</span>
      <span class="df__lid-n">{notes.length === 0 ? emptyWord : notes.length} {notesOpen ? '−' : '+'}</span>
    </button>
    {#if notesOpen}
      {#if canWrite}
        <div class="df__writer">
          <textarea
            class="df__input"
            rows="1"
            {placeholder}
            bind:value={draft}
            disabled={pending}
            onkeydown={onKeydown}
          ></textarea>
          <p class="df__aud">{privateWord}</p>
        </div>
      {/if}
      {#each notes as n (n.id)}
        <div class="df__note">
          <p class="df__note-body">{n.body}</p>
          <button type="button" class="df__note-x" aria-label={deleteLabel} onclick={() => onDelete(n.id)}
            >×</button
          >
        </div>
      {/each}
    {/if}
  </section>

  <section class="df__col df__col--next">
    <button type="button" class="df__lid" aria-expanded={nextOpen} onclick={() => (nextOpen = !nextOpen)}>
      <span class="df__lid-w">{nextWord}</span>
      <span class="df__lid-n">{next.length === 0 ? emptyWord : next[0].day} {nextOpen ? '−' : '+'}</span>
    </button>
    {#if nextOpen}
      {#each next as it (it.id)}
        <svelte:element
          this={it.href ? 'a' : 'div'}
          class="df__nx"
          class:df__nx--held={it.held}
          {...it.href ? { href: it.href } : {}}
        >
          <span class="df__nx-meta">
            {#if it.project}<IdentityMark
                mini
                accent={accentVarFor(it.project)}
                name={it.project.name}
                initials={it.project.initials}
              />{/if}
            <span class="df__nx-kind">{it.kind}</span>
            <span class="df__nx-day">{it.day}</span>
          </span>
          <span class="df__nx-n">{it.name}</span>
          {#if it.city}<span class="df__nx-c">{it.city}{#if it.country}
              <em>{it.country}</em>{/if}</span
          >{/if}
        </svelte:element>
      {/each}
    {/if}
  </section>
</div>

<style>
  @layer components {
    .df {
      display: grid;
      /* Notes carry prose — the reading measure; next is the narrow column. */
      grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
      gap: var(--space-l);
      margin-block-start: var(--space-m);
    }
    .df__col {
      min-inline-size: 0;
    }
    /* ── The lid · one fold mechanism for the whole tool ─────────────── */
    .df__lid {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      inline-size: 100%;
      padding: 0 0 var(--space-2xs);
      border: 0;
      border-block-end: 1px solid var(--border-color-light);
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .df__lid:hover .df__lid-w {
      color: var(--text-muted);
    }
    .df__lid-n {
      font-variant-numeric: tabular-nums;
    }
    /* ── Notes · mine, always private (ADR-093) ──────────────────────── */
    .df__writer {
      padding-block: var(--space-s) var(--space-2xs);
    }
    .df__input {
      display: block;
      inline-size: 100%;
      padding: 0;
      border: 0;
      background: none;
      resize: none;
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      line-height: 1.45;
      color: var(--text-color);
      field-sizing: content;
    }
    .df__input:focus {
      outline: none;
    }
    .df__input::placeholder {
      color: var(--text-faint);
    }
    /* Who will read it — the one thing to know before writing. */
    .df__aud {
      margin: 2px 0 0;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .df__note {
      position: relative;
      padding-block: var(--space-xs);
    }
    .df__note + .df__note {
      border-block-start: 1px dotted var(--border-color-light);
    }
    .df__note-body {
      margin: 0;
      padding-inline-end: 16px;
      font-size: var(--text-s);
      line-height: 1.45;
      color: var(--text-color);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .df__note-x {
      position: absolute;
      inset-inline-end: 0;
      inset-block-start: var(--space-xs);
      padding: 0;
      border: 0;
      background: none;
      font-size: 11px;
      line-height: 1;
      color: var(--text-faint);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .df__note:hover .df__note-x,
    .df__note-x:focus-visible {
      opacity: 1;
    }
    .df__note-x:hover {
      color: var(--text-color);
    }
    /* ── Next · the days after this one, briefly ─────────────────────── */
    .df__nx {
      display: block;
      padding-block: var(--space-xs);
      text-decoration: none;
      color: inherit;
      min-inline-size: 0;
    }
    .df__nx + .df__nx {
      border-block-start: 1px dotted var(--border-color-light);
    }
    .df__nx-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .df__nx--held .df__nx-kind {
      font-style: italic;
    }
    .df__nx-n {
      display: block;
      margin-block-start: 1px;
      font-family: var(--font-display);
      font-size: var(--text-m);
      color: var(--text-color);
      text-wrap: pretty;
    }
    .df__nx--held .df__nx-n {
      font-style: italic;
      color: var(--text-muted);
    }
    a.df__nx:hover .df__nx-n {
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    .df__nx-c {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .df__nx-c em {
      font-style: normal;
      letter-spacing: 0.08em;
      margin-inline-start: 4px;
    }
    @media (max-width: 640px) {
      .df {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
