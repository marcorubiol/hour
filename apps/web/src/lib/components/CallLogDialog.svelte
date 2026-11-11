<script lang="ts">
  /**
   * «Apuntar llamada» desde la cabecera de Conversaciones (121 A, ADR-182):
   * apuntar una llamada desde el móvil sin buscar antes la conversación.
   *
   * 1. «¿Con quién?»: una búsqueda sobre las personas y las organizaciones
   *    de los espacios en pantalla, con tipo y lugar (ADR-177 § 2;
   *    `GET /api/conversations/call-targets`). Sin texto, con quién se ha
   *    hablado último. Las personas del equipo salen, pero no se eligen: una
   *    llamada interna no es una conversación (eso es el grupo del bolo).
   * 2. Qué se habló: el formulario de apuntar de siempre
   *    (`ContactLogFields`, el del cuadro de escribir: quién empezó y cuándo)
   *    y la nota. Con varias conversaciones, la última tocada, con
   *    el cambio a la vista. Sin ninguna, «¿De qué espectáculo?»: se abre una
   *    por el mismo `POST /api/conversations` que «Añadir conversación».
   *
   * Lo que se guarda es lo que apunta el cuadro de escribir (`contactEvent`),
   * por el mismo POST: cuenta para el turno igual. Espera el plazo de
   * «Deshacer» antes de escribirse (`$lib/call-log-pending`).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { onDestroy, tick } from 'svelte';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import ContactLogFields from '$lib/components/ContactLogFields.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { EVENT_BODY_MAX } from '$lib/conversation';
  import { LOCALE_TAG, t, type Locale } from '$lib/i18n';
  import { paletteSearchTerm } from '$lib/palette-search';
  import { activeProjectsQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import {
    callInFuture,
    callTargetConversations,
    callTargetWho,
    contactEvent,
    freshContactLog,
    type ContactLog,
    type CallTarget,
    type CallTargetsResponse,
  } from '$lib/call-log';
  import { commitCall, flushCall, holdCall } from '$lib/call-log-pending';

  interface Props {
    open?: boolean;
    /** Los espacios en pantalla: donde se busca. */
    workspaceIds: string[];
    locale: Locale;
  }

  let { open = $bindable(false), workspaceIds, locale }: Props = $props();

  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());

  // ── 1. ¿Con quién? ──────────────────────────────────────────────────────
  let text = $state('');
  let term = $state('');
  $effect(() => {
    const next = paletteSearchTerm(text);
    const timer = setTimeout(() => (term = next), 150);
    return () => clearTimeout(timer);
  });
  const targetsQuery = createQuery(
    toStore(() => ({
      queryKey: ['call-targets', term, workspaceIds] as const,
      enabled: open && workspaceIds.length > 0,
      staleTime: 30_000,
      // A search: nothing worth keeping on the device.
      meta: { persist: false },
      placeholderData: (prev: CallTargetsResponse | undefined) => prev,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<CallTargetsResponse>(
          `/api/conversations/call-targets?q=${encodeURIComponent(term)}&workspace_ids=${workspaceIds.join(',')}`,
          signal,
        ),
    })),
  );
  let persons = $derived($targetsQuery.data?.persons ?? []);
  let organizations = $derived($targetsQuery.data?.organizations ?? []);

  // ── 2. Qué se habló ─────────────────────────────────────────────────────
  let target = $state<CallTarget | null>(null);
  let conversationId = $state('');
  let projectId = $state('');
  /** Desde la lente se apunta una llamada (ADR-182, «+ → Llamada»). */
  let log = $state<ContactLog>(freshContactLog('call'));
  let note = $state('');
  let busy = $state(false);

  let who = $derived(target ? callTargetWho(target, locale) : null);
  let conversations = $derived(target?.conversations ?? []);
  let chosen = $derived(conversations.find((c) => c.id === conversationId) ?? null);
  /** Sin conversación: los espectáculos de su espacio, donde se abre una. */
  let projects = $derived(
    target && conversations.length === 0
      ? ($projectsQuery.data?.items ?? [])
          .filter((p) => p.workspace_id === target!.workspace_id)
          .map((p) => ({ value: p.id, label: p.name ?? p.slug }))
      : [],
  );
  let future = $derived(callInFuture(log));
  let ready = $derived(Boolean(target) && !busy && !future && (conversations.length > 0 ? Boolean(chosen) : Boolean(projectId)));

  /** Lo que el turno dirá después: la dirección es la palabra (como el cuadro de escribir). */
  let after = $derived(
    t(log.direction === 'outbound' ? 'overview.turn_theirs_cap' : 'overview.turn_ours_cap', locale).toLocaleLowerCase(LOCALE_TAG[locale]),
  );

  let searchEl = $state<HTMLElement>();

  // Open fresh every time: what a cancelled call left never rides into the next.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      text = '';
      term = '';
      target = null;
    }
    wasOpen = open;
  });

  function pick(next: CallTarget) {
    if (next.team) return;
    target = next;
    // La última tocada (el servidor ya las da en ese orden).
    conversationId = next.conversations[0]?.id ?? '';
    log = freshContactLog('call');
    note = '';
    projectId = '';
  }
  // Un solo espectáculo en su espacio: ya está elegido.
  $effect(() => {
    if (projects.length === 1 && !projectId) projectId = projects[0]!.value;
  });

  function back() {
    target = null;
    void tick().then(() => searchEl?.querySelector('input')?.focus());
  }

  function hrefOf(workspaceId: string, id: string): string | null {
    const slug = ($workspacesQuery.data?.items ?? []).find((w) => w.id === workspaceId)?.slug;
    return slug ? `/h/${slug}/conversation/${id}` : null;
  }

  function refresh(id: string) {
    void refreshAfterWrite(queryClient, ['conversations']);
    void refreshAfterWrite(queryClient, ['conversation-events', id]);
    void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['call-targets'] });
  }

  /** Sin conversación: se abre por el alta de siempre. Si ya había una que no se veía, esa. */
  async function openConversation(t0: CallTarget): Promise<{ id: string; created: boolean }> {
    const body =
      t0.kind === 'person' ? { project_id: projectId, person_id: t0.id } : { project_id: projectId, organization_id: t0.id };
    try {
      const data = await mutateJSON<{ conversation?: { id?: string } }>('POST', '/api/conversations', body);
      const id = data?.conversation?.id;
      if (!id) throw new Error(t('perf.unexpected', locale));
      return { id, created: true };
    } catch (err) {
      const clash = err instanceof ApiError && err.status === 409 ? err.body?.conversation_id : null;
      if (typeof clash === 'string') return { id: clash, created: false };
      throw err;
    }
  }

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    const t0 = target;
    if (!t0 || !ready) return;
    busy = true;
    try {
      const { id, created } = chosen ? { id: chosen.id, created: false } : await openConversation(t0);
      open = false;
      await holdCall({
        conversationId: id,
        event: contactEvent(log, note),
        created,
        name: t0.name,
        href: hrefOf(t0.workspace_id, id),
        locale,
        refresh,
      });
      if (created) refresh(id);
    } catch (err) {
      addToast({
        tone: 'danger',
        title: t('conversations.not_recorded', locale),
        message: t('perf.try_again', locale, { error: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
      });
    } finally {
      busy = false;
    }
  }

  let formEl = $state<HTMLFormElement>();

  // Leaving the lens writes what is pending.
  onDestroy(() => void commitCall());
</script>

<svelte:window onpagehide={flushCall} />

<Dialog
  bind:open
  title={target ? t('call.title_with', locale, { name: target.name }) : t('call.who', locale)}
  size="m"
>
  {#if !target}
    <div class="call__search" bind:this={searchEl}>
      <Input
        type="search"
        label={t('call.search_label', locale)}
        placeholder={t('call.search_ph', locale)}
        bind:value={text}
        autocomplete="off"
      />
    </div>
    {#snippet group(label: string, rows: CallTarget[])}
      {#if rows.length > 0}
        <p class="eyebrow eyebrow--sub call__group">{label}</p>
        <ul class="call__rows" role="list">
          {#each rows as row (`${row.kind}:${row.workspace_id}:${row.id}`)}
            {@const w = callTargetWho(row, locale)}
            <li>
              <button
                type="button"
                class="call__row"
                class:call__row--team={row.team}
                aria-disabled={row.team || undefined}
                data-testid="call-target"
                onclick={() => pick(row)}
              >
                <ChatMonogram name={row.name} shape={w.shape} />
                <span class="call__text">
                  <span class="call__name">{row.name}{#if w.words.length > 0}<span class="call__words"> · {w.words.join(' · ')}</span>{/if}</span>
                  <span class="call__ctx">{callTargetConversations(row, locale)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
    {@render group(t('call.persons', locale), persons)}
    {@render group(t('call.organizations', locale), organizations)}
    {#if $targetsQuery.isSuccess && persons.length === 0 && organizations.length === 0}
      <p class="call__hint">{term ? t('call.nobody', locale) : t('call.nobody_recent', locale)}</p>
    {:else if !term}
      <p class="call__hint">{t('call.recent_hint', locale)}</p>
    {/if}
  {:else}
    <form class="call__what" bind:this={formEl} onsubmit={save}>
      <div class="call__head">
        <ChatMonogram name={target.name} shape={who?.shape} />
        <span class="call__sub">
          {[...(who?.words ?? []), ...(chosen?.project_name && conversations.length === 1 ? [chosen.project_name] : [])].join(' · ')}
        </span>
      </div>

      {#if conversations.length > 1}
        <!-- La última tocada, con el cambio a la vista. -->
        {@const options = conversations.map((c) => ({ value: c.id, label: c.project_name ?? t('conversations.conversation', locale) }))}
        {#if options.length <= 3}
          <Segmented label={t('call.which', locale)} {options} bind:value={conversationId} />
        {:else}
          <Select label={t('call.which', locale)} {options} bind:value={conversationId} />
        {/if}
      {:else if conversations.length === 0}
        <p class="call__new" role="status">{t('call.opens', locale, { name: target.name })}</p>
        {#if projects.length === 0}
          <p class="call__hint">{t('call.no_projects', locale)}</p>
        {:else if projects.length <= 3}
          <Segmented label={t('call.project', locale)} options={projects} bind:value={projectId} />
        {:else}
          <Select label={t('call.project', locale)} options={[{ value: '', label: '' }, ...projects]} bind:value={projectId} />
        {/if}
      {/if}

      <ContactLogFields bind:log kinds={['call']} them={target.kind === 'person' ? target.name.split(/\s+/)[0] || null : target.name} {future} {locale} />

      <Textarea label={t('call.note', locale)} placeholder={t('thread.log_placeholder', locale)} bind:value={note} rows={3} maxlength={EVENT_BODY_MAX} />
      <p class="call__reads">{t('thread.log_reads', locale)}</p>
      {#if !log.edited}<p class="call__hint">{t('call.after', locale, { turn: after })}</p>{/if}
      <button type="submit" hidden aria-hidden="true"></button>
    </form>
  {/if}

  {#snippet lead()}
    {#if target}<Button variant="quiet" onclick={back}>{t('call.back', locale)}</Button>{/if}
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    {#if target}
      <Button onclick={() => formEl?.requestSubmit()} loading={busy} disabled={!ready}>
        {conversations.length === 0 ? t('call.open_and_save', locale) : t('thread.log_send_call', locale)}
      </Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  @layer components {
    .call__group {
      margin-block: var(--space-m) var(--space-2xs);
    }
    .call__rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .call__row {
      display: flex;
      gap: var(--space-s);
      align-items: center;
      inline-size: 100%;
      padding: var(--space-xs) var(--space-2xs);
      border: 0;
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      border-radius: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .call__row:hover:not(.call__row--team) {
      background: var(--bg-hover);
    }
    /* Del equipo: sale, para que nadie lo busque en vano, pero no se elige. */
    .call__row--team {
      cursor: default;
      color: var(--text-muted);
    }
    .call__text {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }
    .call__name {
      font-weight: 500;
    }
    .call__words {
      color: var(--text-muted);
      font-weight: 400;
    }
    .call__ctx,
    .call__hint,
    .call__sub,
    .call__reads {
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .call__hint {
      margin: var(--space-s) 0 0;
    }
    .call__what {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .call__head {
      display: flex;
      gap: var(--space-s);
      align-items: center;
    }
    .call__new {
      padding: var(--space-xs) var(--space-s);
      border-radius: var(--radius-m);
      background: var(--tone-warning-bg);
      color: var(--tone-warning-fg);
      font-size: var(--text-s);
    }
    .call__reads {
      margin: 0;
    }
    .call__what .call__hint {
      margin: 0;
    }
  }
</style>
