<script lang="ts">
  /**
   * NewSpacePanel: lo que pinta el shell cuando la persona no tiene ningún
   * espacio (tarea 137, primer día). En la página y no en un diálogo: sin
   * espacio no hay nada detrás que tapar. Cualquier sección muestra este
   * mismo panel; tras crear, se queda en Hoy (no salta a la portada del
   * espacio, como hace el diálogo de «Nuevo espacio»).
   *
   * Dos campos: el nombre y el oficio (Escena por defecto), porque el oficio
   * cambia las palabras de todo lo que viene; la frase de debajo ya cambia
   * con él, antes de guardar. Color automático; lo demás, en Ajustes.
   * POST /api/workspaces y, si eligió música, PUT de su oficio.
   *
   * Con `workspace`, el espacio que dejó el alta (personal, con el nombre de
   * la persona, intacto): no crea otro, le pone nombre y oficio (PATCH y PUT;
   * el slug no cambia, ADR-067). Para la persona es lo mismo, así que los
   * textos no cambian; solo suma «Más tarde», porque aquí ya hay un espacio
   * detrás y nadie debe quedar atrapado en la pregunta. Responder o aplazar
   * marca `SPACE_ASKED_KEY` (también al crear: el creado es personal, y si
   * no la pregunta volvería).
   */
  import { useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { DEFAULT_TRADE, TRADES, type Trade } from '$lib/i18n/trade.svelte';
  import { SPACE_ASKED_KEY } from '$lib/first-day';
  import { markHelpSeen } from '$lib/help-seen.svelte';

  interface Props {
    /** The signup's own space, to name instead of creating one. */
    workspace?: { id: string } | null;
  }
  let { workspace = null }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const id = $props.id();

  let name = $state('');
  let trade = $state<Trade>(DEFAULT_TRADE);
  let pending = $state(false);
  let nameError = $state<string | undefined>();
  let formError = $state('');
  $effect(() => {
    void name;
    nameError = undefined;
    formError = '';
  });

  const tradeOptions = TRADES.map((value) => ({ value, label: t(`settings.trade_${value}`, locale) }));

  async function submit(event: Event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      nameError = t('project.name_empty', locale);
      return;
    }
    pending = true;
    try {
      let ws: { id: string } | undefined;
      if (workspace) {
        await mutateJSON('PATCH', `/api/workspaces/${workspace.id}`, { name: trimmed });
        ws = workspace;
      } else {
        const res = await mutateJSON<{ workspace: { id: string; slug: string } }>('POST', '/api/workspaces', {
          name: trimmed,
        });
        ws = res?.workspace;
      }
      if (!ws) throw new Error(t('perf.unexpected', locale));
      // Answered. A created space: before the shell sees it, or it would ask
      // its name again (it is personal and untouched too). A named one: once
      // its new name is in the cache, so the panel goes straight to it.
      if (!workspace) markHelpSeen(SPACE_ASKED_KEY);
      if (trade !== DEFAULT_TRADE) {
        // The space exists already: a trade that did not save is said, and changed in Ajustes.
        await mutateJSON('PUT', `/api/workspaces/${ws.id}/trade`, { trade }).catch(() =>
          addToast({ tone: 'warning', message: t('start.trade_not_saved', locale) }),
        );
      }
      // The shell draws the app once the space is in its cache.
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      await queryClient.refetchQueries({ queryKey: ['workspaces'] });
      markHelpSeen(SPACE_ASKED_KEY);
      if (page.url.pathname !== '/h/desk') await goto('/h/desk');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) nameError = t('workspace.name_taken', locale);
      else formError = `${t('workspace.not_created', locale)}. ${err instanceof Error ? err.message : t('perf.unexpected', locale)}`;
    } finally {
      pending = false;
    }
  }
</script>

<section class="newspace" aria-labelledby={`${id}-h`}>
  <h1 class="newspace__title" id={`${id}-h`}>{t('start.space_title', locale)}</h1>
  <p class="newspace__body">
    {t('start.space_body', locale)}
    {t('start.space_body_lives', locale, undefined, trade)}
  </p>

  <form class="newspace__form" onsubmit={submit} novalidate>
    <Input
      label={t('start.space_name', locale)}
      name="space-name"
      bind:value={name}
      error={nameError}
      placeholder={t('start.space_name_ph', locale)}
      required
      autofocus
      autocomplete="organization"
      maxlength={80}
      disabled={pending}
    />
    <Segmented
      label={t('settings.trade_kicker', locale)}
      name="space-trade"
      options={tradeOptions}
      bind:value={trade}
      helper={t('start.space_trade_hint', locale)}
      disabled={pending}
    />
    {#if formError}<p class="newspace__error" role="alert">{formError}</p>{/if}
    <div class="newspace__submit">
      <Button type="submit" loading={pending}>{t('start.space_create', locale)}</Button>
      {#if workspace}
        <button type="button" class="btn--quiet" disabled={pending} onclick={() => markHelpSeen(SPACE_ASKED_KEY)}
          >{t('start.later', locale)}</button
        >
      {/if}
    </div>
  </form>

  <p class="newspace__aside">{t('start.space_invited', locale)}</p>
</section>

<style>
  @layer components {
    .newspace {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      max-inline-size: var(--newspace-measure);
      padding-block: var(--space-l);
    }
    .newspace__title {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 400;
      font-size: var(--text-xxl);
      line-height: var(--display-line-height);
      color: var(--heading-color);
    }
    .newspace__body {
      margin: 0;
      color: var(--text-muted);
    }
    .newspace__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }
    .newspace__submit {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      align-items: center;
    }
    .newspace__error {
      margin: 0;
      color: var(--danger);
      font-size: var(--text-s);
    }
    .newspace__aside {
      margin: 0;
      padding-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    /* A phone (48rem, $lib/breakpoints): one column, the button the whole width. */
    @media (max-width: 47.999rem) {
      .newspace {
        padding-block: var(--space-m);
      }
      .newspace__submit :global(button) {
        inline-size: 100%;
        justify-content: center;
      }
    }
  }
</style>
