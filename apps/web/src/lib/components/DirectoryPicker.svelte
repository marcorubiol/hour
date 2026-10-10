<script lang="ts">
  /**
   * DIRECTORIO GLOBAL DE SALAS (fase 1): find a venue in the public directory
   * and ADOPT it into the space. Adopting copies the entry into a `venue` of
   * the space (with `directory_id`), which from then on is the space's and is
   * edited like any other; adopting twice returns the same venue.
   *
   * Every word typed must be in the entry's name or town. Each row says
   * where it is and what it is; an entry its source stopped listing says
   * «not listed since». The credit line names the sources and leads to the
   * licences page: the licences ask for attribution where the data appears.
   */
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { DirectoryEntry, VenueKind } from '$lib/venue-directory';

  interface Props {
    /** The space the venue is adopted into. */
    workspaceId: string;
    locale: Locale;
    /** After adopting: the space's venue (with the venue endpoints' columns). */
    onadopt: (venue: { id: string; name: string; city: string | null; country: string | null }) => void;
  }

  let { workspaceId, locale, onadopt }: Props = $props();

  /** One literal key per kind, so the dictionaries guard can see them. */
  const KIND_KEY: Record<VenueKind, string> = {
    theatre: 'directory.kind_theatre',
    opera: 'directory.kind_opera',
    concert_hall: 'directory.kind_concert_hall',
    auditorium: 'directory.kind_auditorium',
    arena: 'directory.kind_arena',
    creation_centre: 'directory.kind_creation_centre',
    multipurpose: 'directory.kind_multipurpose',
    cultural_centre: 'directory.kind_cultural_centre',
    other_stage: 'directory.kind_other_stage',
  };

  let q = $state('');
  let items = $state<DirectoryEntry[]>([]);
  let asked = $state('');
  let adopting = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  let regions = $derived(new Intl.DisplayNames([locale], { type: 'region' }));
  const countryName = (cc: string) => {
    try {
      return regions.of(cc) ?? cc;
    } catch {
      return cc;
    }
  };

  function search() {
    clearTimeout(timer);
    const text = q.trim();
    if (text.length < 2) {
      items = [];
      asked = '';
      return;
    }
    timer = setTimeout(async () => {
      try {
        const res = await fetchJSON<{ items: DirectoryEntry[] }>(
          `/api/venue-directory?${new URLSearchParams({ q: text })}`,
        );
        if (q.trim() !== text) return;
        items = res.items;
        asked = text;
      } catch {
        items = [];
        asked = text;
      }
    }, 200);
  }

  async function adopt(entry: DirectoryEntry) {
    adopting = entry.id;
    try {
      const body = await mutateJSON<{
        venue?: { id: string; name: string; city: string | null; country: string | null };
      }>('POST', '/api/venue-directory/adopt', { workspace_id: workspaceId, directory_id: entry.id });
      if (!body?.venue) throw new Error(t('perf.unexpected', locale));
      addToast({ tone: 'success', message: t('directory.adopted', locale, { name: body.venue.name }) });
      onadopt(body.venue);
    } catch (err) {
      addToast({
        tone: 'danger',
        title: t('directory.adopt_failed', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    } finally {
      adopting = null;
    }
  }

  /** A day in the reader's language (the source's day, so UTC). */
  const dateOf = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function whereOf(e: DirectoryEntry): string {
    return [e.city, countryName(e.country), t(KIND_KEY[e.kind], locale), e.capacity ? t('directory.capacity', locale, { n: e.capacity }) : '']
      .filter(Boolean)
      .join(' · ');
  }
</script>

<section class="dir" aria-label={t('directory.search_label', locale)}>
  <Input
    label={t('directory.search_label', locale)}
    placeholder={t('directory.search_placeholder', locale)}
    autocomplete="off"
    bind:value={q}
    oninput={search}
  />
  {#if items.length}
    <ul class="dir__list">
      {#each items as e (e.id)}
        <li class="dir__row">
          <span class="dir__what">
            <span class="dir__name">{e.name}</span>
            <span class="dir__where">
              {whereOf(e)}{#if e.status === 'missing'}
                · <em>{t('directory.missing', locale, { date: dateOf(e.last_seen_at) })}</em>{/if}
            </span>
          </span>
          <Button variant="outline" size="s" loading={adopting === e.id} disabled={adopting !== null} onclick={() => adopt(e)}>
            {t('directory.adopt', locale)}
          </Button>
        </li>
      {/each}
    </ul>
  {:else if asked}
    <p class="dir__empty">{t('directory.empty', locale, { q: asked })}</p>
  {/if}
  <p class="dir__credit">
    {t('directory.credit', locale)}
    <a href="/h/legal" target="_blank" rel="noopener">{t('directory.sources_link', locale)}</a>
  </p>
</section>

<style>
  @layer components {
    .dir {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .dir__list {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
      max-block-size: 16rem;
      overflow-y: auto;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
    }
    .dir__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-2xs) var(--space-xs);
    }
    .dir__row + .dir__row {
      border-block-start: 1px solid var(--border-color-light);
    }
    .dir__what {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }
    .dir__name {
      font-size: var(--text-s);
      color: var(--text-color);
      overflow-wrap: anywhere;
    }
    .dir__where,
    .dir__empty {
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow-wrap: anywhere;
    }
    .dir__empty {
      margin: 0;
    }
    .dir__credit {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .dir__credit a {
      color: inherit;
    }
  }
</style>
