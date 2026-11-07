<script lang="ts">
  /**
   * «Importar chat» (tarea 128, ADR-189): el «Exportar chat» de WhatsApp,
   * .zip o .txt, desde la cabecera de Conversaciones o el atajo «Mandar a
   * Hour» del iPhone (`?importar`).
   *
   * 1. Soltar o elegir el archivo. Se lee aquí (`$lib/whatsapp-export`); a
   *    Hour sólo viajan las huellas para saber qué ya está, y al final lo que
   *    se confirma.
   * 2. Quién es quién: cada autor con su persona (por número, luego por
   *    nombre), y cuál eres tú. Un grupo se ata a un bolo, a una conversación
   *    o va mensaje a mensaje.
   * 3. Dónde va: las tandas con la propuesta del ADR-188 (un candidato, la más
   *    reciente como suposición, sin sitio), por sitio, cada una movible. Lo
   *    que no tiene sitio no entra salvo que se marque.
   * Importar espera el plazo de «Deshacer» (`$lib/wa-import-pending`).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { onDestroy } from 'svelte';
  import { mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Select from '$lib/components/Select.svelte';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { localeDayMonth } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import {
    attachmentKey,
    chatTitleFromFilename,
    orderHint,
    parseWhatsAppExport,
    type DateOrder,
    type ParsedExport,
  } from '$lib/whatsapp-export';
  import { chatFromZip } from '$lib/zip-read';
  import {
    boloBindingUntil,
    fingerprints,
    guessSelf,
    localToInstant,
    matchAuthor,
    payloadOf,
    planBursts,
    siteKey,
    summarize,
    type Binding,
    type ImportContext,
    type ImportRequest,
    type PlannedBurst,
    type PreparedMessage,
    type Site,
  } from '$lib/wa-import';
  import { commitImport, holdImport } from '$lib/wa-import-pending';

  interface Props {
    open?: boolean;
    /** Los espacios en pantalla: a cuál va el chat. */
    workspaceIds: string[];
    locale: Locale;
  }

  let { open = $bindable(false), workspaceIds, locale }: Props = $props();

  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());

  // ── 1. El archivo ───────────────────────────────────────────────────────
  let fileName = $state('');
  let text = $state('');
  let readError = $state('');
  let reading = $state(false);
  let dragging = $state(false);
  let order = $state<DateOrder | null>(null);
  let inputEl = $state<HTMLInputElement>();

  let parsed = $derived<ParsedExport | null>(
    text ? parseWhatsAppExport(text, { hint: orderHint(globalThis.navigator?.language), ...(order ? { order } : {}) }) : null,
  );
  let title = $derived(chatTitleFromFilename(fileName));

  async function readFile(file: File) {
    readError = '';
    reading = true;
    order = null;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      const raw = isZip ? (await chatFromZip(buf)).text : new TextDecoder().decode(buf);
      const p = parseWhatsAppExport(raw);
      if (p.messages.length === 0) {
        readError = t('wa_import.not_a_chat', locale);
        return;
      }
      fileName = file.name;
      text = raw;
    } catch {
      readError = t('wa_import.not_a_chat', locale);
    } finally {
      reading = false;
    }
  }

  function onPick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) void readFile(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void readFile(f);
  }

  // ── Las huellas, en el dispositivo ───────────────────────────────────────
  let prepared = $state<PreparedMessage[]>([]);
  $effect(() => {
    const p = parsed;
    if (!p) {
      prepared = [];
      return;
    }
    let live = true;
    const base = p.messages.map((m) => ({ ...m, at: localToInstant(m.local) }));
    void fingerprints(base).then((fps) => {
      if (live) prepared = base.map((m, i) => ({ ...m, fp: fps[i].fp, n: fps[i].n, known: false }));
    });
    return () => {
      live = false;
    };
  });

  // ── El espacio ──────────────────────────────────────────────────────────
  let workspaces = $derived(($workspacesQuery.data?.items ?? []).filter((w) => workspaceIds.includes(w.id)));
  let workspaceId = $state('');
  $effect(() => {
    if (!workspaceId && workspaces.length > 0) workspaceId = workspaces[0].id;
  });

  // ── Lo que Hour sabe ────────────────────────────────────────────────────
  let ctx = $state<ImportContext | null>(null);
  let ctxError = $state(false);
  $effect(() => {
    const fps = prepared.map((m) => m.fp);
    const ws = workspaceId;
    if (!open || fps.length === 0 || !ws) return;
    let live = true;
    ctx = null;
    ctxError = false;
    mutateJSON<ImportContext>('POST', '/api/whatsapp/import-context', { workspace_id: ws, fingerprints: fps })
      .then((c) => {
        if (live) ctx = c;
      })
      .catch(() => {
        if (live) ctxError = true;
      });
    return () => {
      live = false;
    };
  });

  let known = $derived(new Set(ctx?.known ?? []));
  let messages = $derived(prepared.map((m) => ({ ...m, known: known.has(m.fp) })));
  let fresh = $derived(messages.filter((m) => !m.known).length);
  /** El mismo chat importado antes: su quién es quién y su atadura. */
  let ownChat = $derived(ctx?.chats[0] ?? null);

  // ── 2. Quién es quién ───────────────────────────────────────────────────
  let people = $state<Record<string, string>>({});
  let selfLabel = $state('');
  let kind = $state<'direct' | 'group'>('direct');
  let bindKind = $state<'bolo' | 'conversation' | 'none'>('none');
  let bindId = $state('');

  // Al llegar lo que Hour sabe: lo recordado manda, si no, número y nombre.
  let seeded = '';
  $effect(() => {
    const p = parsed;
    const c = ctx;
    if (!p || !c) return;
    const key = `${fileName}|${p.authors.join(',')}|${c.known.length}`;
    if (key === seeded) return;
    seeded = key;
    const remembered = new Map((ownChat?.members ?? []).map((m) => [m.label, m]));
    const next: Record<string, string> = {};
    for (const a of p.authors) {
      const r = remembered.get(a);
      next[a] = r ? (r.person_id ?? '') : (matchAuthor(a, c.persons).person_id ?? '');
    }
    people = next;
    selfLabel = [...remembered.values()].find((m) => m.is_self)?.label ?? guessSelf(p.authors, c.me.name) ?? '';
    kind = ownChat?.kind ?? (p.group ? 'group' : 'direct');
    if (ownChat?.bound_bolo_id) [bindKind, bindId] = ['bolo', ownChat.bound_bolo_id];
    else if (ownChat?.bound_conversation_id) [bindKind, bindId] = ['conversation', ownChat.bound_conversation_id];
    else [bindKind, bindId] = ['none', ''];
  });

  let personName = $derived(new Map((ctx?.persons ?? []).map((p) => [p.person_id, p.name])));
  let personOptions = $derived([
    { value: '', label: t('wa_import.nobody', locale) },
    ...(ctx?.persons ?? []).map((p) => ({ value: p.person_id, label: p.name })),
  ]);
  let others = $derived((parsed?.authors ?? []).filter((a) => a !== selfLabel));
  /** Un chat 1 a 1: la otra persona tiene que ser alguien, y no del equipo. */
  let teamChat = $derived(kind === 'direct' && others.some((a) => ctx?.persons.find((p) => p.person_id === people[a])?.team));
  let unnamed = $derived(kind === 'direct' && others.some((a) => !people[a]));

  let firstDay = $derived(messages[0]?.local.slice(0, 10) ?? '');
  let lastDay = $derived(messages.at(-1)?.local.slice(0, 10) ?? '');

  /** Los bolos para atar un grupo: los que se cruzan con las fechas del chat, primero el que su nombre nombra. */
  let rankedBolos = $derived.by(() => {
    const words = (title ?? '').toLowerCase();
    return (ctx?.bolos ?? [])
      .filter((b) => !b.last_day || !firstDay || b.last_day >= firstDay)
      .map((b) => ({
        b,
        named: [b.city, b.venue_name].some((x) => x && words.includes(x.toLowerCase())),
      }))
      .sort((x, y) => Number(y.named) - Number(x.named) || (x.b.first_day ?? '').localeCompare(y.b.first_day ?? ''));
  });
  let boloOptions = $derived(
    rankedBolos.map(({ b }) => ({
      value: b.id,
      label: [b.venue_name ?? b.city, b.first_day ? localeDayMonth(b.first_day, locale) : null, b.project_name].filter(Boolean).join(' · '),
    })),
  );
  /** El bolo que el nombre del grupo nombra (sala o ciudad): la propuesta para atarlo. */
  let namedBolo = $derived(rankedBolos[0]?.named ? rankedBolos[0].b.id : null);
  /** Quien importa ya eligió cómo va el grupo: la propuesta no lo pisa. */
  let bindTouched = $state(false);
  $effect(() => {
    if (kind === 'group' && !bindTouched && bindKind === 'none' && !ownChat && namedBolo) [bindKind, bindId] = ['bolo', namedBolo];
  });
  let conversationOptions = $derived(
    (ctx?.conversations ?? [])
      .map((c) => ({ value: c.id, label: c.project_name ? `${c.title} · ${c.project_name}` : c.title }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  // Un grupo que se ata a un bolo: el primero de la lista (el que su nombre nombra).
  $effect(() => {
    if (kind === 'group' && bindKind === 'bolo' && !bindId && boloOptions.length > 0) bindId = boloOptions[0].value;
    if (bindKind === 'conversation' && !bindId && conversationOptions.length > 0) bindId = conversationOptions[0].value;
  });

  let binding = $derived.by((): Binding => {
    if (kind !== 'group' || !bindId) return null;
    if (bindKind === 'bolo') {
      const b = ctx?.bolos.find((x) => x.id === bindId);
      return b ? { kind: 'bolo', id: b.id, until: boloBindingUntil(b) } : null;
    }
    if (bindKind === 'conversation') return { kind: 'conversation', id: bindId };
    return null;
  });

  // ── 3. Dónde va ─────────────────────────────────────────────────────────
  /** Lo que quien importa cambió por tanda. */
  let overrides = $state<Record<number, { site?: Site; include?: boolean }>>({});
  let proposed = $derived.by(() => {
    if (!ctx || messages.length === 0) return [];
    const labels = new Map((parsed?.authors ?? []).map((a) => [a, people[a] || null]));
    return planBursts(messages, labels, selfLabel || null, binding, ctx);
  });
  let plan = $derived<PlannedBurst[]>(
    proposed.map((b) => {
      const o = overrides[b.index];
      if (!o) return b;
      const site = o.site ?? b.site;
      const moved = siteKey(site) !== siteKey(b.proposal.site);
      return { ...b, site, guess: moved ? false : b.guess, include: o.include ?? (o.site ? site.kind !== 'none' : b.include) };
    }),
  );
  let summary = $derived(summarize(plan));
  let openSite = $state<string | null>(null);
  let toSend = $derived(plan.filter((b) => b.include).reduce((n, b) => n + b.fresh, 0));

  function siteLabel(site: Site): string {
    if (site.kind === 'none') return t('wa_import.no_site', locale);
    if (site.kind === 'bolo') return boloOptions.find((o) => o.value === site.id)?.label ?? t('wa_import.bolo_board', locale);
    return conversationOptions.find((o) => o.value === site.id)?.label ?? '?';
  }
  let siteOptions = $derived([
    ...conversationOptions.map((o) => ({ value: `conversation:${o.value}`, label: o.label })),
    ...(binding?.kind === 'bolo' ? [{ value: `bolo:${binding.id}`, label: `${t('wa_import.bolo_board', locale)} · ${siteLabel({ kind: 'bolo', id: binding.id })}` }] : []),
    { value: 'none', label: t('wa_import.no_site', locale) },
  ]);
  function parseSite(v: string): Site {
    if (v === 'none') return { kind: 'none' };
    const [k, id] = v.split(':');
    return k === 'bolo' ? { kind: 'bolo', id } : { kind: 'conversation', id };
  }
  function moveBurst(b: PlannedBurst, value: string) {
    overrides = { ...overrides, [b.index]: { site: parseSite(value) } };
  }
  function toggleBurst(b: PlannedBurst, include: boolean) {
    overrides = { ...overrides, [b.index]: { ...overrides[b.index], include } };
  }
  function toggleSite(key: string, include: boolean) {
    const next = { ...overrides };
    for (const b of plan) {
      if (siteKey(b.site) + (b.guess ? ':guess' : '') === key) next[b.index] = { ...next[b.index], include };
    }
    overrides = next;
  }

  /** La primera línea de una tanda, para reconocerla. */
  function burstPreview(b: PlannedBurst): string {
    const m = b.messages.find((x) => x.body) ?? b.messages[0];
    const s = m.body || (m.attachments[0] ? t(attachmentKey(m.attachments[0].type), locale) : '');
    return s.length > 90 ? `${s.slice(0, 89)}…` : s;
  }

  let ready = $derived(Boolean(ctx) && !teamChat && !unnamed && toSend > 0 && Boolean(workspaceId));

  function reset() {
    fileName = '';
    text = '';
    readError = '';
    order = null;
    ctx = null;
    overrides = {};
    openSite = null;
    seeded = '';
    bindTouched = false;
    if (inputEl) inputEl.value = '';
  }

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) reset();
    wasOpen = open;
  });

  async function save() {
    if (!ready || !parsed || !ctx) return;
    const authors = parsed.authors;
    const request: ImportRequest = {
      workspace_id: workspaceId,
      chat: {
        id: ownChat?.id ?? null,
        kind,
        title: title ?? (kind === 'direct' ? (personName.get(people[others[0]]) ?? others[0] ?? null) : null),
        bound_bolo_id: binding?.kind === 'bolo' ? binding.id : null,
        bound_conversation_id: binding?.kind === 'conversation' ? binding.id : null,
        bound_until: binding?.kind === 'bolo' ? binding.until : null,
      },
      members: authors.map((a) => ({
        label: a,
        person_id: people[a] || null,
        name: (people[a] && personName.get(people[a])) || a,
        is_self: a === selfLabel,
      })),
      messages: payloadOf(plan, ctx.bolos),
    };
    open = false;
    await holdImport({
      request,
      count: request.messages.length,
      locale,
      refresh: (ids) => {
        void refreshAfterWrite(queryClient, ['conversations']);
        void refreshAfterWrite(queryClient, ['conversation-feed']);
        for (const id of ids) void refreshAfterWrite(queryClient, ['conversation-events', id]);
        void refreshAfterWrite(queryClient, ['bolo-chat']);
      },
    });
  }

  // Salir de la lente escribe lo que esperaba.
  onDestroy(() => void commitImport());
</script>

<Dialog bind:open title={parsed ? (title ? t('wa_import.title_with', locale, { name: title }) : t('wa_import.title', locale)) : t('wa_import.title', locale)} size="m">
  {#if !parsed}
    <div
      class="wai__drop"
      class:wai__drop--over={dragging}
      role="region"
      aria-label={t('wa_import.drop', locale)}
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      data-testid="wa-import-drop"
    >
      <strong>{t('wa_import.drop', locale)}</strong>
      <span>{t('wa_import.drop_kinds', locale)}</span>
      <Button variant="secondary" onclick={() => inputEl?.click()} loading={reading}>{t('wa_import.pick', locale)}</Button>
      <input
        bind:this={inputEl}
        class="wai__file"
        type="file"
        accept=".zip,.txt,application/zip,text/plain"
        onchange={onPick}
        data-testid="wa-import-file"
      />
    </div>
    {#if readError}<p class="wai__error" role="alert">{readError}</p>{/if}
    <p class="wai__hint">{t('wa_import.local_only', locale)}</p>
    <p class="wai__hint">{t('wa_import.how', locale)}</p>
  {:else}
    <div class="wai__sum" data-testid="wa-import-summary">
      <span class="wai__count">{t('wa_import.count', locale, { n: parsed.messages.length, people: parsed.authors.length })}</span>
      <span class="wai__meta">
        {t('wa_import.range', locale, { from: firstDay ? localeDayMonth(firstDay, locale) : '', to: lastDay ? localeDayMonth(lastDay, locale) : '' })}
        · {parsed.platform === 'ios' ? 'iPhone' : 'Android'}
      </span>
    </div>

    {#if parsed.ambiguous || order}
      <Segmented
        label={t('wa_import.order', locale)}
        options={[
          { value: 'dmy', label: t('wa_import.order_dmy', locale) },
          { value: 'mdy', label: t('wa_import.order_mdy', locale) },
        ]}
        value={parsed.order === 'mdy' ? 'mdy' : 'dmy'}
        onchange={(v) => (order = v)}
      />
    {/if}

    {#if workspaces.length > 1}
      <Select label={t('wa_import.workspace', locale)} options={workspaces.map((w) => ({ value: w.id, label: w.name }))} bind:value={workspaceId} />
    {/if}

    {#if ctxError}
      <p class="wai__error" role="alert">{t('wa_import.context_failed', locale)}</p>
    {:else if !ctx}
      <p class="wai__hint">{t('conversations.loading', locale)}</p>
    {:else}
      {#if fresh < messages.length}
        <p class="wai__hint" data-testid="wa-import-known">{t('wa_import.known', locale, { known: messages.length - fresh, fresh })}</p>
      {/if}

      <h3 class="wai__h">{t('wa_import.who', locale)}</h3>
      <Select
        label={t('wa_import.you', locale)}
        options={[{ value: '', label: t('wa_import.you_none', locale) }, ...parsed.authors.map((a) => ({ value: a, label: a }))]}
        bind:value={selfLabel}
      />
      <ul class="wai__people">
        {#each others as a (a)}
          <li>
            <Select
              label={t('wa_import.in_chat', locale, { name: a })}
              options={personOptions}
              value={people[a] ?? ''}
              onchange={(e) => (people = { ...people, [a]: (e.currentTarget as HTMLSelectElement).value })}
            />
          </li>
        {/each}
      </ul>

      {#if teamChat}
        <p class="wai__error" role="alert" data-testid="wa-import-team">{t('wa_import.team_chat', locale)}</p>
      {:else if unnamed}
        <p class="wai__error" role="alert">{t('wa_import.unnamed', locale)}</p>
      {/if}

      {#if kind === 'group'}
        <h3 class="wai__h">{t('wa_import.group_what', locale)}</h3>
        <Segmented
          ariaLabel={t('wa_import.group_what', locale)}
          options={[
            { value: 'bolo', label: t('wa_import.bind_bolo', locale) },
            { value: 'conversation', label: t('wa_import.bind_conversation', locale) },
            { value: 'none', label: t('wa_import.bind_none', locale) },
          ]}
          bind:value={bindKind}
          onchange={() => {
            bindTouched = true;
            bindId = '';
            overrides = {};
          }}
        />
        {#if bindKind === 'bolo'}
          {#if boloOptions.length === 0}
            <p class="wai__hint">{t('wa_import.no_bolos', locale)}</p>
          {:else}
            <Select label={t('wa_import.bolo', locale)} options={boloOptions} bind:value={bindId} onchange={() => (overrides = {})} />
            <p class="wai__hint">{t('wa_import.bolo_reads', locale)}</p>
          {/if}
        {:else if bindKind === 'conversation'}
          <Select label={t('wa_import.conversation', locale)} options={conversationOptions} bind:value={bindId} onchange={() => (overrides = {})} />
        {/if}
      {/if}

      {#if !teamChat && !unnamed}
        <h3 class="wai__h">{t('wa_import.where', locale)}</h3>
        {#if summary.length === 0}
          <p class="wai__hint">{t('wa_import.nothing_new', locale)}</p>
        {/if}
        <ul class="wai__sites" data-testid="wa-import-sites">
          {#each summary as s (s.key)}
            <li class="wai__site" class:wai__site--guess={s.guess} class:wai__site--none={s.site.kind === 'none'}>
              <div class="wai__site-head">
                <Checkbox
                  ariaLabel={siteLabel(s.site)}
                  checked={s.include}
                  onchange={(e) => toggleSite(s.key, (e.currentTarget as HTMLInputElement).checked)}
                />
                <button type="button" class="wai__site-name" onclick={() => (openSite = openSite === s.key ? null : s.key)} aria-expanded={openSite === s.key}>
                  {siteLabel(s.site)}
                </button>
                <span class="wai__site-n">{t('wa_import.site_count', locale, { n: s.messages, bursts: s.bursts })}</span>
              </div>
              <p class="wai__site-why">
                {s.site.kind === 'none' ? t('wa_import.why_none', locale) : s.guess ? t('wa_import.why_guess', locale) : t('wa_import.why_placed', locale)}
              </p>
              {#if openSite === s.key}
                <ul class="wai__bursts">
                  {#each plan.filter((b) => siteKey(b.site) + (b.guess ? ':guess' : '') === s.key) as b (b.index)}
                    <li class="wai__burst">
                      <Checkbox
                        ariaLabel={burstPreview(b)}
                        checked={b.include}
                        onchange={(e) => toggleBurst(b, (e.currentTarget as HTMLInputElement).checked)}
                      />
                      <div class="wai__burst-text">
                        <span class="wai__meta">{localeDayMonth(b.messages[0].local.slice(0, 10), locale)} · {t('wa_import.burst_n', locale, { n: b.fresh })}</span>
                        <span>{burstPreview(b)}</span>
                      </div>
                      <Select ariaLabel={t('wa_import.move', locale)} options={siteOptions} value={siteKey(b.site)} onchange={(e) => moveBurst(b, (e.currentTarget as HTMLSelectElement).value)} />
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}

  {#snippet lead()}
    {#if parsed}<Button variant="quiet" onclick={reset}>{t('wa_import.other_file', locale)}</Button>{/if}
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    {#if parsed}
      <Button onclick={save} disabled={!ready}>{t('wa_import.import_n', locale, { n: toSend })}</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  @layer components {
    .wai__drop {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      align-items: center;
      padding: var(--space-xl) var(--space-m);
      border: var(--line-thin) dashed var(--border-color-dark);
      border-radius: var(--radius-m);
      color: var(--text-muted);
      text-align: center;
    }
    .wai__drop strong {
      color: var(--heading-color);
      font-weight: 500;
    }
    .wai__drop--over {
      background: var(--bg-hover);
    }
    .wai__file {
      display: none;
    }
    .wai__hint {
      margin: var(--space-xs) 0 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .wai__error {
      margin: var(--space-xs) 0 0;
      color: var(--warning-dark);
      font-size: var(--text-s);
    }
    .wai__sum {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-block-end: var(--space-s);
      padding: var(--space-s);
      background: var(--bg-light);
      border-radius: var(--radius-s);
    }
    .wai__count {
      color: var(--heading-color);
      font-weight: 500;
    }
    .wai__meta {
      color: var(--text-faint);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
    }
    .wai__h {
      margin: var(--space-m) 0 var(--space-xs);
      color: var(--text-faint);
      font-size: var(--text-xs);
      font-weight: 500;
      letter-spacing: var(--heading-letter-spacing);
      text-transform: uppercase;
    }
    .wai__people,
    .wai__sites,
    .wai__bursts {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .wai__people {
      margin-block-start: var(--space-xs);
    }
    .wai__site {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding: var(--space-xs) var(--space-s);
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-s);
    }
    /* Una suposición: entra, y «Por colocar» lo preguntará (ADR-188 § 5). */
    .wai__site--guess {
      background: var(--warning-ultra-light);
      border-color: transparent;
    }
    .wai__site--none {
      border-style: dashed;
    }
    .wai__site-head {
      display: flex;
      gap: var(--space-s);
      align-items: center;
    }
    .wai__site-name {
      flex: 1;
      min-inline-size: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--heading-color);
      font: inherit;
      font-weight: 500;
      text-align: start;
      cursor: pointer;
    }
    .wai__site-n {
      color: var(--text-faint);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .wai__site-why {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .wai__bursts {
      margin-block-start: var(--space-xs);
    }
    .wai__burst {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-s);
      align-items: start;
      padding-block: var(--space-xs);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .wai__burst > :global(:last-child) {
      grid-column: 2;
    }
    .wai__burst-text {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
  }
</style>
