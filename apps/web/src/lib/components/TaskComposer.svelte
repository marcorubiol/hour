<script lang="ts">
  /**
   * TaskComposer (ADR-068) — the one quick-add for tasks, shared by the Desk
   * and the Tasks line module (it replaces the two divergent inline forms).
   * Progressive disclosure: a calm one-liner ("Capture  add a loose end… ↵
   * drops into Anytime") — a mono lead mirroring the scope bar's "SCOPE" so
   * the composer reads as its twin — that expands on focus to expose the WHOLE task model the
   * schema already carries — due, defer (from_at), a lead window (lead_days)
   * and a single parent (space / project / line / show / conversation) — via
   * TargetPicker, which reuses the scope-bar glyph vocabulary.
   *
   * The right-hand hint is LIVE: it names the surface state the task will
   * land in (ADR-070) so the composer teaches the model while you fill it —
   * Anytime → due <date> → sleeps until <date>, plus "· into <where>".
   *
   * Owns the POST + cache invalidation so every host behaves identically;
   * the host passes the default target, any extra parents it already has
   * loaded, extra query keys to invalidate, and an onCreated hook.
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import TargetPicker from '$lib/components/TargetPicker.svelte';
  import { dayMonth } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { lineKindLabel } from '$lib/utils/line-kind';
  import { taskTargetFields, type TaskItem, type TaskTarget, type TaskTargetKind } from '$lib/task';

  interface EntityLite {
    id: string;
    name: string;
  }
  interface Props {
    locale: Locale;
    /** the default parent; also the ONLY parent when lockTarget is set */
    target: TaskTarget;
    /** the Tasks line module locks the parent to its line */
    lockTarget?: boolean;
    /** parents the host already has loaded (Desk) — passed to the picker */
    performances?: EntityLite[];
    conversations?: EntityLite[];
    /** query keys to invalidate on success, beyond ['tasks'] */
    invalidateKeys?: readonly (readonly unknown[])[];
    /** host hook after a create (e.g. the Desk out-of-scope toast) */
    onCreated?: (task: TaskItem) => void;
  }
  let {
    locale,
    target,
    lockTarget = false,
    performances = [],
    conversations = [],
    invalidateKeys = [],
    onCreated,
  }: Props = $props();

  const queryClient = useQueryClient();
  type TasksCache = { items: TaskItem[] };

  function cacheCreatedTask(key: readonly unknown[], task: TaskItem) {
    queryClient.setQueryData<TasksCache>(key, (current) =>
      current
        ? {
            ...current,
            items: [task, ...current.items.filter((item) => item.id !== task.id)],
          }
        : current,
    );
  }

  // Composer fields.
  let title = $state('');
  let note = $state('');
  let due = $state('');
  let from = $state('');
  let lead = $state('');
  let showNote = $state(false);

  // Target: follows the host default until the user picks one; a locked host
  // (the line module) always uses the default. Reset to default after a save.
  let userTarget = $state<TaskTarget | null>(null);
  let chosen = $derived(lockTarget ? target : (userTarget ?? target));

  // Disclosure is LATCHED (opened on focus, not collapsed on input blur) so a
  // click into the picker or a date field never unmounts the control under the
  // pointer. It closes only on save, or an outside click with nothing typed.
  let expanded = $state(false);
  let pickerOpen = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);
  let whereEl = $state<HTMLDivElement | null>(null);

  let dirty = $derived(!!title || !!note || !!due || !!from || !!lead || showNote);

  // Live hint — the surface state (ADR-070) this task will land in.
  let whenHint = $derived(
    due
      ? t('composer.hint_due', locale, { date: dayMonth(due) })
      : from
        ? t('composer.hint_defer', locale, { date: dayMonth(from) })
        : t('composer.hint_anytime', locale),
  );
  // Space is the neutral home (Anytime already implies it); name a non-space
  // parent so "where" is legible without expanding.
  let hint = $derived(
    lockTarget || chosen.kind === 'space'
      ? whenHint
      : `${whenHint} · ${t('composer.hint_into', locale, { name: chosen.name })}`,
  );

  const isGlyph = (k: TaskTargetKind) => k === 'space' || k === 'project' || k === 'line';
  let targetKindLabel = $derived(
    chosen.kind === 'line'
      ? lineKindLabel(chosen.lineKind ?? '')
      : t(`picker.kind_${chosen.kind}`, locale),
  );

  const addTask = createMutation({
    mutationFn: () =>
      mutateJSON<{ task: TaskItem }>('POST', '/api/tasks', {
        title: title.trim(),
        note: note.trim() || null,
        due_at: due || null,
        from_at: from || null,
        lead_days: lead ? Number(lead) : null,
        ...taskTargetFields(chosen),
      }),
    onSuccess: (res) => {
      title = '';
      note = '';
      due = '';
      from = '';
      lead = '';
      showNote = false;
      userTarget = null;
      expanded = false;
      pickerOpen = false;
      if (res) {
        // The 201 body is authoritative and already has the full TaskItem
        // shape. Publish it synchronously so the row cannot disappear behind
        // an asynchronous invalidation/refetch race.
        cacheCreatedTask(['tasks', 'open'], res.task);
        for (const key of invalidateKeys) cacheCreatedTask(key, res.task);
      }
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (res) onCreated?.(res.task);
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('composer.toast_fail_title', locale),
        message: err instanceof ApiError ? err.message : t('composer.toast_fail_msg', locale),
      }),
  });

  function submit() {
    if (!title.trim()) {
      addToast({
        tone: 'warning',
        title: t('composer.title_required_title', locale),
        message: t('composer.title_required_msg', locale),
      });
      return;
    }
    $addTask.mutate();
  }

  function selectTarget(tt: TaskTarget) {
    userTarget = tt;
    pickerOpen = false;
  }

  // Outside click: close the picker, and collapse the composer when nothing
  // has been typed (a WIP composer stays open). One listener, only while it
  // can act. Uses mousedown so it settles before the trigger's own click.
  $effect(() => {
    if (!expanded && !pickerOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerOpen && whereEl && !whereEl.contains(target)) pickerOpen = false;
      if (formEl && !formEl.contains(target) && !dirty) {
        expanded = false;
        pickerOpen = false;
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  });
</script>

<form
  class="tc"
  class:tc--expanded={expanded}
  bind:this={formEl}
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  <div class="tc__line">
    <span class="tc__cap" aria-hidden="true">Capture</span>
    <input
      class="tc__title"
      type="text"
      bind:value={title}
      placeholder={t('desk.capture_placeholder', locale)}
      aria-label={t('desk.capture_placeholder', locale)}
      onfocus={() => (expanded = true)}
    />
    {#if !expanded}
      <span class="tc__hint"><span class="tc__ret" aria-hidden="true">↵</span> {hint}</span>
    {/if}
  </div>

  {#if expanded}
    <div class="tc__controls">
      {#if !lockTarget}
        <div class="tc__where" bind:this={whereEl}>
          <button
            type="button"
            class="tc__target"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onclick={() => (pickerOpen = !pickerOpen)}
          >
            {#if isGlyph(chosen.kind)}
              <ScopeGlyph
                kind={chosen.kind as 'space' | 'project' | 'line'}
                accent={chosen.accent ?? 'var(--text-faint)'}
                lineKind={chosen.lineKind ?? ''}
              />
            {:else}
              <span class="tc__leaf" aria-hidden="true"></span>
            {/if}
            <span class="tc__target-kind">{targetKindLabel}</span>
            <span class="tc__target-name">{chosen.name}</span>
            <span class="tc__caret" aria-hidden="true">›</span>
          </button>
          {#if pickerOpen}
            <TargetPicker
              {locale}
              {performances}
              {conversations}
              onselect={selectTarget}
              onclose={() => (pickerOpen = false)}
            />
          {/if}
        </div>
      {/if}

      <label class="tc__field">
        <span class="tc__label">{t('composer.due', locale)}</span>
        <input type="date" bind:value={due} />
      </label>
      <label class="tc__field">
        <span class="tc__label">{t('composer.defer', locale)}</span>
        <input type="date" bind:value={from} />
      </label>
      {#if due}
        <label class="tc__field tc__field--lead">
          <span class="tc__label">{t('composer.lead', locale)}</span>
          <input type="number" min="0" max="365" inputmode="numeric" placeholder="—" bind:value={lead} />
          <span class="tc__unit">{t('composer.lead_unit', locale)}</span>
        </label>
      {/if}

      {#if showNote}
        <input
          class="tc__note"
          type="text"
          bind:value={note}
          placeholder={t('composer.note_placeholder', locale)}
          aria-label={t('composer.note', locale)}
        />
      {:else}
        <button type="button" class="tc__addnote" onclick={() => (showNote = true)}>
          + {t('composer.note', locale)}
        </button>
      {/if}

      <button type="submit" class="tc__add" disabled={$addTask.isPending}>
        {t('composer.add', locale)}
      </button>
    </div>
  {/if}
</form>

<style>
  @layer components {
    .tc {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block: var(--space-s);
      padding-inline: var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-l);
      transition: border-color var(--transition);
    }
    .tc--expanded {
      border-color: var(--text-muted);
    }

    /* ── The one line (collapsed = the whole composer) ── */
    .tc__line {
      display: flex;
      align-items: center;
      gap: var(--space-s);
    }
    /* Mono uppercase lead mirroring the scope bar's "SCOPE" — the composer
       reads as the scope bar's twin. */
    .tc__cap {
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tc__title {
      flex: 1;
      min-inline-size: 0;
      /* Reset the global text-input skin (base.css gives every text input
         padding-block: space-s) — otherwise it stacks on .tc's own padding
         and the collapsed bar reads twice as tall as the scope bar. */
      padding: 0;
      border: 0;
      outline: none;
      background: none;
      font-family: var(--font-sans);
      /* text-s: shares the scale of the scope bar's descriptor (a calm
         sibling, not the biggest text on the page). */
      font-size: var(--text-s);
      line-height: var(--text-line-height);
      color: var(--text-color);
    }
    .tc__title::placeholder {
      color: color-mix(in oklch, var(--text-faint) 70%, transparent);
    }
    .tc__hint {
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      white-space: nowrap;
    }
    .tc__ret {
      color: color-mix(in oklch, var(--text-faint) 75%, transparent);
    }

    /* ── Controls (expanded) ── */
    .tc__controls {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
    }

    .tc__where {
      position: relative;
    }
    .tc__target {
      --glyph: 12px;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
      padding-block: var(--space-2xs);
      padding-inline: var(--space-xs);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: var(--bg-light);
      cursor: pointer;
      font-family: inherit;
      color: var(--text-color);
      max-inline-size: 16rem;
    }
    .tc__target:disabled {
      cursor: default;
    }
    .tc__target:not(:disabled):hover {
      border-color: var(--text-muted);
    }
    .tc__leaf {
      flex: none;
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--text-faint);
      margin-inline: 0.22rem;
    }
    .tc__target-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tc__target-name {
      font-size: var(--text-s);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tc__caret {
      color: var(--text-faint);
      line-height: 1;
    }

    .tc__field {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .tc__label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .tc__field input {
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
      background: var(--bg-light);
      padding-block: var(--space-2xs);
      padding-inline: var(--space-xs);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .tc__field input:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -1px;
    }
    .tc__field--lead {
      gap: var(--space-2xs);
    }
    .tc__field--lead input {
      inline-size: 3.5rem;
    }
    .tc__unit {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .tc__note {
      flex: 1 1 12rem;
      min-inline-size: 0;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
      background: var(--bg-light);
      padding-block: var(--space-2xs);
      padding-inline: var(--space-xs);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .tc__addnote {
      border: 1px dashed var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: transparent;
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      transition: color var(--transition), border-color var(--transition);
    }
    .tc__addnote:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }

    .tc__add {
      margin-inline-start: auto;
      border: 0;
      border-radius: var(--radius-m);
      background: var(--text-color);
      color: var(--bg);
      padding-block: var(--space-xs);
      padding-inline: var(--space-l);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      cursor: pointer;
      transition: background var(--transition);
    }
    .tc__add:hover:not(:disabled) {
      background: var(--neutral-semi-dark);
    }
    .tc__add:disabled {
      opacity: 0.6;
      cursor: default;
    }

    @media (max-width: 47.999rem) {
      .tc__hint {
        display: none;
      }
      .tc__add {
        margin-inline-start: 0;
      }
    }
  }
</style>
