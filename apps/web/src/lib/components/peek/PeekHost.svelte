<script lang="ts">
  /**
   * PeekHost: where the vistazo lives (ADR-139 p1 A), mounted once in the
   * shell. It draws what the address bar has open (`?peek=`, `$lib/peek`)
   * in the one frame (`Peek`), with the record its page draws, and it
   * catches the links that should open a peek instead of leaving the lens.
   *
   * THE LINKS STAY LINKS. Every lens already points at a performance, a
   * conversation or a person with a plain `<a href>` to its page, so the
   * vistazo is a reading of the click, not a new prop on forty components:
   * a plain click on such a link, from a lens or from inside the panel,
   * opens the peek; a ⌘-click, a middle click or «abrir completa» still
   * opens the page. A bolo's row in Cuentas and a date have no page, so
   * their links peek from anywhere. A link marked `data-peek="off"` is left
   * alone. The listener sits on <body>: after every component's own click
   * (Svelte delegates to the app root, inside it) and before SvelteKit's
   * router (on <html>), which steps aside on a prevented click.
   */
  import { onMount } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { activeProjectsQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { usePins } from '$lib/stores/pins.svelte';
  import { fullHref, peekFromLink, peekOpensFrom, formatPeek, type PeekTarget } from '$lib/peek';
  import { closePeek, currentPeek, openPeek } from '$lib/peek.svelte';
  import { appLocale, t } from '$lib/i18n';
  import Peek from './Peek.svelte';
  import DateRecord from '$lib/components/record/DateRecord.svelte';
  import BoloRecord from '$lib/components/record/BoloRecord.svelte';
  import PerformanceRecord from '$lib/components/record/PerformanceRecord.svelte';
  import ConversationRecord from '$lib/components/record/ConversationRecord.svelte';
  import PersonRecord from '$lib/components/record/PersonRecord.svelte';

  const locale = appLocale();

  let target = $derived(currentPeek());
  let key = $derived(target ? formatPeek(target) : '');

  const KIND_WORD: Record<PeekTarget['kind'], string> = {
    date: 'peek.kind_date',
    bolo: 'peek.kind_bolo',
    performance: 'peek.kind_performance',
    conversation: 'peek.kind_conversation',
    person: 'peek.kind_person',
  };

  // A bolo's «Abrir en Cuentas» keeps your scope when it already shows the
  // project (`booksHref`): the shell has both caches warm.
  const pins = usePins();
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const wsQuery = createQuery(workspacesQueryOptions());
  function spaceOfProject(projectId: string): string | null {
    const p = ($projectsQuery.data?.items ?? []).find((x) => x.id === projectId);
    return (p && ($wsQuery.data?.items ?? []).find((w) => w.id === p.workspace_id)?.slug) || null;
  }

  let label = $derived(target ? t('peek.label', locale, { kind: t(KIND_WORD[target.kind], locale) }) : '');
  let full = $derived.by(() => {
    if (!target) return null;
    const here = target.kind === 'bolo' ? { pins: pins.pins, workspaceSlug: spaceOfProject(target.projectId) } : undefined;
    const href = fullHref(target, here);
    if (!href) return null;
    return { href, label: t(target.kind === 'bolo' ? 'peek.open_books' : 'peek.open_full', locale) };
  });

  /** A plain left click, on a link this page would otherwise follow. */
  function onBodyClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const el = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(el instanceof HTMLAnchorElement)) return;
    if (el.hasAttribute('download') || (el.target && el.target !== '_self')) return;
    if (el.closest('[data-peek="off"]')) return;
    const here = new URL(location.href);
    const next = peekFromLink(new URL(el.href, here), here);
    if (!next || !peekOpensFrom(next, here.pathname, Boolean(el.closest('.peek')))) return;
    event.preventDefault();
    openPeek(next);
  }

  onMount(() => {
    document.body.addEventListener('click', onBodyClick);
    return () => document.body.removeEventListener('click', onBodyClick);
  });
</script>

<Peek open={Boolean(target)} {label} {full} contentKey={key} onclose={closePeek}>
  {#key key}
    {#if target?.kind === 'date'}
      <DateRecord id={target.id} />
    {:else if target?.kind === 'bolo'}
      <BoloRecord projectId={target.projectId} id={target.id} />
    {:else if target?.kind === 'performance'}
      <PerformanceRecord workspaceSlug={target.ws} slug={target.slug} inPeek />
    {:else if target?.kind === 'conversation'}
      <ConversationRecord workspaceSlug={target.ws} slug={target.slug} inPeek />
    {:else if target?.kind === 'person'}
      <PersonRecord workspaceSlug={target.ws} slug={target.slug} inPeek />
    {/if}
  {/key}
</Peek>
