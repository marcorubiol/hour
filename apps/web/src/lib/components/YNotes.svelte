<script module lang="ts">
  export type CollabTarget = 'performance' | 'project' | 'line';
</script>

<script lang="ts">
  /**
   * YNotes — collaborative free-text notes over Yjs (ADR-025 / D-PRE-07).
   *
   * Transport (`$lib/collab-doc`, shared with the running order):
   * y-partyserver YProvider through the authenticated proxy at
   * /api/collab/<table>/<id> (the endpoint gates on membership + edit
   * permission via the httpOnly session cookie — same-origin WS upgrades
   * carry cookies, so no token rides the URL since Phase 0.9 — then
   * forwards to the RoadsheetCollab DO). Local mirror via y-indexeddb so
   * the doc survives reloads offline. The DO persists snapshots and
   * materializes the text back into the target's `notes` column for
   * non-collab readers.
   *
   * Presence (P10 simplified): peer count + a highlighted frame while
   * someone else is editing. No positional cursors (Phase 0.5).
   *
   * Textarea binding is deliberately plain: local input diffs against the
   * last seen text (common prefix/suffix) and applies delete+insert in one
   * transaction; remote updates rewrite the value with a best-effort caret
   * restore. Good for notes-sized text with ≤5 collaborators.
   */

  import { onMount } from 'svelte';
  import type YProvider from 'y-partyserver/provider';
  import { openCollabDoc } from '$lib/collab-doc';
  import { session } from '$lib/session.svelte';
  import { appLocale, t, type Locale } from '$lib/i18n';
  import { createQuery } from '@tanstack/svelte-query';
  import { meQueryOptions } from '$lib/nav-queries';
  import { userDisplayName } from '$lib/utils/identity';

  interface Props {
    targetTable: CollabTarget;
    targetId: string;
    placeholder?: string;
    rows?: number;
    /** The reader's language; defaults to the session's. */
    locale?: Locale;
  }

  let { targetTable, targetId, placeholder, rows = 5, locale = appLocale() }: Props = $props();

  let shownPlaceholder = $derived(placeholder ?? t('perf.notes_placeholder_short', locale));

  let el: HTMLTextAreaElement | undefined = $state();
  let status = $state<'connecting' | 'live' | 'offline'>('connecting');
  let peers = $state(0);
  let editingNames = $state<string[]>([]);

  // Presence label: the person's name (see userDisplayName), re-announced
  // when /api/me lands so peers never see the email handle for long.
  const meQuery = createQuery(meQueryOptions());
  let presence = $state.raw<YProvider['awareness'] | null>(null);
  let myName = $derived(
    userDisplayName($meQuery.data?.full_name, session.user?.name, session.user?.email) ||
      'someone',
  );
  $effect(() => {
    presence?.setLocalStateField('user', { name: myName });
  });

  onMount(() => {
    // Session gate — the layout's auth gate resolved before rendering us,
    // so the store is ready.
    if (!session.user) return;

    const collab = openCollabDoc(targetTable, targetId);
    const { doc, provider } = collab;
    const ytext = doc.getText('notes');

    let lastSeen = '';

    const pull = () => {
      const next = ytext.toString();
      if (next === lastSeen || !el) return;
      const hadFocus = document.activeElement === el;
      const caret = el.selectionStart ?? next.length;
      el.value = next;
      if (hadFocus) {
        const pos = Math.min(caret, next.length);
        el.setSelectionRange(pos, pos);
      }
      lastSeen = next;
    };

    const push = () => {
      if (!el) return;
      const next = el.value;
      const prev = lastSeen;
      if (next === prev) return;
      // Minimal common prefix/suffix diff → one delete + one insert.
      let start = 0;
      const minLen = Math.min(prev.length, next.length);
      while (start < minLen && prev[start] === next[start]) start++;
      let endPrev = prev.length;
      let endNext = next.length;
      while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
        endPrev--;
        endNext--;
      }
      doc.transact(() => {
        if (endPrev > start) ytext.delete(start, endPrev - start);
        if (endNext > start) ytext.insert(start, next.slice(start, endNext));
      }, 'local');
      lastSeen = next;
    };

    // The local mirror's load and the server's sync both arrive here as
    // remote transactions.
    ytext.observe((_event, txn) => {
      if (txn.origin !== 'local') pull();
    });
    provider.once('synced', pull);

    provider.on('status', ({ status: s }: { status: string }) => {
      status = s === 'connected' ? 'live' : 'offline';
    });

    const awareness = provider.awareness;
    presence = awareness;
    const onAwareness = () => {
      const others = [...awareness.getStates().entries()].filter(
        ([id]) => id !== awareness.clientID,
      );
      peers = others.length;
      editingNames = others
        .filter(([, s]) => (s as { editing?: boolean }).editing)
        .map(([, s]) => (s as { user?: { name?: string } }).user?.name ?? t('perf.someone', locale));
    };
    awareness.on('change', onAwareness);
    onAwareness();

    const input = () => push();
    const focus = () => awareness.setLocalStateField('editing', true);
    const blur = () => awareness.setLocalStateField('editing', false);
    el?.addEventListener('input', input);
    el?.addEventListener('focus', focus);
    el?.addEventListener('blur', blur);

    return () => {
      el?.removeEventListener('input', input);
      el?.removeEventListener('focus', focus);
      el?.removeEventListener('blur', blur);
      awareness.off('change', onAwareness);
      presence = null;
      collab.close();
    };
  });
</script>

<div class="ynotes" class:ynotes--remote={editingNames.length > 0} data-collab-status={status}>
  <div class="ynotes__meta">
    <span class="ynotes__dot" aria-hidden="true"></span>
    <span class="ynotes__status">
      {#if status === 'live'}
        {t('perf.notes_live', locale)}{#if peers > 0} · {t('perf.notes_here', locale, { n: peers + 1 })}{/if}
      {:else if status === 'offline'}
        {t('perf.notes_offline', locale)}
      {:else}
        {t('perf.notes_connecting', locale)}
      {/if}
    </span>
    {#if editingNames.length > 0}
      <span class="ynotes__editing">{t('perf.notes_editing', locale, { names: editingNames.join(', ') })}</span>
    {/if}
  </div>
  <textarea bind:this={el} {rows} placeholder={shownPlaceholder} aria-label={t('perf.notes', locale)}></textarea>
</div>

<style>
  @layer components {
    .ynotes {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .ynotes__meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .ynotes__dot {
      inline-size: 6px;
      block-size: 6px;
      border-radius: var(--radius-circle);
      background: var(--text-faint);
      align-self: center;
    }

    [data-collab-status='live'] .ynotes__dot {
      background: var(--success);
    }

    [data-collab-status='offline'] .ynotes__dot {
      background: var(--warning);
    }

    .ynotes__editing {
      color: var(--info);
    }

    /* Someone else has the field focused — highlighted frame (P10). */
    .ynotes--remote textarea {
      border-color: var(--info);
    }
  }
</style>
