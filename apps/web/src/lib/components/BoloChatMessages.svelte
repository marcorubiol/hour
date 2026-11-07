<script lang="ts">
  /**
   * Lo que un grupo de WhatsApp atado a este bolo dijo, en su tablón
   * (ADR-188 § 2, ADR-189). Lo lee quien lee el tablón. Plegado: cuántos y
   * los últimos; desplegado, todos, de lo antiguo a lo nuevo. Sin nada
   * colocado, no ocupa sitio.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import ThreadIcon from '$lib/components/ThreadIcon.svelte';
  import { localeDayMonth } from '$lib/datetime';
  import { LOCALE_TAG, t, type Locale } from '$lib/i18n';
  import { attachmentKey } from '$lib/whatsapp-export';
  import type { BoloChatMessage } from '$lib/wa-import';

  interface Props {
    boloId: string;
    locale: Locale;
  }

  let { boloId, locale }: Props = $props();

  /** Cuántos se ven plegado. */
  const FOLDED = 3;

  const query = createQuery(
    toStore(() => ({
      queryKey: ['bolo-chat', boloId] as const,
      staleTime: 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<{ items: BoloChatMessage[] }>(`/api/whatsapp/bolo/${boloId}`, signal),
    })),
  );
  let items = $derived($query.data?.items ?? []);
  let unfolded = $state(false);
  let shown = $derived(unfolded ? items : items.slice(-FOLDED));

  const time = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE_TAG[locale], { hour: '2-digit', minute: '2-digit' });
</script>

{#if items.length > 0}
  <section class="bchat" aria-label={t('wa_import.board_title', locale)} data-testid="bolo-chat">
    <header class="bchat__head">
      <span class="bchat__what"><ThreadIcon name="whatsapp" />{t('wa_import.board_title', locale)}</span>
      <span class="bchat__n">{t('wa_import.board_count', locale, { n: items.length })}</span>
      {#if items.length > FOLDED}
        <button type="button" class="bchat__fold" onclick={() => (unfolded = !unfolded)} aria-expanded={unfolded}>
          {unfolded ? t('wa_import.board_fold', locale) : t('wa_import.board_unfold', locale)}
        </button>
      {/if}
    </header>
    <ol class="bchat__list">
      {#each shown as m (m.id)}
        <li class="bchat__msg">
          <p class="bchat__who">
            <strong>{m.sender_name}</strong>
            <time datetime={m.occurred_at}>{localeDayMonth(m.occurred_at.slice(0, 10), locale)} · {time(m.occurred_at)}</time>
          </p>
          {#if m.body}<p class="bchat__text">{m.body}</p>{/if}
          {#each m.attachments as a, i (i)}
            <p class="bchat__att">{t(attachmentKey(a.type), locale)}{#if a.name} · {a.name}{/if}</p>
          {/each}
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  @layer components {
    .bchat {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-end: var(--space-s);
      padding: var(--space-s);
      background: var(--bg-light);
      border-radius: var(--radius-s);
    }
    .bchat__head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      align-items: baseline;
    }
    .bchat__what {
      display: inline-flex;
      gap: var(--space-2xs);
      align-items: center;
      color: var(--heading-color);
      font-weight: 500;
    }
    .bchat__n {
      flex: 1;
      color: var(--text-faint);
      font-size: var(--text-s);
    }
    .bchat__fold {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font: inherit;
      font-size: var(--text-s);
      text-decoration: underline;
      cursor: pointer;
    }
    .bchat__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bchat__msg p {
      margin: 0;
    }
    .bchat__who {
      display: flex;
      gap: var(--space-xs);
      align-items: baseline;
      font-size: var(--text-s);
    }
    .bchat__who strong {
      color: var(--heading-color);
      font-weight: 500;
    }
    .bchat__who time {
      color: var(--text-faint);
    }
    .bchat__text {
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .bchat__att {
      color: var(--text-muted);
      font-size: var(--text-s);
      overflow-wrap: anywhere;
    }
  }
</style>
