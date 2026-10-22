<script lang="ts" module>
  export interface MergeResult {
    merge_id: string;
    keep_person_id: string;
    drop_person_id: string;
    keep_slug: string | null;
    /** The name of the file that went, for the notice. */
    drop_name: string;
  }
</script>

<script lang="ts">
  /**
   * «Fusionar con…» (plan 2026-10-22, fase 2): el admin elige la otra ficha
   * de la misma persona, ve qué pasa y confirma.
   *
   *   Fusionar dos fichas
   *   La otra ficha   [Inés Ortega Ruiz · Pradillo   ]
   *   Se queda        [ Inés Ortega | Inés Ortega Ruiz ]
   *   Nombre          [ Inés Ortega | Inés Ortega Ruiz ]   (solo si difieren)
   *   Email           [ ines@sala…  | ines@correo…     ]
   *   Pasa a «Inés Ortega»: 2 papeles de reparto · 1 conversación.
   *   Si las dos están en lo mismo, se queda una.
   *   ines@correo… deja de traer correo a Hour.
   *   Se puede deshacer durante 30 días.            [Cancelar] [Fusionar]
   *
   * La vista previa es `preview_person_merge`: los recuentos son lo que la
   * RLS deja ver a quien fusiona (lo que no ve se mueve igual y no se dice).
   * Se queda por defecto la que tiene cuenta (lo decide la base) y, si
   * ninguna, la más antigua. Con una cuenta no se elige cuál se queda.
   * Nada se escribe hasta «Fusionar» (ADR-139 p7).
   */
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import PersonPicker from '$lib/components/PersonPicker.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { PaletteSearchResult } from '$lib/palette-search';
  import type { PersonOption } from '$lib/persons';
  import {
    canChooseKeep,
    countParts,
    fieldsPayload,
    fieldsToChoose,
    hasConflicts,
    lostEmail,
    shouldFlip,
    type MergeChoices,
    type MergeCounts,
    type MergeField,
    type MergePreview,
    type MergeSide,
  } from '$lib/person-merge';

  interface Props {
    open?: boolean;
    workspaceId: string;
    /** The file the dialog was opened from. */
    person: { id: string; full_name: string };
    locale: Locale;
    /** The other file, already known (phase 3: an invitation accepted by
        an account that is already someone else). */
    other?: PersonOption | null;
    invitationId?: string | null;
    onmerged: (result: MergeResult) => void;
  }

  let {
    open = $bindable(false),
    workspaceId,
    person,
    locale,
    other: preset = null,
    invitationId = null,
    onmerged,
  }: Props = $props();

  let text = $state('');
  let options = $state<PersonOption[]>([]);
  let searched = $state('');
  let other = $state<PersonOption | null>(null);
  let preview = $state<MergePreview | null>(null);
  let loading = $state(false);
  let failure = $state<string | null>(null);
  let choices = $state<MergeChoices>({});
  let merging = $state(false);

  // Each opening starts clean (or on the known other file).
  $effect(() => {
    if (!open) return;
    text = preset?.full_name ?? '';
    options = [];
    searched = '';
    other = null;
    preview = null;
    failure = null;
    choices = {};
    if (preset) void pick(preset);
  });

  // The space's directory, by name, as you type (the ⌘K's search).
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = text.trim();
    clearTimeout(timer);
    if (!open || q.length < 2 || q === other?.full_name) return;
    timer = setTimeout(async () => {
      try {
        const r = await fetchJSON<PaletteSearchResult>(
          `/api/search?q=${encodeURIComponent(q)}&workspace_ids=${encodeURIComponent(workspaceId)}`,
        );
        options = r.persons
          .filter((p) => p.person_id !== person.id && p.workspace_id === workspaceId)
          .map((p) => ({
            person_id: p.person_id,
            full_name: p.organization_name ? `${p.full_name} · ${p.organization_name}` : p.full_name,
          }));
        searched = q;
      } catch {
        options = [];
      }
    }, 200);
    return () => clearTimeout(timer);
  });

  let seq = 0;
  async function load(keep: string, drop: string, flipOnce: boolean): Promise<void> {
    const mine = ++seq;
    loading = true;
    failure = null;
    try {
      const body = await fetchJSON<{ preview: MergePreview }>(
        `/api/person-merges?workspace_id=${encodeURIComponent(workspaceId)}&keep=${keep}&drop=${drop}`,
      );
      if (mine !== seq) return;
      if (flipOnce && shouldFlip(body.preview)) return load(drop, keep, false);
      preview = body.preview;
      choices = {};
    } catch (err) {
      if (mine !== seq) return;
      preview = null;
      failure = refusalText(err);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  function pick(p: PersonOption) {
    other = p;
    void load(person.id, p.person_id, true);
  }

  function refusalText(err: unknown): string {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    if (err instanceof ApiError && err.status === 404) return t('person.merge_err_not_found', locale);
    if (code === 'same_person') return t('person.merge_err_same', locale);
    if (code === 'both_accounts') return t('person.merge_err_both_accounts', locale);
    return err instanceof Error ? err.message : t('perf.unexpected', locale);
  }

  // ── What the preview says ────────────────────────────────────────────
  let keepName = $derived(preview?.keep?.full_name ?? '');
  let dropName = $derived(preview?.drop.full_name ?? '');
  let toChoose = $derived<MergeField[]>(preview ? fieldsToChoose(preview) : []);
  let lost = $derived(preview ? lostEmail(preview, choices) : null);

  const FIELD_LABEL: Record<MergeField, () => string> = {
    full_name: () => t('person.field_name', locale),
    email: () => t('person.field_email', locale),
    phone: () => t('person.field_phone', locale),
  };

  /** One literal key per count, so the dictionaries guard sees them all. */
  const COUNT_LABEL: Record<keyof MergeCounts, (n: number) => string> = {
    cast: (n) => (n === 1 ? t('person.merge_n_cast_one', locale) : t('person.merge_n_cast', locale, { n })),
    overrides: (n) =>
      n === 1 ? t('person.merge_n_overrides_one', locale) : t('person.merge_n_overrides', locale, { n }),
    crew: (n) => (n === 1 ? t('person.merge_n_crew_one', locale) : t('person.merge_n_crew', locale, { n })),
    commitments: (n) =>
      n === 1 ? t('person.merge_n_commitments_one', locale) : t('person.merge_n_commitments', locale, { n }),
    availability: (n) =>
      n === 1 ? t('person.merge_n_availability_one', locale) : t('person.merge_n_availability', locale, { n }),
    conversations: (n) =>
      n === 1 ? t('person.merge_n_conversations_one', locale) : t('person.merge_n_conversations', locale, { n }),
    mailouts: (n) =>
      n === 1 ? t('person.merge_n_mailouts_one', locale) : t('person.merge_n_mailouts', locale, { n }),
    my_notes: (n) =>
      n === 1 ? t('person.merge_n_my_notes_one', locale) : t('person.merge_n_my_notes', locale, { n }),
  };

  let movesLine = $derived.by(() => {
    if (!preview) return '';
    const parts = countParts(preview.counts).map(({ key, n }) => COUNT_LABEL[key](n));
    return parts.length === 0
      ? t('person.merge_moves_none', locale)
      : t('person.merge_moves', locale, { name: keepName || dropName, list: parts.join(' · ') });
  });

  // «Se queda»: the two files by their ids (a swap reloads the preview).
  let keepId = $derived(preview?.keep_person_id ?? '');
  let keepOptions = $derived(
    preview && preview.keep
      ? [
          { value: preview.keep_person_id, label: preview.keep.full_name },
          { value: preview.drop_person_id, label: preview.drop.full_name },
        ]
      : [],
  );
  function chooseKeep(id: string) {
    if (!preview || id === preview.keep_person_id) return;
    void load(preview.drop_person_id, preview.keep_person_id, false);
  }

  function sideOptions(f: MergeField): { value: MergeSide; label: string }[] {
    if (!preview?.keep) return [];
    return [
      { value: 'keep', label: preview.keep[f] ?? '' },
      { value: 'drop', label: preview.drop[f] ?? '' },
    ];
  }

  async function confirm() {
    if (!preview || merging) return;
    merging = true;
    try {
      const body = await mutateJSON<{
        merge: { merge_id: string; keep_person_id: string; drop_person_id: string; keep_slug: string | null };
      }>('POST', '/api/person-merges', {
        workspace_id: workspaceId,
        keep_person_id: preview.keep_person_id,
        drop_person_id: preview.drop_person_id,
        fields: fieldsPayload(preview, choices),
        invitation_id: invitationId,
      });
      open = false;
      onmerged({ ...body!.merge, drop_name: dropName });
    } catch (err) {
      failure = `${t('person.merge_failed', locale)}: ${refusalText(err)}`;
    } finally {
      merging = false;
    }
  }
</script>

<Dialog bind:open title={t('person.merge_title', locale)} size="m">
  <p class="merge__hint">{t('person.merge_pick_hint', locale)}</p>
  <div class="merge__grid">
    <PersonPicker
      {options}
      {workspaceId}
      label={t('person.merge_pick', locale)}
      placeholder={t('person.merge_pick_ph', locale)}
      {locale}
      canCreate={false}
      bind:text
      onpick={pick}
    />
    {#if !other && searched && options.length === 0}
      <p class="merge__hint">{t('person.merge_no_match', locale)}</p>
    {/if}

    {#if preview}
      {#if canChooseKeep(preview)}
        <Segmented
          label={t('person.merge_stays', locale)}
          options={keepOptions}
          value={keepId}
          disabled={loading}
          onchange={chooseKeep}
        />
      {/if}
      {#each toChoose as f (f)}
        <Segmented
          label={FIELD_LABEL[f]()}
          options={sideOptions(f)}
          value={choices[f] ?? 'keep'}
          disabled={loading}
          onchange={(side) => (choices = { ...choices, [f]: side })}
        />
      {/each}
    {/if}
  </div>

  <div class="merge__say" aria-live="polite">
    {#if loading && !preview}
      <p class="merge__hint">{t('person.merge_loading', locale)}</p>
    {/if}
    {#if failure}
      <p class="merge__fail" role="alert">{failure}</p>
    {/if}
    {#if preview}
      {#if preview.keep_is_account}
        <p>{t('person.merge_account', locale, { name: keepName || dropName })}</p>
      {/if}
      <p class="merge__goes">{t('person.merge_goes', locale, { name: dropName })}</p>
      <p data-testid="merge-moves">{movesLine}</p>
      {#if hasConflicts(preview)}<p>{t('person.merge_conflicts', locale)}</p>{/if}
      {#if lost}<p class="merge__warn">{t('person.merge_email_lost', locale, { email: lost })}</p>{/if}
      <p class="merge__hint">{t('person.merge_undo_note', locale)}</p>
    {/if}
  </div>

  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={confirm} loading={merging} disabled={!preview || loading}>
      {t('person.merge_confirm', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .merge__grid {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }

    .merge__say {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-block-start: var(--space-m);
      font-size: var(--text-s);
      color: var(--text-color);
      line-height: 1.55;
    }

    .merge__say p,
    .merge__hint {
      margin: 0;
    }

    .merge__hint {
      font-size: var(--text-s);
      color: var(--text-muted);
      line-height: 1.55;
    }

    .merge__goes {
      color: var(--text-muted);
    }

    .merge__warn {
      color: var(--warning-dark);
    }

    .merge__fail {
      color: var(--danger);
    }
  }
</style>
