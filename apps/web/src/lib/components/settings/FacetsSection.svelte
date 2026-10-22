<script lang="ts">
  /**
   * Las facetas del espacio (comms carril 2, fase 4; plan
   * `2026-10-22-comms-threads-facets.md` § 3.5). Calco de las etiquetas
   * (ConversationTagsSection, ADR-138 fase 4) con dos bloques más:
   *
   * 1. Las facetas: las de Hour y las propias, en su orden. El admin renombra
   *    una de Hour en su espacio (vacío vuelve al nombre de Hour), apaga y
   *    enciende, ordena (↑ ↓, o Alt y las flechas en la fila), crea una propia
   *    y marca dónde existe. Apagar quita el hilo y la palabra, nunca cambia
   *    quién lee los datos.
   * 2. Qué da cada paquete: fijo de Hour, solo se lee.
   * 3. Ajustes por persona (solo admin): cada membresía bajo el espacio, con
   *    las facetas que existen en su nivel; elegir guarda en sitio
   *    (`set_membership_facet`) y dice «guardado» a su lado (ADR-139 p7).
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Field from '$lib/components/Field.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { moveTag, tagKeyFromLabel } from '$lib/conversation-tags';
  import {
    FACET_LABEL_MAX,
    OWN_LEVELS,
    facetLabel,
    levelsText,
    newFacetProblem,
    personGrants,
    presetSummaries,
    settingsFacets,
    type AccessVerb,
    type ContainerLevel,
    type FacetKeyProblem,
    type FacetsPayload,
    type GrantFacet,
    type PersonGrant,
    type SettingsFacet,
  } from '$lib/workspace-facets';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  let url = $derived(`/api/workspaces/${workspaceId}/facets`);
  const facetsQuery = createQuery(
    toStore(() => ({
      queryKey: ['workspace-facets', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<FacetsPayload>(url, signal),
    })),
  );

  let data = $derived($facetsQuery.data);
  let canEdit = $derived(data?.can_edit ?? false);
  let facets = $derived(data && workspaceId ? settingsFacets(data.facets, data.settings, workspaceId) : []);
  let presets = $derived(data ? presetSummaries(data.presets, data.preset_facets, facets) : []);
  let grants = $derived(
    data ? personGrants(data.grants, facets, data.preset_facets, t('settings.facets_unknown_person', locale)) : [],
  );

  const saved = new SaveFlash();
  // The threads read the names and the switch: the board and the feed refetch.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspace-facets'] }),
      queryClient.invalidateQueries({ queryKey: ['bolo-board'] }),
    ]);
  const failed = (err: unknown) =>
    addToast({ tone: 'danger', title: t('edit.not_saved', locale), message: err instanceof Error ? err.message : String(err) });

  type Patch = { facet_id: string; label?: string | null; active?: boolean; levels?: ContainerLevel[] };
  const patch = createMutation({
    mutationFn: (body: Patch) => mutateJSON('PATCH', url, body),
    onError: failed,
    onSettled: refresh,
  });
  const order = createMutation({
    mutationFn: (ids: string[]) => mutateJSON('PUT', url, { order: ids }),
    onError: failed,
    onSettled: refresh,
  });
  type Grant = { membership_id: string; facet_id: string; verb: AccessVerb | null };
  const grant = createMutation({
    mutationFn: (body: Grant) => mutateJSON('PUT', `${url}/grants`, body),
    onError: failed,
    onSettled: refresh,
  });

  let busy = $derived($patch.isPending || $order.isPending);

  function hourName(f: SettingsFacet): string {
    return facetLabel({ key: f.key, label: null, labels: {} }, locale);
  }

  function hint(f: SettingsFacet): string {
    if (f.standard) return t('settings.facets_standard', locale, { name: hourName(f), levels: levelsText(f.levels, locale) });
    if (f.levels.length === 0) return t('settings.facets_own_nowhere', locale);
    return t('settings.facets_own', locale, { levels: levelsText(f.levels, locale) });
  }

  function rename(f: SettingsFacet, input: HTMLInputElement) {
    const value = input.value.trim();
    const stored = f.label ?? '';
    if (value === stored) return;
    if (!f.standard && !value) {
      // An own facet always has a name: there is no Hour's to go back to.
      input.value = stored;
      return;
    }
    $patch.mutate({ facet_id: f.id, label: value || null }, { onSuccess: () => saved.show(`name-${f.id}`) });
  }

  function backToHour(f: SettingsFacet) {
    $patch.mutate({ facet_id: f.id, label: null }, { onSuccess: () => saved.show(`name-${f.id}`) });
  }

  function setActive(f: SettingsFacet, active: boolean) {
    $patch.mutate({ facet_id: f.id, active }, { onSuccess: () => saved.show(`row-${f.id}`) });
  }

  function toggleLevel(f: SettingsFacet, level: ContainerLevel, on: boolean) {
    const levels = on ? [...f.levels, level] : f.levels.filter((l) => l !== level);
    $patch.mutate({ facet_id: f.id, levels }, { onSuccess: () => saved.show(`levels-${f.id}`) });
  }

  function move(f: SettingsFacet, step: -1 | 1) {
    const ids = facets.map((x) => x.id);
    const next = moveTag(ids, f.id, step);
    if (next.every((id, i) => id === ids[i])) return;
    $order.mutate(next, { onSuccess: () => saved.show(`row-${f.id}`) });
  }

  function onRowKey(f: SettingsFacet, ev: KeyboardEvent) {
    if (!canEdit || busy || !ev.altKey) return;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      move(f, ev.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // ── New facet ──────────────────────────────────────────────────────────────
  let draft = $state('');
  let draftLevels = $state<ContainerLevel[]>(['bolo']);
  let refused = $state<{ label: string; problem: FacetKeyProblem } | null>(null);
  let draftKey = $derived(tagKeyFromLabel(draft.trim()));
  let localProblem = $derived(draft.trim() ? newFacetProblem(draft, facets.map((x) => x.key)) : null);
  let problem = $derived(refused && refused.label === draft ? refused.problem : localProblem);
  let showProblem = $state(false);

  const create = createMutation({
    mutationFn: (body: { label: string; levels: ContainerLevel[] }) => mutateJSON('POST', url, body),
    onSuccess: () => {
      draft = '';
      showProblem = false;
      saved.show('new');
    },
    onError: (err, body) => {
      const code = err instanceof ApiError ? err.body?.error : null;
      if (code === 'taken' || code === 'invalid') {
        refused = { label: body.label, problem: code };
        showProblem = true;
      } else failed(err);
    },
    onSettled: refresh,
  });

  function submitNew(ev: SubmitEvent) {
    ev.preventDefault();
    if (!draft.trim()) return;
    showProblem = true;
    if (problem) return;
    $create.mutate({ label: draft, levels: draftLevels });
  }

  let newError = $derived(
    showProblem && problem ? t(`settings.facets_error_${problem}`, locale, { key: draftKey ?? '' }) : undefined,
  );
  let newHelper = $derived(
    draftKey ? t('settings.facets_new_key', locale, { key: draftKey }) : t('settings.facets_new_hint', locale),
  );

  // ── Per person ─────────────────────────────────────────────────────────────
  const verbWord = (v: AccessVerb | null) =>
    v ? t(`settings.facets_verb_${v}`, locale) : t('settings.facets_grant_none', locale).toLowerCase();

  let grantOptions = $derived([
    { value: 'none', label: t('settings.facets_grant_none', locale) },
    { value: 'view', label: t('settings.facets_grant_view', locale) },
    { value: 'edit', label: t('settings.facets_grant_edit', locale) },
  ]);

  function grantFacts(g: PersonGrant): string {
    const preset = g.preset
      ? t('settings.facets_grant_package', locale, { preset: t(`settings.facets_preset_${g.preset}`, locale) })
      : t('settings.facets_grant_no_package', locale);
    return [
      t(`facets.level_${g.level}`, locale),
      g.container,
      preset,
      g.adjusted > 0 ? t('settings.facets_grant_adjusted_n', locale, { n: g.adjusted }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function setGrant(g: PersonGrant, gf: GrantFacet, value: string) {
    const verb = value === 'view' || value === 'edit' ? value : null;
    if (verb === gf.verb) return;
    $grant.mutate(
      { membership_id: g.membership_id, facet_id: gf.facet.id, verb },
      { onSuccess: () => saved.show(`grant-${g.membership_id}-${gf.facet.id}`) },
    );
  }
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.lenses_kicker', locale) }]} title={t('settings.nav_facets', locale)}>
  {#snippet facts()}<span>{t('settings.facets_sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group" data-testid="settings-facets">
  <BlockHead title={t('settings.facets_group', locale)} count={canEdit ? t('settings.facets_order_hint', locale) : undefined} />
  <div class="set-group__body">
    {#each facets as f, i (f.id)}
      {@const name = facetLabel(f, locale)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="set-row facetset"
        class:is-off={!f.active}
        data-facet={f.key}
        role="group"
        aria-label={name}
        onkeydown={(ev) => onRowKey(f, ev)}
      >
        <div class="set-row__lead">
          <div class="set-row__label">{name}</div>
          <div class="set-row__hint">{hint(f)}</div>
        </div>
        <div class="set-row__ctrl">
          {#if canEdit}
            <Field id="facet-name-{f.id}" saved={saved.is(`name-${f.id}`)}>
              <input
                id="facet-name-{f.id}"
                type="text"
                maxlength={FACET_LABEL_MAX}
                aria-label={t('settings.facets_name', locale, { name })}
                placeholder={f.standard ? hourName(f) : undefined}
                value={f.label ?? ''}
                disabled={busy}
                onblur={(ev) => rename(f, ev.currentTarget)}
                onkeydown={(ev) => {
                  if (ev.key === 'Enter') ev.currentTarget.blur();
                }}
              />
            </Field>
            {#if f.standard && f.label}
              <Button size="xs" variant="quiet" disabled={busy} onclick={() => backToHour(f)}>
                {t('settings.facets_back_to_hour', locale)}
              </Button>
            {/if}
            <span class="facetset__tools">
              <Switch
                checked={f.active}
                label={t('settings.facets_active', locale, { name })}
                testid="facet-active-{f.key}"
                disabled={busy}
                onchange={(next) => setActive(f, next)}
              />
              <Button size="xs" variant="quiet" label={t('settings.facets_up', locale, { name })} disabled={busy || i === 0} onclick={() => move(f, -1)}>↑</Button>
              <Button
                size="xs"
                variant="quiet"
                label={t('settings.facets_down', locale, { name })}
                disabled={busy || i === facets.length - 1}
                onclick={() => move(f, 1)}>↓</Button
              >
              <SavedMark shown={saved.is(`row-${f.id}`)} />
            </span>
            {#if !f.standard}
              <fieldset class="facetset__levels">
                <legend class="visually-hidden">{t('settings.facets_levels', locale, { name })}</legend>
                {#each OWN_LEVELS as level (level)}
                  <Checkbox
                    id="facet-level-{f.id}-{level}"
                    label={t(`facets.level_${level}`, locale)}
                    checked={f.levels.includes(level)}
                    disabled={busy}
                    onchange={(ev) => toggleLevel(f, level, (ev.currentTarget as HTMLInputElement).checked)}
                  />
                {/each}
                <SavedMark shown={saved.is(`levels-${f.id}`)} />
              </fieldset>
            {/if}
          {:else}
            <span class="set-row__value">{f.active ? t('settings.facets_on', locale) : t('settings.facets_off', locale)}</span>
          {/if}
        </div>
      </div>
    {/each}

    {#if canEdit && data}
      <form class="set-row" onsubmit={submitNew} novalidate>
        <div class="set-row__lead">
          <label class="set-row__label" for="facet-new">{t('settings.facets_new', locale)}</label>
        </div>
        <div class="set-row__ctrl">
          <Field id="facet-new" error={newError} helper={newHelper} saved={saved.is('new')}>
            <input
              id="facet-new"
              type="text"
              maxlength={FACET_LABEL_MAX}
              bind:value={draft}
              oninput={() => (showProblem = false)}
              disabled={$create.isPending}
            />
          </Field>
          <fieldset class="facetset__levels">
            <legend class="visually-hidden">{t('settings.facets_levels', locale, { name: t('settings.facets_new', locale) })}</legend>
            {#each OWN_LEVELS as level (level)}
              <Checkbox
                id="facet-new-level-{level}"
                label={t(`facets.level_${level}`, locale)}
                checked={draftLevels.includes(level)}
                disabled={$create.isPending}
                onchange={(ev) => {
                  const on = (ev.currentTarget as HTMLInputElement).checked;
                  draftLevels = on ? [...draftLevels, level] : draftLevels.filter((l) => l !== level);
                }}
              />
            {/each}
          </fieldset>
          <Button size="s" variant="secondary" type="submit" loading={$create.isPending} disabled={!draft.trim()}>
            {t('settings.facets_create', locale)}
          </Button>
        </div>
      </form>
    {/if}

    {#if data && !canEdit}
      <div class="set-row">
        <span class="set-row__hint">{t('settings.lenses_admin_only', locale)}</span>
      </div>
    {/if}
  </div>
</section>

{#if data}
  <section class="set-group" data-testid="settings-facets-presets">
    <BlockHead title={t('settings.facets_presets_group', locale)} count={t('settings.facets_presets_hint', locale)} />
    <div class="set-group__body">
      {#each presets as p (p.key)}
        <div class="set-row" data-preset={p.key}>
          <div class="set-row__lead">
            <div class="set-row__label">{t(`settings.facets_preset_${p.key}`, locale)}</div>
            <div class="set-row__hint">
              {t(p.can_edit_meta ? 'settings.facets_preset_edit' : 'settings.facets_preset_view', locale)}
            </div>
          </div>
          <div class="set-row__ctrl">
            <span class="set-row__value">
              {#if p.facets.length === 0}
                {t('settings.facets_preset_none', locale)}
              {:else}
                {p.facets.map((pf) => `${facetLabel(pf.facet, locale)} ${t(`settings.facets_verb_${pf.verb}`, locale)}`).join(' · ')}
              {/if}
            </span>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if canEdit}
  <section class="set-group" data-testid="settings-facets-grants">
    <BlockHead title={t('settings.facets_grants_group', locale)} count={t('settings.facets_grants_hint', locale)} />
    <div class="set-group__body">
      {#each grants as g (g.membership_id)}
        <div class="set-row facetgrant" data-membership={g.membership_id} role="group" aria-label={g.name}>
          <div class="set-row__lead">
            <div class="set-row__label">{g.name}</div>
            <div class="set-row__hint">{grantFacts(g)}</div>
          </div>
          <div class="set-row__ctrl facetgrant__facets">
            {#each g.facets as gf (gf.facet.id)}
              {@const fname = facetLabel(gf.facet, locale)}
              <span class="facetgrant__facet" class:is-off={!gf.facet.active} data-facet={gf.facet.key}>
                <Segmented
                  label={fname}
                  options={grantOptions}
                  value={gf.verb ?? 'none'}
                  helper={gf.adjusted ? t('settings.facets_grant_adjusted', locale, { verb: verbWord(gf.presetVerb) }) : undefined}
                  disabled={$grant.isPending}
                  onchange={(next) => setGrant(g, gf, next)}
                />
                <SavedMark shown={saved.is(`grant-${g.membership_id}-${gf.facet.id}`)} />
              </span>
            {:else}
              <span class="set-row__hint">{t('settings.facets_grant_nothing', locale)}</span>
            {/each}
          </div>
        </div>
      {:else}
        <div class="set-row">
          <span class="set-row__hint">{t('settings.facets_grants_empty', locale)}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  @layer components {
    .facetset.is-off .set-row__label,
    .facetgrant__facet.is-off {
      color: var(--text-faint);
    }
    .facetset__tools {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
    .facetset__levels {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      margin: 0;
      padding: 0;
      border: 0;
      min-inline-size: 0;
    }
    .facetgrant__facets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s) var(--space-m);
    }
    .facetgrant__facet {
      display: inline-flex;
      align-items: end;
      gap: var(--space-2xs);
    }
  }
</style>
