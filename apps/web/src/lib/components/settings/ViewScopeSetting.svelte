<script lang="ts">
  /**
   * «Lo mío / Todo», one line per space (ADR-151): what Hoy, Ahora, the pulse
   * and the Planner show you in each company. A person's own setting, so it
   * lives in Profile, where every space is listed and a guest can reach it.
   * No daily switch anywhere else: it is set once, here.
   *
   * The value rides on the workspaces feed (`view_scope`, null = the package's
   * default); a change writes it there at once, so every surface repaints, and
   * reads the feed again after.
   */
  import Segmented from '$lib/components/Segmented.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { appLocale, t } from '$lib/i18n';
  import { spaceName } from '$lib/utils/identity';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { defaultViewScope, viewScopeIsDefault, viewScopeOf, type ViewScope } from '$lib/view-scope';
  import type { NavWorkspace } from '$lib/nav';

  const locale = appLocale();
  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);

  const saved = new SaveFlash();
  type Vars = { id: string; scope: ViewScope | null };
  const save = createMutation({
    mutationFn: ({ id, scope }: Vars) => mutateJSON('PUT', '/api/me/view-scope', { workspace_id: id, view_scope: scope }),
    onMutate: async ({ id, scope }: Vars) => {
      await queryClient.cancelQueries({ queryKey: ['workspaces'] });
      const before = queryClient.getQueriesData<{ items: NavWorkspace[] }>({ queryKey: ['workspaces'] });
      for (const [key, data] of before) {
        if (!data) continue;
        queryClient.setQueryData(key, { ...data, items: data.items.map((w) => (w.id === id ? { ...w, view_scope: scope } : w)) });
      }
      return { before };
    },
    onSuccess: (_d, { id }) => saved.show(id),
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.before ?? []) queryClient.setQueryData(key, data);
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  });

  /** Choosing the package's own default stores null: it follows the package. */
  function choose(w: NavWorkspace, scope: ViewScope) {
    const fallback = defaultViewScope(w.my_role, w.my_preset);
    $save.mutate({ id: w.id, scope: scope === fallback ? null : scope });
  }
  const options = () => [
    { value: 'mine' as ViewScope, label: t('settings.view_scope_mine', locale) },
    { value: 'all' as ViewScope, label: t('settings.view_scope_all', locale) },
  ];
</script>

{#if workspaces.length > 0}
  <section class="set-group" data-testid="view-scope">
    <BlockHead title={t('settings.view_scope_kicker', locale)} />
    <div class="set-group__body">
      <p class="set-row__hint view-scope__lead">{t('settings.view_scope_lead', locale)}</p>
      {#each workspaces as w (w.id)}
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{spaceName(w.name)}</div>
            {#if viewScopeIsDefault(w)}<div class="set-row__hint">{t('settings.view_scope_default', locale)}</div>{/if}
          </div>
          <div class="set-row__ctrl">
            <Segmented
              ariaLabel={t('settings.view_scope_aria', locale, { space: spaceName(w.name) })}
              options={options()}
              value={viewScopeOf(w)}
              disabled={$save.isPending}
              onchange={(scope) => choose(w, scope)}
            />
            <SavedMark shown={saved.is(w.id)} />
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .view-scope__lead {
    max-inline-size: 60ch;
    margin-block-end: var(--space-s);
    line-height: 1.5;
  }
</style>
