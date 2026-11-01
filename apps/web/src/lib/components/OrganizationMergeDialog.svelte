<script lang="ts" module>
  export interface OrgMergeResult {
    merge_id: string;
    keep_organization_id: string;
    drop_organization_id: string;
    keep_slug: string | null;
    /** The name of the one that went, for the notice. */
    drop_name: string;
  }
</script>

<script lang="ts">
  /**
   * «Fusionar con…» on an organization (84, ADR-171): the flow of the
   * person's merge (PersonMergeDialog). The admin names the other
   * organization of the space, sees what moves and confirms.
   *
   *   Fusionar dos organizaciones
   *   La otra organización   [Teatre Principal SL        ]
   *   Se queda               [ Teatre Principal | Teatre Principal SL ]
   *   Desaparece Teatre Principal SL
   *   Pasa a «Teatre Principal»: 2 conversaciones · 1 bolo · 3 contactos.
   *   Lo vacío de la que se queda toma lo de la otra; las notas se suman.
   *   Se puede deshacer durante 30 días.            [Cancelar] [Fusionar]
   *
   * The preview is `preview_organization_merge`: the counts are what RLS
   * lets whoever merges read. Two conversations of the same project (one of
   * each) stop the merge: the dialog names them, with their links, and
   * «Fusionar» stays off. The older one stays by default. Nothing is written
   * until «Fusionar» (ADR-139 p7).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { organizationsQueryOptions } from '$lib/organizations';
  import {
    orgByName,
    orgCountParts,
    orgShouldFlip,
    type OrgMergeCounts,
    type OrgMergePreview,
  } from '$lib/organization-merge';

  interface Props {
    open?: boolean;
    workspaceId: string;
    workspaceSlug: string;
    /** The organization the dialog was opened from. */
    organization: { id: string; name: string };
    locale: Locale;
    onmerged: (result: OrgMergeResult) => void;
  }

  let { open = $bindable(false), workspaceId, workspaceSlug, organization, locale, onmerged }: Props = $props();

  // The same list as the conversation's «Añadir» (one cache for the app).
  const orgsQuery = createQuery(toStore(() => organizationsQueryOptions(open)));
  let names = $derived(
    ($orgsQuery.data?.items ?? [])
      .filter((o) => o.workspace_id === workspaceId && o.id !== organization.id)
      .map((o) => o.name)
      .sort((a, b) => a.localeCompare(b)),
  );

  let text = $state('');
  let otherId = $state<string | null>(null);
  let preview = $state<OrgMergePreview | null>(null);
  let loading = $state(false);
  let failure = $state<string | null>(null);
  let merging = $state(false);

  // Each opening starts clean.
  $effect(() => {
    if (!open) return;
    text = '';
    otherId = null;
    preview = null;
    failure = null;
  });

  // A typed name that is an organization of the space picks it.
  let match = $derived(orgByName($orgsQuery.data?.items ?? [], workspaceId, text, organization.id));
  $effect(() => {
    const m = match;
    if (!open || !m || m.id === otherId) return;
    otherId = m.id;
    void load(organization.id, m.id, true);
  });

  let seq = 0;
  async function load(keep: string, drop: string, flipOnce: boolean): Promise<void> {
    const mine = ++seq;
    loading = true;
    failure = null;
    try {
      const body = await fetchJSON<{ preview: OrgMergePreview }>(
        `/api/organization-merges?workspace_id=${encodeURIComponent(workspaceId)}&keep=${keep}&drop=${drop}`,
      );
      if (mine !== seq) return;
      if (flipOnce && orgShouldFlip(body.preview)) return load(drop, keep, false);
      preview = body.preview;
    } catch (err) {
      if (mine !== seq) return;
      preview = null;
      failure = refusalText(err);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  function refusalText(err: unknown): string {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    if (err instanceof ApiError && err.status === 404) return t('organization.merge_err_not_found', locale);
    if (code === 'same_organization') return t('organization.merge_err_same', locale);
    // A clash the preview could not show: a private conversation of someone else.
    if (code === 'project_clash') return t('organization.merge_clash_hidden', locale);
    return err instanceof Error ? err.message : t('perf.unexpected', locale);
  }

  // ── What the preview says ────────────────────────────────────────────
  let keepName = $derived(preview?.keep.name ?? '');
  let dropName = $derived(preview?.drop.name ?? '');
  let clashes = $derived(preview?.clashes ?? []);
  let blocked = $derived((preview?.conflicts?.conversations ?? 0) > 0);

  /** One literal key per count, so the dictionaries guard sees them all. */
  const COUNT_LABEL: Record<keyof OrgMergeCounts, (n: number) => string> = {
    conversations: (n) =>
      n === 1
        ? t('organization.merge_n_conversations_one', locale)
        : t('organization.merge_n_conversations', locale, { n }),
    bolos: (n) => (n === 1 ? t('organization.merge_n_bolos_one', locale) : t('organization.merge_n_bolos', locale, { n })),
    contacts: (n) =>
      n === 1 ? t('organization.merge_n_contacts_one', locale) : t('organization.merge_n_contacts', locale, { n }),
    venues: (n) => (n === 1 ? t('organization.merge_n_venues_one', locale) : t('organization.merge_n_venues', locale, { n })),
    invoices: (n) =>
      n === 1 ? t('organization.merge_n_invoices_one', locale) : t('organization.merge_n_invoices', locale, { n }),
  };

  let movesLine = $derived.by(() => {
    if (!preview) return '';
    const parts = orgCountParts(preview.counts).map(({ key, n }) => COUNT_LABEL[key](n));
    return parts.length === 0
      ? t('organization.merge_moves_none', locale)
      : t('person.merge_moves', locale, { name: keepName, list: parts.join(' · ') });
  });

  // «Se queda»: the two by their ids (a swap reloads the preview).
  let keepOptions = $derived(
    preview
      ? [
          { value: preview.keep_organization_id, label: preview.keep.name },
          { value: preview.drop_organization_id, label: preview.drop.name },
        ]
      : [],
  );
  function chooseKeep(id: string) {
    if (!preview || id === preview.keep_organization_id) return;
    void load(preview.drop_organization_id, preview.keep_organization_id, false);
  }

  const conversationHref = (id: string) => `/h/${workspaceSlug}/conversation/${id}`;

  async function confirm() {
    if (!preview || merging || blocked) return;
    merging = true;
    try {
      const body = await mutateJSON<{
        merge: {
          merge_id: string;
          keep_organization_id: string;
          drop_organization_id: string;
          keep_slug: string | null;
        };
      }>('POST', '/api/organization-merges', {
        workspace_id: workspaceId,
        keep_organization_id: preview.keep_organization_id,
        drop_organization_id: preview.drop_organization_id,
      });
      open = false;
      onmerged({ ...body!.merge, drop_name: dropName });
    } catch (err) {
      failure = `${t('organization.merge_failed', locale)}: ${refusalText(err)}`;
    } finally {
      merging = false;
    }
  }
</script>

<Dialog bind:open title={t('organization.merge_title', locale)} size="m">
  <p class="merge__hint">{t('organization.merge_pick_hint', locale)}</p>
  <div class="merge__grid">
    <Input
      id="org-merge-other"
      label={t('organization.merge_pick', locale)}
      placeholder={t('organization.merge_pick_ph', locale)}
      list="org-merge-list"
      autocomplete="off"
      bind:value={text}
    />
    <datalist id="org-merge-list">
      {#each names as name (name)}<option value={name}></option>{/each}
    </datalist>
    {#if text.trim().length >= 2 && !match && !preview && !loading}
      <p class="merge__hint">{t('organization.merge_no_match', locale)}</p>
    {/if}

    {#if preview}
      <Segmented
        label={t('person.merge_stays', locale)}
        options={keepOptions}
        value={preview.keep_organization_id}
        disabled={loading}
        onchange={chooseKeep}
      />
    {/if}
  </div>

  <div class="merge__say" aria-live="polite">
    {#if loading && !preview}
      <p class="merge__hint">{t('organization.merge_loading', locale)}</p>
    {/if}
    {#if failure}
      <p class="merge__fail" role="alert">{failure}</p>
    {/if}
    {#if preview}
      <p class="merge__goes">{t('person.merge_goes', locale, { name: dropName })}</p>
      <p data-testid="org-merge-moves">{movesLine}</p>
      {#if blocked}
        <p class="merge__warn" data-testid="org-merge-clash">{t('organization.merge_clash', locale)}</p>
        {#if clashes.length > 0}
          <ul class="merge__clashes" role="list">
            {#each clashes as c (c.drop_conversation_id)}
              <li>
                {c.project_name}:
                <a href={conversationHref(c.keep_conversation_id)}>{t('organization.merge_clash_with', locale, { name: keepName })}</a>
                ·
                <a href={conversationHref(c.drop_conversation_id)}>{t('organization.merge_clash_with', locale, { name: dropName })}</a>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="merge__hint">{t('organization.merge_fills', locale)}</p>
        <p class="merge__hint">{t('person.merge_undo_note', locale)}</p>
      {/if}
    {/if}
  </div>

  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={confirm} loading={merging} disabled={!preview || loading || blocked}>
      {t('person.merge_confirm', locale)}
    </Button>
  {/snippet}
</Dialog>
