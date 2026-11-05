<script lang="ts">
  /**
   * «Llega tarde» at the top of Hoy and of Ahora (121 B, ADR-180): what a
   * technician sent from their own road sheet, while nobody marked «Visto».
   * Three acts per notice: «Mover <moment> a HH:MM» (only to whoever edits
   * the performance; asks first, moves that one time and no other, through
   * the collab doc), «Llamar» and «Visto». Nothing to show, nothing drawn.
   *
   * Like band 1 it ignores the scope: a late technician is today's, whatever
   * the sidebar narrows. Without push in Hour (ADR-180), this band and the
   * line in the bolo group are where production hears it, so it reads again
   * every 30 s.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { telHref } from '$lib/ahora';
  import { t, type Locale } from '$lib/i18n';
  import { invalidatePerformanceFeeds } from '$lib/plan-create';
  import {
    canProposeMove,
    lateClock,
    lateEta,
    lateMinutesWord,
    lateMomentWord,
    type LateNotice,
  } from '$lib/roadsheet-late';

  let { locale }: { locale: Locale } = $props();

  const LATE_NOTICES_KEY = ['late-notices'] as const;

  const queryClient = useQueryClient();
  const query = createQuery({
    queryKey: LATE_NOTICES_KEY,
    queryFn: ({ signal }) => fetchJSON<{ items: LateNotice[] }>('/api/late-notices', signal),
    refetchInterval: 30_000,
    // A notice is for now: never shown from a device's old copy.
    meta: { persist: false },
  });
  let notices = $derived($query.data?.items ?? []);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: LATE_NOTICES_KEY });

  const seen = createMutation({
    mutationFn: (id: string) => mutateJSON('POST', `/api/late-notices/${id}/seen`),
    onSuccess: refresh,
    onError: () => addToast({ tone: 'danger', message: t('late.seen_failed', locale) }),
  });

  let confirming = $state<LateNotice | null>(null);
  const move = createMutation({
    mutationFn: (id: string) => mutateJSON('POST', `/api/late-notices/${id}/move`),
    onSuccess: () => {
      confirming = null;
      addToast({ tone: 'success', message: t('late.moved', locale) });
      refresh();
      void invalidatePerformanceFeeds(queryClient);
    },
    onError: (err) => {
      confirming = null;
      addToast({
        tone: 'danger',
        title: t('late.move_failed', locale),
        message: err instanceof ApiError && err.status === 409 ? t('late.move_changed', locale) : t('perf.unexpected', locale),
      });
      refresh();
    },
  });

  const target = (n: LateNotice) => lateEta(n.milestone?.at, n.minutes);

  function context(n: LateNotice): string {
    return [
      n.person_role,
      lateMinutesWord(n.minutes, locale),
      n.milestone ? `${lateMomentWord(n.milestone, locale)} ${lateClock(n.milestone.at, n.timezone)}` : null,
      n.performance.venue_name ?? n.performance.city,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const moveWords = (n: LateNotice) => ({
    moment: n.milestone ? lateMomentWord(n.milestone, locale) : '',
    time: lateClock(target(n)!, n.timezone),
  });
</script>

{#if notices.length > 0}
  <section class="dband lateband" aria-labelledby="desk-late-h" data-testid="late-band">
    <BlockHead title={t('late.band_label', locale)} titleId="desk-late-h" count={notices.length} alert />
    <ul class="lateband__list" role="list">
      {#each notices as n (n.id)}
        <li class="lateband__item">
          <Avatar size="s" name={n.person_name} />
          <div class="lateband__main">
            <p class="lateband__who"><strong>{t('late.band_title', locale, { name: n.person_name })}</strong></p>
            <p class="lateband__ctx">{context(n)}</p>
            {#if n.note}<p class="lateband__note">{n.note}</p>{/if}
            <div class="lateband__acts">
              {#if canProposeMove(n) && target(n)}
                <Button size="xs" onclick={() => (confirming = n)}>{t('late.move', locale, moveWords(n))}</Button>
              {/if}
              {#if n.phone}
                <a class="btn--secondary btn--xs" href={telHref(n.phone)}>{t('late.call', locale)}</a>
              {/if}
              <Button size="xs" variant="quiet" loading={$seen.isPending && $seen.variables === n.id} onclick={() => $seen.mutate(n.id)}>
                {t('late.seen_button', locale)}
              </Button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<Dialog
  open={confirming !== null}
  onclose={() => (confirming = null)}
  title={confirming ? t('late.move_confirm_title', locale, moveWords(confirming)) : ''}
  size="s"
>
  <p class="lateband__confirm">{t('late.move_confirm_body', locale)}</p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (confirming = null)}>{t('create.cancel', locale)}</Button>
    <Button loading={$move.isPending} onclick={() => confirming && $move.mutate(confirming.id)}>
      {t('late.move_confirm', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .lateband__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* The notice in amber, the hand of a warning (the note's colour, ADR-177 § 6). */
    .lateband__item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-s);
      align-items: start;
      padding: var(--space-s) var(--space-m);
      border-inline-start: var(--line-thick) solid var(--tone-warning-accent);
      border-radius: var(--radius-m);
      background: var(--tone-warning-bg);
      color: var(--tone-warning-fg);
    }

    .lateband__main {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }

    .lateband__who {
      font-size: var(--text-s);
    }

    .lateband__ctx,
    .lateband__note {
      font-size: var(--text-xs);
    }

    .lateband__note {
      font-style: italic;
    }

    .lateband__acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-block-start: var(--space-xs);
    }

    .lateband__confirm {
      font-size: var(--text-s);
    }
  }
</style>
