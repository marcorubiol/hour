<script module lang="ts">
  export type CollabTarget = 'performance' | 'project' | 'line';
</script>

<script lang="ts">
  /**
   * YNotes — collaborative free-text notes over Yjs (ADR-025 / D-PRE-07).
   *
   * Transport: y-partyserver YProvider through the authenticated proxy at
   * /api/collab/<table>/<id>?token=<jwt> (the endpoint gates on membership
   * + edit permission, then forwards to the RoadsheetCollab DO). Local
   * mirror via y-indexeddb so the doc survives reloads offline. The DO
   * persists snapshots and materializes the text back into the target's
   * `notes` column for non-collab readers.
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
  import * as Y from 'yjs';
  import YProvider from 'y-partyserver/provider';
  import { IndexeddbPersistence } from 'y-indexeddb';

  interface Props {
    targetTable: CollabTarget;
    targetId: string;
    placeholder?: string;
    rows?: number;
  }

  let { targetTable, targetId, placeholder = 'Notes…', rows = 5 }: Props = $props();

  let el: HTMLTextAreaElement | undefined = $state();
  let status = $state<'connecting' | 'live' | 'offline'>('connecting');
  let peers = $state(0);
  let editingNames = $state<string[]>([]);

  function jwtEmail(): string {
    try {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) return 'someone';
      const payload = JSON.parse(
        atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
      ) as { email?: string };
      return payload.email?.split('@')[0] ?? 'someone';
    } catch {
      return 'someone';
    }
  }

  onMount(() => {
    if (!localStorage.getItem('hour_jwt')) return;

    const doc = new Y.Doc();
    const ytext = doc.getText('notes');
    const idb = new IndexeddbPersistence(`hour-collab-${targetTable}-${targetId}`, doc);

    // With `prefix`, YProvider uses it as the FULL path (the room only
    // names the BroadcastChannel) — so the target id goes in the prefix.
    const provider = new YProvider(location.host, targetId, doc, {
      prefix: `/api/collab/${targetTable}/${targetId}`,
      protocol: location.protocol === 'https:' ? 'wss' : 'ws',
      // Function form: re-read on every (re)connect so a refreshed JWT is
      // picked up without tearing the provider down.
      params: () => ({ token: localStorage.getItem('hour_jwt') }),
    });

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

    ytext.observe((_event, txn) => {
      if (txn.origin !== 'local') pull();
    });
    idb.once('synced', pull);
    provider.once('synced', pull);

    provider.on('status', ({ status: s }: { status: string }) => {
      status = s === 'connected' ? 'live' : 'offline';
    });

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', { name: jwtEmail() });
    const onAwareness = () => {
      const others = [...awareness.getStates().entries()].filter(
        ([id]) => id !== awareness.clientID,
      );
      peers = others.length;
      editingNames = others
        .filter(([, s]) => (s as { editing?: boolean }).editing)
        .map(([, s]) => (s as { user?: { name?: string } }).user?.name ?? 'someone');
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
      provider.destroy();
      // Closes the IndexedDB connection (clearData() would wipe it).
      void idb.destroy();
      doc.destroy();
    };
  });
</script>

<div class="ynotes" class:ynotes--remote={editingNames.length > 0} data-collab-status={status}>
  <div class="ynotes__meta">
    <span class="ynotes__dot" aria-hidden="true"></span>
    <span class="ynotes__status">
      {#if status === 'live'}
        live{#if peers > 0} · {peers + 1} here{/if}
      {:else if status === 'offline'}
        offline — edits sync on reconnect
      {:else}
        connecting…
      {/if}
    </span>
    {#if editingNames.length > 0}
      <span class="ynotes__editing">{editingNames.join(', ')} editing</span>
    {/if}
  </div>
  <textarea bind:this={el} {rows} {placeholder} aria-label="Notes"></textarea>
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
