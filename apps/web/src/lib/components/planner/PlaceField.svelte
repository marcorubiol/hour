<script lang="ts">
  /**
   * ONE END OF A STAGE: a city a person types, and the place they pick for it
   * (Travel v2 P2). The zone of that end comes from the pick, never from a
   * guess: candidates arrive from `/api/places` with their country and their
   * zone, and «Valencia» offers Spain AND Venezuela side by side.
   *
   * Typing again forgets the pick. Not picking is allowed and said: the end
   * then reads on the space's clock, and the line under the field says so.
   * An airport code (`LGW`, `ALC`) offers the airport. The space's own
   * VENUES come first (`workspaceId`): their zone is the venue's, else its
   * city's, else the space's, said. `suggest` offers one venue before
   * anything is typed (tonight's show, for the last stage of the trip):
   * offered, never imposed.
   *
   * A combobox by the ARIA pattern: ↑↓ move, ↵ picks while the list is open
   * (and only then: otherwise Enter submits the row, as in the running
   * order), Esc closes the list before it cancels anything.
   */
  import { fetchJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { pickPlace, type PickedPlace, type PlaceCandidate } from '$lib/places';
  import { zoneLabel } from '$lib/travel-stage';

  interface Props {
    /** The city text, as the person writes it. */
    value: string;
    /** The place picked for it, or null while nothing is. */
    picked: PickedPlace | null;
    label: string;
    placeholder?: string;
    /** Countries to list first (an order, never a choice). */
    prefer?: string[];
    /** The space's clock: what an end without a pick reads in. */
    spaceTz: string;
    locale: Locale;
    disabled?: boolean;
    /** The row's own keys (Esc cancels an edit) once the list is closed. */
    onkeydown?: (e: KeyboardEvent) => void;
    /** Say «on the space's clock» under an unpicked city. */
    sayUnpicked?: boolean;
    /** After a pick: the host writes what else the pick says (an airport's name). */
    onpick?: (p: PickedPlace) => void;
    /** The space whose venues are offered first. */
    workspaceId?: string | null;
    /** A venue offered on focus while the field is empty. */
    suggest?: { venueId: string; name: string } | null;
  }

  let {
    value = $bindable(''),
    picked = $bindable(null),
    label,
    placeholder = '',
    prefer = [],
    spaceTz,
    locale,
    disabled = false,
    onkeydown,
    sayUnpicked = true,
    onpick,
    workspaceId = null,
    suggest = null,
  }: Props = $props();

  let candidates = $state<PlaceCandidate[]>([]);
  let open = $state(false);
  let cur = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = '';
  const uid = $props.id();
  const listId = `place-${uid}`;

  let regions = $derived(new Intl.DisplayNames([locale], { type: 'region' }));
  const countryName = (cc: string | null) => {
    if (!cc) return '';
    try {
      return regions.of(cc) ?? cc;
    } catch {
      return cc;
    }
  };

  /** `only`: keep just this venue (the suggestion, looked up by its name). */
  function search(text: string, only: string | null = null) {
    clearTimeout(timer);
    if (text.trim().length < 2) {
      candidates = [];
      open = false;
      return;
    }
    timer = setTimeout(async () => {
      asked = text;
      const qs = new URLSearchParams({ q: text.trim() });
      if (prefer.length) qs.set('prefer', prefer.slice(0, 5).join(','));
      if (workspaceId) qs.set('workspace_id', workspaceId);
      try {
        const res = await fetchJSON<{ places: PlaceCandidate[] }>(`/api/places?${qs}`);
        if (asked !== text) return;
        candidates = only ? res.places.filter((c) => c.venueId === only) : res.places;
        cur = 0;
        open = candidates.length > 0;
      } catch {
        candidates = [];
        open = false;
      }
    }, only ? 0 : 180);
  }

  function onfocus() {
    if (!value.trim() && suggest) search(suggest.name, suggest.venueId);
  }

  /** Where a candidate is, and in which clock: what is being chosen. */
  function whereOf(c: { city?: string; country: string | null; tz: string | null; kind?: string }): string {
    const parts: string[] = [];
    if (c.kind === 'venue' && c.city) parts.push(c.city);
    const country = countryName(c.country);
    if (country) parts.push(country);
    parts.push(c.tz ? zoneLabel(c.tz) : t('planner.trip_zone_space', locale, { zone: zoneLabel(spaceTz) }));
    return parts.join(' · ');
  }

  function oninput() {
    picked = null;
    search(value);
  }

  function choose(c: PlaceCandidate) {
    const p = pickPlace(value, c);
    value = p.city;
    picked = p;
    open = false;
    onpick?.(p);
  }

  function keys(e: KeyboardEvent) {
    if (open && candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cur = (cur + 1) % candidates.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        cur = (cur - 1 + candidates.length) % candidates.length;
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        choose(candidates[cur]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        return;
      }
    }
    onkeydown?.(e);
  }

  /** The zone a candidate or a pick reads in, said only when it is not the
      space's (the list always says it: that is what is being chosen). */
  let status = $derived(
    picked
      ? !picked.tz
        ? t('planner.trip_zone_unknown', locale, { zone: zoneLabel(spaceTz) })
        : [countryName(picked.country), picked.tz !== spaceTz ? zoneLabel(picked.tz) : '']
            .filter(Boolean)
            .join(' · ') || null
      : sayUnpicked && value.trim()
        ? t('planner.trip_unpicked', locale, { zone: zoneLabel(spaceTz) })
        : null,
  );
</script>

<span class="pf">
  <input
    class="hours__in pf__in"
    role="combobox"
    aria-label={label}
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={open ? `${listId}-${cur}` : undefined}
    {placeholder}
    autocomplete="off"
    bind:value
    {oninput}
    {onfocus}
    onkeydown={keys}
    onblur={() => setTimeout(() => (open = false), 120)}
    {disabled}
  />
  {#if status && !open}<span class="pf__s" class:pf__s--open={!picked || !picked.tz}>{status}</span>{/if}
  {#if open}
    <span class="pf__list" role="listbox" id={listId} aria-label={label}>
      {#each candidates as c, i (`${c.kind}${c.venueId ?? ''}${c.code ?? ''}${c.country}${c.tz}${c.city}`)}
        <span
          class="pf__opt"
          class:pf__opt--cur={i === cur}
          role="option"
          id={`${listId}-${i}`}
          aria-selected={i === cur}
          tabindex="-1"
          onmousedown={(e) => {
            e.preventDefault();
            choose(c);
          }}
          onmouseenter={() => (cur = i)}
        >
          <span class="pf__name"
            >{#if c.kind === 'venue'}<i class="hours__k pf__code">{t('planner.place_venue', locale)}</i
              >{:else if c.code}<i class="hours__k pf__code">{c.code}</i>{/if}{c.kind === 'city'
              ? c.city
              : c.place}</span
          >
          <span class="pf__where">{whereOf(c)}</span>
        </span>
      {/each}
      <!-- CC BY 4.0: the places are GeoNames', and they say so where they appear. -->
      <a class="pf__credit" href="https://www.geonames.org" target="_blank" rel="noopener" tabindex="-1"
        >{t('planner.places_credit', locale)}</a
      >
    </span>
  {/if}
</span>

<style>
  @layer components {
    .pf {
      position: relative;
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }
    .pf__in {
      inline-size: 100%;
    }
    /* Under the field, in the gloss's voice: where it is, or that it is
       not known yet and which clock it reads in meanwhile. */
    .pf__s {
      padding-block-start: 1px;
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow-wrap: anywhere;
    }
    .pf__s--open {
      font-style: italic;
    }
    .pf__list {
      position: absolute;
      z-index: 20;
      inset-block-start: calc(100% + 2px);
      inset-inline-start: 0;
      display: flex;
      flex-direction: column;
      min-inline-size: max(100%, 16rem);
      padding-block: var(--space-2xs);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
      box-shadow: var(--box-shadow-2);
    }
    .pf__opt {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-2xs) var(--space-xs);
      cursor: pointer;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .pf__opt--cur {
      background: var(--bg-hover);
    }
    .pf__name {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .pf__code {
      inline-size: auto;
    }
    .pf__where {
      flex: none;
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: nowrap;
    }
    /* A NARROW HOST (the day on a phone): the list is as wide as its field,
       never wider than the row it sits in, and the country goes under the
       name instead of beside it. */
    @container (max-width: 30rem) {
      .pf__list {
        min-inline-size: 100%;
      }
      .pf__opt {
        flex-direction: column;
        gap: 0;
      }
    }
    .pf__credit {
      align-self: end;
      padding: var(--space-2xs) var(--space-xs) 0;
      font-size: 9px;
      color: var(--text-faint);
      text-decoration: none;
    }
  }
</style>
