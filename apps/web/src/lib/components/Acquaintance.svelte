<script lang="ts">
  /**
   * «Lo conozco» de una persona (ADR-138 § 5), en su ficha y en los contactos
   * de una conversación.
   *
   * Dos interruptores: lo conozco y, si lo conozco, compartirlo con el equipo.
   * Cada marca nace privada; quitarla borra la fila (y con ella el compartir).
   * Debajo, quién más del equipo la conoce y lo ha dicho. Lee y escribe la
   * única caché de marcas (`ACQUAINTANCES_KEY`), así la fila de la lista se
   * entera sin recargar.
   *
   * `name` cambia la cabecera: sin él dice «Lo conozco» (la ficha de persona,
   * donde ya se sabe de quién); con él dice el nombre (una conversación con
   * varios contactos).
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import {
    ACQUAINTANCES_KEY,
    acquaintancesQueryOptions,
    knownAmong,
    knownByLabel,
    type AcquaintanceView,
  } from '$lib/acquaintance';
  import { t, type Locale } from '$lib/i18n';
  import Switch from '$lib/components/Switch.svelte';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    workspaceId: string;
    personId: string;
    /** The person's name: titles the row and names the switches for a screen reader. */
    name?: string;
    locale: Locale;
  }

  let { workspaceId, personId, name, locale }: Props = $props();

  const queryClient = useQueryClient();
  const query = createQuery(acquaintancesQueryOptions());
  let known = $derived(knownAmong($query.data, workspaceId, [personId]));
  let others = $derived(knownByLabel(known.others, locale));

  type Mark = { known: boolean; shared: boolean };

  /** Apply a mark to the cache: the own row in, out or flipped. */
  function withMark(view: AcquaintanceView, mark: Mark): AcquaintanceView {
    const rest = view.items.filter(
      (a) => !(a.workspace_id === workspaceId && a.person_id === personId && a.user_id === view.me),
    );
    const own = { workspace_id: workspaceId, person_id: personId, user_id: view.me, shared: mark.shared };
    return { ...view, items: mark.known ? [...rest, own] : rest };
  }

  const save = createMutation({
    mutationFn: (mark: Mark) =>
      mutateJSON('PUT', '/api/acquaintances', { workspace_id: workspaceId, person_id: personId, ...mark }),
    // The switch moves at the touch; a failure puts it back.
    onMutate: async (mark: Mark) => {
      await queryClient.cancelQueries({ queryKey: ACQUAINTANCES_KEY });
      const before = queryClient.getQueryData<AcquaintanceView>(ACQUAINTANCES_KEY);
      if (before) queryClient.setQueryData(ACQUAINTANCES_KEY, withMark(before, mark));
      return { before };
    },
    onError: (err: unknown, _mark: Mark, ctx: { before?: AcquaintanceView } | undefined) => {
      if (ctx?.before) queryClient.setQueryData(ACQUAINTANCES_KEY, ctx.before);
      addToast({
        tone: 'danger',
        title: t('acquaintance.not_saved', locale),
        message: t('perf.try_again', locale, {
          error: err instanceof Error ? err.message : t('perf.unexpected', locale),
        }),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACQUAINTANCES_KEY }),
  });

  // Nothing to draw until the marks are read: a switch that flips once they
  // arrive would say «no» for a moment.
  let ready = $derived(Boolean($query.data));
</script>

{#if ready}
  <div class="acq">
    <div class="acq__row">
      <span class={name ? 'acq__name' : 'eyebrow eyebrow--sub'}>{name ?? t('acquaintance.known', locale)}</span>
      <Switch
        checked={known.mine}
        label={name ? t('acquaintance.known_aria', locale, { name }) : t('acquaintance.known', locale)}
        disabled={$save.isPending}
        onchange={(next) => $save.mutate({ known: next, shared: false })}
      />
    </div>
    {#if known.mine}
      <div class="acq__row acq__row--sub">
        <span>{t('acquaintance.share', locale)}</span>
        <Switch
          checked={known.shared}
          label={name ? t('acquaintance.share_aria', locale, { name }) : t('acquaintance.share', locale)}
          disabled={$save.isPending}
          onchange={(next) => $save.mutate({ known: true, shared: next })}
        />
      </div>
      <p class="acq__hint">
        {known.shared ? t('acquaintance.shared_hint', locale) : t('acquaintance.private_hint', locale)}
      </p>
    {/if}
    {#if others}
      <p class="acq__others">{others}</p>
    {/if}
  </div>
{/if}

<style>
  @layer components {
    .acq {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .acq p {
      margin: 0;
    }
    .acq__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      min-block-size: var(--control-size-s);
    }
    .acq__name {
      min-inline-size: 0;
      overflow: hidden;
      font-size: var(--text-s);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* The share switch belongs to the mark above it: same column, quieter word. */
    .acq__row--sub {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .acq__hint,
    .acq__others {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .acq__others {
      color: var(--text-muted);
    }
  }
</style>
