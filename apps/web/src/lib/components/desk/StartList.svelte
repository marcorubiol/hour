<script lang="ts">
  /**
   * StartList: la lista de arranque de Hoy en un espacio recién creado (tarea
   * 137, ayuda B). Va donde iría la bienvenida de Hoy y la sustituye mientras
   * vive: mismo papel (borde fino, fondo elevado, título en cursiva), porque
   * es la bienvenida de este momento. Nunca dos tarjetas a la vez.
   *
   * Tres pasos numerados, sin bloquear el orden. Cada uno abre el diálogo de
   * alta que ya existe, desde aquí y sin navegar; se tacha solo con los datos
   * del espacio, venga de la puerta que venga, y lo hecho enlaza a lo creado.
   * «Más tarde» por paso y «Ocultar» para todo, en `help_seen`. La regla de
   * cuándo sale y cuándo se va es pura: `$lib/first-day`.
   *
   * `phase` sube a Hoy lo que pinta, para que calle la bienvenida y el «Todo
   * al día», que mentiría mientras la lista vive.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { appLocale, t, tradeOf } from '$lib/i18n';
  import { spaceName } from '$lib/utils/identity';
  import type { NavWorkspace } from '$lib/nav';
  import { useCreation } from '$lib/stores/creation.svelte';
  import { help, ensureHelp, markHelpSeen } from '$lib/help-seen.svelte';
  import {
    START_HIDDEN_KEY,
    doneCount,
    primaryStep,
    seesStart,
    startLaterKey,
    startPhase,
    startRows,
    startState,
    type StartPhase,
    type StartRow,
    type StartStep,
  } from '$lib/first-day';
  import { startQueryOptions } from '$lib/first-day-query';

  interface Props {
    /** The space of the list (`startTarget`), or none. */
    workspace: NavWorkspace | null;
    phase?: StartPhase;
    /** Its read is on the way: Hoy holds its welcome, so two cards never swap. */
    holding?: boolean;
  }
  let { workspace, phase = $bindable('none'), holding = $bindable(false) }: Props = $props();

  const locale = appLocale();
  const id = $props.id();
  const creation = useCreation();

  $effect(() => {
    void ensureHelp();
  });

  let sees = $derived(seesStart(workspace?.my_role));
  // Not asked by whoever hid it, nor by whoever cannot see it.
  let wanted = $derived(sees && help.ready && !Object.hasOwn(help.seen, START_HIDDEN_KEY));
  const startQuery = createQuery(toStore(() => startQueryOptions(workspace?.id, wanted)));

  $effect(() => {
    holding = wanted && $startQuery.isPending;
  });

  let rows = $derived<StartRow[] | null>(
    workspace && $startQuery.data ? startRows(startState($startQuery.data, workspace.slug), help.seen) : null,
  );
  let sawPending = $state(false);
  $effect(() => {
    if (startPhase({ rows, seen: help.seen, ready: help.ready, sees, sawPending: false }) === 'list') sawPending = true;
  });
  $effect(() => {
    phase = startPhase({ rows, seen: help.seen, ready: help.ready, sees, sawPending });
  });

  // Its own trade: the one chosen at creation speaks, whatever else is on screen.
  let trade = $derived(tradeOf(workspace ? [workspace] : []));
  const tr = (key: string, params?: Record<string, string | number>) => t(key, locale, params, trade);
  let name = $derived(workspace ? spaceName(workspace.name) : '');
  let done = $derived(rows ? doneCount(rows) : 0);
  let primary = $derived(rows ? primaryStep(rows) : null);

  function act(step: StartStep) {
    if (!workspace) return;
    if (step === 'project') creation.openProject({ workspaceId: workspace.id, stay: true });
    else if (step === 'contacts') creation.openConversation();
    else creation.openEvent({ projectId: rows?.find((r) => r.step === 'project')?.item?.id ?? null });
  }
  const ACT_KEY: Record<StartStep, string> = {
    project: 'start.project_act',
    contacts: 'start.contacts_act',
    date: 'start.date_act',
  };
</script>

{#if phase === 'list' && rows}
  <section class="welcome start" aria-labelledby={`${id}-h`} data-testid="start-list">
    <div class="start__head">
      <h2 class="welcome__title" id={`${id}-h`}>{tr('start.title', { name })}</h2>
      <span class="start__count">{tr('start.count', { n: done, total: rows.length })}</span>
      <button type="button" class="btn--quiet btn--s start__hide" onclick={() => markHelpSeen(START_HIDDEN_KEY)}
        >{tr('start.hide')}</button
      >
    </div>
    <ol class="start__steps">
      {#each rows as row (row.step)}
        <li class="start__step" data-status={row.status}>
          <span class="start__mark" aria-hidden="true"></span>
          <div class="start__text">
            <p class="start__title">
              {tr(`start.${row.step}`)}{#if row.status !== 'pending'}<span class="visually-hidden"
                  >. {tr(row.status === 'done' ? 'start.status_done' : 'start.later_note')}</span
                >{/if}
            </p>
            {#if row.status === 'done'}
              <p class="start__fact">
                {tr('start.done')}
                {#if row.item?.href}<a href={row.item.href}>{row.item.name || tr(`start.${row.step}_fallback`)}</a
                  >{:else}{row.item?.name || tr(`start.${row.step}_fallback`)}{/if}
              </p>
            {:else if row.status === 'later'}
              <p class="start__fact">
                {tr('start.later_note')} · <button type="button" class="fact-act" onclick={() => act(row.step)}
                  >{tr('start.do_now')}</button
                >
              </p>
            {:else}
              <p class="start__body">{tr(`start.${row.step}_body`)}</p>
            {/if}
          </div>
          {#if row.status === 'pending'}
            <div class="start__acts">
              <button type="button" class="btn--quiet btn--s" onclick={() => markHelpSeen(startLaterKey(row.step))}
                >{tr('start.later')}</button
              >
              <button
                type="button"
                class="{primary === row.step ? 'btn--primary' : 'btn--secondary'} btn--s start__act"
                onclick={() => act(row.step)}>{tr(ACT_KEY[row.step])}</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="start__foot">{tr('start.foot')}</p>
    <p class="start__foot-hide">
      <button type="button" class="btn--quiet btn--s" onclick={() => markHelpSeen(START_HIDDEN_KEY)}
        >{tr('start.hide')}</button
      >
    </p>
  </section>
{:else if phase === 'closing' && rows}
  <section class="welcome start" aria-labelledby={`${id}-h`} data-testid="start-list">
    <div class="start__head">
      <h2 class="welcome__title" id={`${id}-h`}>{tr('start.closing', { name })}</h2>
      <span class="start__count">{tr('start.count', { n: done, total: rows.length })}</span>
    </div>
    <p class="welcome__body">{tr('start.closing_body')}</p>
    <p class="welcome__acts">
      <button type="button" class="btn--primary btn--s" onclick={() => markHelpSeen(START_HIDDEN_KEY)}
        >{tr('help.got_it')}</button
      >
    </p>
  </section>
{/if}

<style>
  @layer components {
    /* The paper is the welcome's (base.css § Welcome): the same object, this
       moment's. The list asks for a little more air between its parts. */
    .start {
      gap: var(--space-s);
    }
    .start__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .start__count {
      color: var(--text-muted);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .start__hide {
      margin-inline-start: auto;
    }
    .start__steps {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .start__step {
      display: grid;
      grid-template-columns: var(--start-mark-col) minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: start;
      padding-block: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .start__step:first-child {
      border-block-start: 0;
    }
    /* The mark: an empty ring to do, a filled one with its tick when done,
       a dashed ring when it waits for later. */
    .start__mark {
      display: grid;
      place-items: center;
      inline-size: var(--start-mark);
      block-size: var(--start-mark);
      margin-block-start: var(--space-2xs);
      border: var(--line-thin) solid var(--text-faint);
      border-radius: var(--radius-circle);
    }
    [data-status='done'] .start__mark {
      border-color: var(--success);
      background: var(--success);
    }
    [data-status='done'] .start__mark::after {
      content: '';
      inline-size: 28%;
      block-size: 50%;
      border: solid var(--bg-ultra-light);
      border-width: 0 var(--line-thin) var(--line-thin) 0;
      transform: translateY(-10%) rotate(45deg);
    }
    [data-status='later'] .start__mark {
      border-style: dashed;
    }
    .start__text {
      min-inline-size: 0;
    }
    .start__title {
      margin: 0;
      color: var(--heading-color);
      font-weight: 600;
    }
    [data-status='done'] .start__title,
    [data-status='later'] .start__title {
      color: var(--text-muted);
      font-weight: 500;
    }
    .start__body,
    .start__fact {
      margin: 0;
      max-inline-size: 52ch;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .start__fact a {
      color: var(--text-color);
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: var(--link-underline-offset);
    }
    .start__acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      align-items: center;
      justify-content: flex-end;
    }
    .start__foot {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .start__foot-hide {
      display: none;
      margin: 0;
    }

    /* A phone (48rem, $lib/breakpoints): the actions under the text, the
       step's button the whole width with «Más tarde» after it, and
       «Ocultar» down at the foot, not competing with the title. */
    @media (max-width: 47.999rem) {
      .start__step {
        grid-template-columns: var(--start-mark-col) minmax(0, 1fr);
      }
      .start__acts {
        grid-column: 2;
        flex-direction: column-reverse;
        align-items: stretch;
      }
      .start__act {
        justify-content: center;
      }
      .start__head .start__hide {
        display: none;
      }
      .start__foot-hide {
        display: block;
      }
    }
  }
</style>
