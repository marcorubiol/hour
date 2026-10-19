<script lang="ts">
  /**
   * The relation of a conversation as a pill that opens its menu (ADR-040,
   * ADR-138 § 4). The relation is derived: the only thing a person sets is
   * «No esta vez», with an optional day to write again, and lifts it. Plus
   * «Log contact…» when the caller has one. One implementation for the list
   * and the file (ADR-126 § 5), so the two never offer different things. The
   * trigger's name starts with the relation: a screen reader hears «In talks,
   * change…», not only the action.
   */
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { dayMonth } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { relationLabel, relationTone, type Relation } from '$lib/conversation-relation';

  interface Props {
    relation: Relation;
    /** YYYY-MM-DD: the day «not this time» ends, when it has one. */
    notNowUntil?: string | null;
    locale: Locale;
    /** Sets «not this time» (until: the day to write again, or null) or lifts it (null). */
    onnotnow: (next: { until: string | null } | null) => void;
    /** «Log contact…»: absent, the menu offers only the relation. */
    onlog?: () => void;
    direction?: 'up' | 'down';
  }

  let { relation, notNowUntil = null, locale, onnotnow, onlog, direction = 'down' }: Props = $props();

  let dialogOpen = $state(false);
  let until = $state('');

  let label = $derived(
    relation === 'not_now' && notNowUntil
      ? t('conversations.relation_not_now_until', locale, { date: dayMonth(notNowUntil) })
      : relationLabel(relation, locale),
  );

  function openDialog() {
    until = '';
    dialogOpen = true;
  }
  function save() {
    onnotnow({ until: until || null });
    dialogOpen = false;
  }
</script>

<Menu
  label={t('conversations.status_menu', locale, { status: label })}
  triggerClass={`badge badge--xs badge--${relationTone(relation)}`}
  {direction}
>
  {#snippet trigger()}
    {label}<span class="status-caret" aria-hidden="true">▾</span>
  {/snippet}
  {#snippet children({ close })}
    <li role="none">
      <button
        type="button"
        role="menuitem"
        class="menu__item"
        onclick={() => {
          close();
          if (relation === 'not_now') onnotnow(null);
          else openDialog();
        }}
      >
        {relation === 'not_now' ? t('conversations.not_now_lift', locale) : t('conversations.not_now_set', locale)}
      </button>
    </li>
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

<Dialog bind:open={dialogOpen} title={t('conversations.relation_not_now', locale)} size="s">
  <p class="not-now-hint">{t('conversations.not_now_hint', locale)}</p>
  <Input label={t('conversations.not_now_back', locale)} type="date" bind:value={until} />
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (dialogOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={save}>{t('blackout.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .menu-separator {
      block-size: 1px;
      margin-block: var(--space-2xs);
      background: var(--border-color);
    }
    .not-now-hint {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
  }
</style>
