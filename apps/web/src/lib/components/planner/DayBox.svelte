<script lang="ts">
  /**
   * One thing of the Day (ADR-247, amending ADR-233 and ADR-237): the day is
   * always the same, one thing or fifteen — the strip, and under it a white
   * box per thing, by hour, that opens its pase. No stops and no buttons: the
   * detail and the editing live in the pase (Marco, 24-11-2026, lámina
   * `dia-abrir/H-cabecera-recomendada.png`).
   *
   * A performance carries a thin dark band on top — dark is «función», as on
   * the strip — with its venue and, when there is one before the curtain,
   * the hour you have to be there («CARGA 16H»). The project speaks once, by
   * its monogram; the state only when it is not closed (never «Confirmada»).
   * A clash is said inside the box it is about.
   */
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import type { ProjectLite } from '$lib/month-events';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    href: string | null;
    project?: ProjectLite | null;
    /** «Función · Vic», «Ensayo?», «Viaje»… with its «?» when it leans. */
    what: string;
    /** The hour as the house writes it, or null («—»). */
    at: string | null;
    noHourWord: string;
    /** Small, under the name: where, and the state only when not closed. */
    sub?: string;
    guess?: boolean;
    /** A performance: its band. `place` left, `call` right («Carga 16h»). */
    band?: { place: string; call: string | null } | null;
    /** The clash sentences this thing is in. */
    clashes?: string[];
    done?: boolean;
  }
  let {
    href,
    project = null,
    what,
    at,
    noHourWord,
    sub = '',
    guess = false,
    band = null,
    clashes = [],
    done = false,
  }: Props = $props();
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  {href}
  class="dbox"
  class:dbox--show={band !== null}
  class:dbox--done={done}
  data-testid="day-box"
>
  {#if band}
    <span class="dbox__band"
      ><span class="dbox__place">{band.place}</span>{#if band.call}<span class="dbox__call">{band.call}</span>{/if}</span
    >
  {/if}
  <span class="dbox__in">
    <span class="dbox__at" class:dbox__at--none={at === null} title={at === null ? noHourWord : undefined}
      >{at ?? '—'}</span
    >
    <span class="dbox__body">
      <span class="dbox__what" class:guess
        >{#if project}<span class="dbox__mark"
            ><IdentityMark mini accent={accentVarFor(project)} name={project.name} initials={project.initials} /></span
          >{/if}<span>{what}</span></span
      >
      {#if sub}<span class="dbox__sub">{sub}</span>{/if}
      {#each clashes as c (c)}<span class="dbox__clash">{c}</span>{/each}
    </span>
    {#if href}<span class="dbox__go" aria-hidden="true">›</span>{/if}
  </span>
</svelte:element>

<style>
  @layer components {
    .dbox {
      display: grid;
      inline-size: 100%;
      max-inline-size: var(--pass-width);
      overflow: hidden;
      border: var(--line-hairline) solid var(--border-color);
      border-radius: var(--radius-m);
      background: var(--bg-ultra-light);
      color: inherit;
      text-decoration: none;
    }
    a.dbox:hover {
      border-color: var(--text-muted);
    }
    .dbox--show {
      border-color: var(--surface-focus);
    }
    .dbox--done {
      opacity: 0.55;
    }
    .dbox__band {
      display: flex;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-xs) var(--space-s);
      background: var(--surface-focus);
      color: var(--surface-focus-muted);
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
    }
    .dbox__place {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .dbox__call {
      flex: none;
      color: var(--surface-focus-ink);
    }
    .dbox__in {
      display: grid;
      grid-template-columns: 3.5rem minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: center;
      padding: var(--space-s);
      min-block-size: var(--touch-target);
    }
    .dbox__at {
      font-family: var(--font-mono);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dbox--show .dbox__at {
      font-weight: 500;
    }
    .dbox__at--none {
      color: var(--text-muted);
    }
    .dbox__body {
      display: grid;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .dbox__what {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-display);
      font-size: var(--text-l);
      line-height: 1.15;
    }
    .dbox__mark {
      display: inline-flex;
      flex: none;
    }
    .dbox__sub {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    /* Red is conflict, and only conflict. */
    .dbox__clash {
      font-size: var(--text-s);
      color: var(--danger);
    }
    .dbox__go {
      color: var(--text-muted);
    }
  }
</style>
