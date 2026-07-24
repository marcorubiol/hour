<script lang="ts">
  /**
   * One performance chip on the month grid — the card markup + its
   * presentation helpers, extracted from MonthGrid verbatim. Deliberately
   * styleless: the hand-tuned `.cal__event*` grammar (shared fill, dashed
   * border, texture, earned radius/lift) lives in MonthGrid's :global
   * block so a gig and a date card can never drift apart.
   */
  import { dualTime } from '$lib/datetime';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { isReady, performanceStatusFamily } from '$lib/performance';
  import { perfInstant, type PerformanceEvent, type ProjectLite } from '$lib/month-events';

  interface Props {
    p: PerformanceEvent;
    /** Fallback slug for the chip href when the perf's workspace isn't resolvable. */
    workspaceSlug: string;
    workspaceSlugById: Map<string, string>;
    workspaceTzById: Map<string, string | undefined>;
    /** ADR-002 — hold convention per workspace, resolved PER CHIP. */
    workspaceModeById: Map<string, string>;
    viewerTz: string;
    /** The word on the card's FOOT — "confirmat", "1r hold", "proposat". */
    stateLabel: (status: string) => string | null;
    /** The readiness checklist a CONFIRMED gig shows on its foot (ADR-084 §3). */
    readinessItems: { key: string; label: string }[];
    /** Monogram click — opens MonthGrid's identity quick panel (ADR-081). */
    onMarkOpen: (e: MouseEvent, project: ProjectLite | null) => void;
  }

  let {
    p,
    workspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    stateLabel,
    readinessItems,
    onMarkOpen,
  }: Props = $props();

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? workspaceSlug;
    return `/h/${ws}/performance/${p.slug}`;
  }

  function perfLabel(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }

  // Chip times follow the timezone rule: venue wall time on the chip, the
  // viewer's as a faint courtesy only when the clocks disagree. A
  // venue-less gig falls back to its home space's timezone — the same zone
  // its times were entered in — never silently the browser's. Venue-less
  // DATE rows stay on the viewer's clock on purpose: they bucket on the
  // viewer's day (dateDayKey), and a chip must not show a wall time from a
  // zone other than the one that placed it in its cell.
  function perfTz(p: PerformanceEvent): string | null {
    return p.venue?.timezone ?? workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  }
  function perfTime(p: PerformanceEvent): { primary: string; secondary: string | null } | null {
    const at = perfInstant(p);
    if (!at) return null;
    const t = dualTime(at, perfTz(p), viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  function perfTitle(p: PerformanceEvent): string {
    const base = `${perfLabel(p)} — ${p.status.replace(/_/g, ' ')}`;
    const at = perfInstant(p);
    if (!at) return base;
    const t = dualTime(at, perfTz(p), viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }

  // The chip's second row (venue on top, city underneath). Suppressed when
  // the label ALREADY fell back to the city — a chip never prints the same
  // place twice.
  function perfCity(p: PerformanceEvent): string | null {
    const city = p.venue?.city ?? p.city ?? null;
    return city && city !== perfLabel(p) ? city : null;
  }

  // The ISO code beside the city (Marco, 2026-07-20): two letters are enough
  // to tell a Barcelona from a Bayonne at a glance, and unlike a full country
  // name they cannot wrap the line. The venue's own country wins over the
  // denormalised trio — the linked entity is the better truth.
  function perfCountry(p: PerformanceEvent): string | null {
    const cc = p.venue?.country ?? p.country ?? null;
    return cc ? cc.toUpperCase() : null;
  }

  /**
   * ADR-002 — the status the FOOT should speak, given the workspace's hold
   * convention. A ranked hold only means something where the convention is a
   * priority queue: in a `simple` workspace (theatre/dance) hold_1 and
   * hold_2 are the same thing — two holds coexisting on a slot — so printing
   * "1st hold" would invent a hierarchy the company does not run.
   *
   * The stored status is NOT rewritten; only the word changes. A workspace
   * that later switches to `prioritized` gets its ranks back untouched.
   */
  function footStatus(p: PerformanceEvent): string {
    const mode = workspaceModeById.get(p.project?.workspace_id ?? '') ?? 'simple';
    if (mode === 'prioritized') return p.status;
    return p.status.startsWith('hold') ? 'hold' : p.status;
  }

  let href = $derived(perfHref(p));
  let family = $derived(performanceStatusFamily(p.status));
</script>

<!-- One chip body, two shells: a gig with a slug is a link, one without is
     inert. The body lives in a snippet so the card grammar is written once. -->
{#snippet body()}
  {@const time = perfTime(p)}
  {@const city = perfCity(p)}
  {@const cc = perfCountry(p)}
  {@const foot = stateLabel(footStatus(p))}
  <span class="cal__event-top">
    <span class="cal__event-name">{perfLabel(p)}</span>
    {#if p.project}<button
        type="button"
        class="cal__markbtn"
        onclick={(e) => onMarkOpen(e, p.project)}
      ><IdentityMark
          accent={accentVarFor(p.project)}
          name={p.project.name}
          initials={p.project.initials}
        /></button>{/if}
  </span>
  {#if city || time}
    <span class="cal__event-line">
      <span class="cal__event-city"
        >{city ?? ''}{#if city && cc}<i class="cal__event-cc">{cc}</i>{/if}</span
      >
      {#if time}<span class="cal__event-time"
          >{time.primary}{#if time.secondary}<i> {time.secondary}</i>{/if}</span
        >{/if}
    </span>
  {/if}
  {#if performanceStatusFamily(p.status) === 'confirmed' && readinessItems.length > 0}
    <!-- A settled gig's foot answers "is it sorted?" — restating "confirmed"
         would only repeat what the fill and the radius already say. -->
    <span class="cal__event-foot cal__event-foot--ready">
      {#each readinessItems as item (item.key)}
        <span class="cal__ready" class:cal__ready--on={isReady(p.readiness, item.key)}
          >{item.label}</span
        >
      {/each}
    </span>
  {:else if foot}
    <span class="cal__event-foot">{foot}</span>
  {/if}
{/snippet}

{#if href}
  <a
    class="cal__event cal__event--perf"
    data-family={family}
    style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
    {href}
    title={perfTitle(p)}
  >{@render body()}</a>
{:else}
  <span
    class="cal__event cal__event--perf"
    data-family={family}
    style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
    title={perfTitle(p)}
  >{@render body()}</span>
{/if}
