<script lang="ts">
  /**
   * «Llego tarde» on the technician's own sheet (121 B, ADR-183). Only on a
   * personal link, and the button only on the day (the base says `open`). It
   * never changes a time: it warns production, who sees it on Hoy and in the
   * bolo group, and may move the time themselves.
   *
   * Three states, as the sketch: the button (with «Llamar» and «Cómo
   * llegar», a thumb's width); the form (minutes, «No sé» valid, an optional
   * line, who receives it by name, ADR-177 § 6); after, the notice stays on
   * top with its state («Núria lo ha visto») and «Cambiar», which sends again.
   */

  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { dualTime, viewerTimeZone } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import {
    LATE_MINUTES,
    LATE_NOTE_MAX,
    lateEta,
    lateMomentWord,
    nextMilestone,
    type LateMilestone,
    type PublicLate,
    type PublicLateNotice,
  } from '$lib/roadsheet-late';

  interface Props {
    token: string;
    late: PublicLate;
    /** The sheet's running order: the moment the notice is about is the next one. */
    moments: readonly LateMilestone[];
    venueTz: string | null;
    locale: Locale;
    /** After sending: read the sheet again (state, «visto»). */
    onsent: () => void;
  }

  let { token, late, moments, venueTz, locale, onsent }: Props = $props();

  const viewerTz = viewerTimeZone();
  const clock = (iso: string) => dualTime(iso, venueTz, viewerTz).primary;

  let open = $state(false);
  let minutes = $state<number | null>(null);
  let note = $state('');
  let sending = $state(false);
  let failed = $state<string | null>(null);
  /** What this page just sent, before the sheet is read again. */
  let sent = $state<PublicLateNotice | null>(null);

  let last = $derived(sent ?? late.last);
  let milestone = $derived(nextMilestone(moments, new Date()));
  let eta = $derived(lateEta(milestone?.at, minutes));

  function recipientsLine(): string {
    const names = late.recipients;
    if (names.length === 0) return t('late.recipients_none', locale);
    const list =
      names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} ${t('late.and', locale)} ${names[names.length - 1]}`;
    return t('late.recipients', locale, { names: list });
  }

  function start() {
    open = true;
    failed = null;
    minutes = null;
    note = '';
  }

  async function send() {
    if (sending) return;
    sending = true;
    failed = null;
    try {
      const res = await fetch(`/api/public/roadsheet/${encodeURIComponent(token)}/late`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes, note: note.trim() || null }),
      });
      if (!res.ok) {
        failed =
          res.status === 429 ? 'late.error_limit' : res.status === 400 ? 'late.error_day' : 'late.error';
        return;
      }
      const body = (await res.json()) as { notice: PublicLateNotice };
      sent = body.notice;
      open = false;
      onsent();
    } catch {
      failed = 'late.error';
    } finally {
      sending = false;
    }
  }
</script>

<section class="late" aria-label={t('late.button', locale)} data-testid="roadsheet-late">
  {#if open}
    <form
      class="late__form"
      onsubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <fieldset class="late__minutes">
        <legend>{t('late.how_late', locale)}</legend>
        <div class="late__chips">
          {#each LATE_MINUTES as m (m)}
            <Pill size="sm" active={minutes === m} ariaPressed={minutes === m} onclick={() => (minutes = m)}>
              {m === 45 ? t('late.minutes_45_short', locale) : String(m)}
            </Pill>
          {/each}
          <Pill size="sm" active={minutes === null} ariaPressed={minutes === null} onclick={() => (minutes = null)}>
            {t('late.dont_know', locale)}
          </Pill>
        </div>
      </fieldset>
      {#if milestone}
        <p class="late__eta" data-testid="roadsheet-late-eta">
          {eta
            ? t('late.eta', locale, { time: clock(eta), moment: lateMomentWord(milestone, locale), at: clock(milestone.at) })
            : t('late.to_moment', locale, { moment: lateMomentWord(milestone, locale), at: clock(milestone.at) })}
        </p>
      {/if}
      <Textarea
        label={t('late.note_label', locale)}
        bind:value={note}
        rows={2}
        maxlength={LATE_NOTE_MAX}
        counter
      />
      <p class="late__who">{recipientsLine()} {t('late.no_time_change', locale)}</p>
      {#if failed}<p class="late__fail" role="alert">{t(failed, locale)}</p>{/if}
      <div class="late__acts">
        <Button type="submit" loading={sending}>{t('late.send', locale)}</Button>
        <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
      </div>
    </form>
  {:else if last}
    <div class="late__state" role="status" data-testid="roadsheet-late-state">
      <p>
        <strong>{t('late.sent', locale, { time: clock(last.created_at) })}</strong>
        {#if lateEta(last.milestone?.at, last.minutes)}
          {t('late.sent_eta', locale, { time: clock(lateEta(last.milestone?.at, last.minutes)!) })}
        {/if}
      </p>
      <p class="late__seen">
        {last.seen_at
          ? last.seen_by
            ? t('late.seen', locale, { name: last.seen_by })
            : t('late.seen_someone', locale)
          : t('late.not_seen', locale)}
      </p>
      {#if late.open}
        <Button size="xs" variant="secondary" onclick={start}>{t('late.change', locale)}</Button>
      {/if}
    </div>
  {:else if late.open}
    <button type="button" class="late__go" onclick={start} data-testid="roadsheet-late-button">
      {t('late.button', locale)}
    </button>
  {/if}
</section>

<style>
  @layer components {
    .late {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: 0;
    }

    /* The thumb's act, in amber: the same height as «Llamar» and «Cómo llegar». */
    .late__go {
      min-block-size: calc(var(--touch-target) + var(--space-xl));
      padding: var(--space-xs) var(--space-s);
      border: var(--line-hairline) solid var(--tone-warning-accent);
      border-radius: var(--radius-m);
      background: var(--tone-warning-bg);
      color: var(--tone-warning-fg);
      font-size: var(--text-s);
      font-weight: var(--today-weight);
    }

    .late__go:hover {
      border-color: var(--tone-warning-fg);
    }

    .late__form,
    .late__state {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: var(--space-m);
      border: var(--line-hairline) solid var(--tone-warning-accent);
      border-radius: var(--radius-m);
      background: var(--tone-warning-bg);
      color: var(--tone-warning-fg);
      font-size: var(--text-s);
    }

    .late__minutes {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      border: 0;
      padding: 0;
      margin: 0;
    }

    .late__minutes legend {
      padding: 0;
      margin-block-end: var(--space-xs);
      font-weight: var(--today-weight);
    }

    .late__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .late__who,
    .late__seen {
      font-size: var(--text-xs);
    }

    .late__fail {
      font-size: var(--text-xs);
      color: var(--tone-danger-fg);
    }

    .late__acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
      align-items: center;
    }

    .late__state :global(.btn--xs) {
      align-self: flex-start;
    }

    @media print {
      .late {
        display: none;
      }
    }
  }
</style>
