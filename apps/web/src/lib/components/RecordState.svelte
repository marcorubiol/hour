<!--
  RecordState — what a record's page (a performance, a conversation, a
  person, a mailout, a road sheet) says while its read is on the way or when
  it does not arrive. The one home of the treatment each page drew on its own
  (`.perf__state`, `.person__state`, `.rs__state`, `.conv__msg`…).

  Three answers (`load-fail.ts`): loading; `missing` (404/403: it is not there
  for you, said in the page's own sentence); `failed` (5xx, network: the
  dashboards' `.load-fail` voice with «Try again»). Never the server's text.
  The way back, when the page has one, goes under both failures.
-->
<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { loadFailKind } from '$lib/load-fail';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    /** Still on the way (the query is pending). */
    loading: boolean;
    /** The read's error, or null. */
    error: unknown;
    /** «This performance does not exist or you cannot see it.» */
    missingText: string;
    /** «This performance could not be loaded.» */
    failedText: string;
    onretry: () => void;
    back?: { href: string; label: string } | null;
    locale: Locale;
  }

  let { loading, error, missingText, failedText, onretry, back = null, locale }: Props = $props();

  let kind = $derived(error ? loadFailKind(error) : null);
</script>

{#if loading}
  <p class="record-state" aria-busy="true">{t('desk.loading', locale)}</p>
{:else if kind}
  <div class="record-state" data-testid="record-state" data-kind={kind}>
    {#if kind === 'missing'}
      <p class="record-state__line">{missingText}</p>
    {:else}
      <p class="load-fail" role="alert">
        <span>{failedText}</span>
        <Button variant="outline" size="xs" onclick={onretry}>{t('ui.retry', locale)}</Button>
      </p>
    {/if}
    {#if back}<p class="record-state__line"><a class="link-arrow" href={back.href}>{back.label}</a></p>{/if}
  </div>
{/if}

<style>
  @layer components {
    .record-state {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: 0;
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .record-state__line {
      margin: 0;
    }
  }
</style>
