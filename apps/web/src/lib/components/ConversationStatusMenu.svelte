<script lang="ts">
  /**
   * The status of a conversation as a pill that opens its menu (ADR-040):
   * the seven statuses and, when the caller has one, «Log contact…». One
   * implementation for the list and the file (ADR-126 § 5), so the two never
   * offer different things. The trigger's name starts with the status: a
   * screen reader hears «Hold, change status…», not only the action.
   */
  import Menu from '$lib/components/Menu.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
    CONVERSATION_STATUSES,
    statusBadgeClass,
    statusLabel,
    type ConversationStatus,
  } from '$lib/conversation';

  interface Props {
    status: ConversationStatus;
    locale: Locale;
    onchange: (status: ConversationStatus) => void;
    /** «Log contact…»: absent, the menu offers only the statuses. */
    onlog?: () => void;
    direction?: 'up' | 'down';
  }

  let { status, locale, onchange, onlog, direction = 'down' }: Props = $props();
</script>

<Menu
  label={t('conversations.status_menu', locale, { status: statusLabel(status, locale) })}
  triggerClass={`badge badge--xs ${statusBadgeClass(status)}`}
  {direction}
>
  {#snippet trigger()}
    {statusLabel(status, locale)}<span class="status-caret" aria-hidden="true">▾</span>
  {/snippet}
  {#snippet children({ close })}
    {#each CONVERSATION_STATUSES as s (s)}
      <li role="none">
        <button
          type="button"
          role="menuitem"
          class="menu__item{s === status ? ' menu__item--active' : ''}"
          onclick={() => {
            close();
            if (s !== status) onchange(s);
          }}
        >
          {statusLabel(s, locale)}
        </button>
      </li>
    {/each}
    {#if onlog}
      <li class="menu-separator" role="separator"></li>
      <li role="none">
        <button
          type="button"
          role="menuitem"
          class="menu__item"
          onclick={() => {
            close();
            onlog();
          }}
        >{t('conversations.log_contact', locale)}</button>
      </li>
    {/if}
  {/snippet}
</Menu>

<style>
  @layer components {
    .menu-separator {
      block-size: 1px;
      margin-block: var(--space-2xs);
      background: var(--border-color);
    }
  }
</style>
