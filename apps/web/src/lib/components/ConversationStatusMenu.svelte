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
  import NotNowDialog from '$lib/components/NotNowDialog.svelte';
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
    /** `badge` in a list's row; `word` in a record's facts line, a mono word
        and not a pill (ADR-139 p2): one menu, two placings. */
    look?: 'badge' | 'word';
  }

  let { relation, notNowUntil = null, locale, onnotnow, onlog, direction = 'down', look = 'badge' }: Props = $props();

  let dialogOpen = $state(false);

  let label = $derived(
    relation === 'not_now' && notNowUntil
      ? t('conversations.relation_not_now_until', locale, { date: dayMonth(notNowUntil) })
      : relationLabel(relation, locale),
  );

  function openDialog() {
    dialogOpen = true;
  }
</script>

<Menu
  label={t('conversations.status_menu', locale, { status: label })}
  triggerClass={look === 'word' ? 'fact-word' : `badge badge--xs badge--${relationTone(relation)}`}
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

<NotNowDialog bind:open={dialogOpen} {locale} onsave={(until) => onnotnow({ until })} />

<style>
  @layer components {
    .menu-separator {
      block-size: var(--line-hairline);
      margin-block: var(--space-2xs);
      background: var(--border-color);
    }
  }
</style>
