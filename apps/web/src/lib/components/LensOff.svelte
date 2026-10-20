<script lang="ts">
  /**
   * A lens reached by URL that is off in every space on screen (ADR-132). It
   * says so, and to whom to say it: the names of whoever administers each of
   * those spaces, or, if that is you, the way to Settings. The lens keeps its
   * header, and the switcher is in the frame (ADR-140), so the way out is
   * where it always is.
   */
  import { createQueries } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { docTitle } from '$lib/doc-title';
  import { appLocale, t } from '$lib/i18n';
  import type { NavWorkspace } from '$lib/nav';
  import { spaceName } from '$lib/utils/identity';
  import type { Lens } from '$lib/stores/lens.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';

  interface Props {
    lens: Exclude<Lens, 'desk'>;
    workspaces: NavWorkspace[];
  }
  let { lens, workspaces }: Props = $props();

  const locale = appLocale();
  const LABEL = { planner: 'lens.planner', conversations: 'lens.conversations', books: 'lens.money' } as const;
  let label = $derived(t(LABEL[lens], locale));

  type Setting = { can_edit: boolean; admins: string[] };
  const settings = createQueries({
    queries: toStore(() =>
      workspaces.map((w) => ({
        queryKey: ['workspace-lenses', w.id] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJSON<Setting>(`/api/workspaces/${w.id}/lenses`, signal),
      })),
    ),
  });

  let rows = $derived(
    workspaces.map((w, i) => ({
      slug: w.slug,
      name: spaceName(w.name),
      canEdit: $settings[i]?.data?.can_edit === true,
      admins: $settings[i]?.data?.admins ?? [],
    })),
  );
  let many = $derived(rows.length > 1);
</script>

<svelte:head>
  <title>{docTitle(label)}</title>
</svelte:head>

<section class="lens-off" data-testid="lens-off" data-lens={lens} aria-busy={$settings.some((q) => q.isPending)}>
  <LensHeader>
    {#snippet title()}<LensTitle text={label} />{/snippet}
  </LensHeader>

  <p class="lens-off__lead">
    {t(many ? 'lens.off_many' : 'lens.off_one', locale, { lens: label })}
  </p>
  <ul class="lens-off__list" role="list">
    {#each rows as r (r.slug)}
      <li>
        {#if many}<span class="lens-off__space">{r.name}</span>{/if}
        {#if r.canEdit}
          <a class="link-arrow" href="/h/{r.slug}/settings?section=lenses">{t('lens.off_turn_on', locale)}</a>
        {:else if r.admins.length > 0}
          {t('lens.off_ask', locale, { names: r.admins.join(', ') })}
        {:else}
          {t('lens.off_ask_admin', locale)}
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .lens-off {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }
  .lens-off__lead {
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .lens-off__list {
    display: grid;
    gap: var(--space-2xs);
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  .lens-off__space {
    color: var(--text-muted);
  }
  .lens-off__space::after {
    content: ' · ';
  }
</style>
