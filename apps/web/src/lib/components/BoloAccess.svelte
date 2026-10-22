<script lang="ts">
  /**
   * El acceso al bolo, bajo la cabecera del tablón (comms carril 2, fase 2;
   * plan 2026-10-22 § 3.1 y § 3.2). Quién entra por el bolo y hasta cuándo,
   * qué invitaciones esperan, y «X va y no lo ve · Invitar» desde «quién va».
   *
   * «Quién va» propone, no da (ADR-103): la línea solo abre el diálogo de
   * invitar con esa persona; el acceso lo da una persona al invitar.
   * Invitar, revocar y mover la fecha solo se ofrecen a quien la RPC lo deja
   * (`can_invite`, `can_manage`, `can_extend`): lo que no puedes no se pinta.
   *
   * Hour no envía correos de invitación (las de espacio tampoco): la
   * invitación deja un enlace para copiar y mandar.
   */

  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { dayMonthLong } from '$lib/datetime';
  import { LOCALE_TAG, t, type Locale } from '$lib/i18n';
  import {
    canInvite,
    defaultPreset,
    endOfDayInTz,
    goingWithoutAccess,
    lastAccessDayISO,
    type BoloAccess,
    type BoloMember,
    type BoloPreset,
    type GoingPerson,
  } from '$lib/bolo-access';

  interface Props {
    boloId: string;
    /** Quién va a esta función (hechos: reparto y «voy»), con nombre. */
    going?: readonly GoingPerson[];
    /** La zona del espacio: el día en que acaba un acceso. */
    tz: string;
    locale: Locale;
  }

  let { boloId, going = [], tz, locale }: Props = $props();

  const queryClient = useQueryClient();
  let queryKey = $derived(['bolo-access', boloId] as const);
  const accessQuery = createQuery(
    toStore(() => ({
      queryKey,
      enabled: Boolean(boloId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<BoloAccess>(`/api/bolos/${boloId}/access`, signal),
    })),
  );
  let access = $derived($accessQuery.data ?? null);
  let inviter = $derived(canInvite(access));
  let proposals = $derived(goingWithoutAccess(going, access));

  const tag = $derived(LOCALE_TAG[locale]);
  const day = (iso: string) => dayMonthLong(lastAccessDayISO(iso, tz), tag);
  const presetShort = (p: string | null) =>
    p === 'minim' || p === 'equip' ? t(`bolo_access.preset_${p}_short`, locale) : '';
  const nameOf = (m: BoloMember) => m.name?.trim() || t('threads.someone', locale);

  function memberTerm(m: BoloMember): string {
    if (!m.ends_at) return t('bolo_access.no_end', locale);
    return m.live
      ? t('bolo_access.until', locale, { day: day(m.ends_at) })
      : t('bolo_access.ended', locale, { day: day(m.ends_at) });
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  function failed(err: unknown, title: string) {
    addToast({
      tone: 'danger',
      title,
      message:
        err instanceof ApiError && err.status === 403
          ? t('bolo_access.forbidden', locale)
          : err instanceof ApiError && err.status === 400
            ? t('bolo_access.invalid', locale)
            : t('perf.unexpected', locale),
    });
  }

  // ── invitar ────────────────────────────────────────────────────────────
  let inviteOpen = $state(false);
  let iEmail = $state('');
  let iPreset = $state<BoloPreset>('equip');
  let iPerson = $state<GoingPerson | null>(null);
  let inviteUrl = $state('');
  let inviteBusy = $state(false);

  let presetOptions = $derived(
    (['equip', 'minim'] as const)
      .filter((p) => access?.can_invite[p])
      .map((p) => ({ value: p, label: t(`bolo_access.preset_${p}_short`, locale) })),
  );

  function openInvite(person: GoingPerson | null) {
    if (!access) return;
    iPerson = person;
    iEmail = '';
    iPreset = defaultPreset(access);
    inviteUrl = '';
    inviteOpen = true;
  }

  async function sendInvite() {
    if (inviteBusy || !iEmail.trim()) return;
    inviteBusy = true;
    try {
      const body = await mutateJSON<{ invitation?: { invite_url: string } }>('POST', `/api/bolos/${boloId}/access`, {
        email: iEmail.trim(),
        preset: iPreset,
        person_id: iPerson?.person_id ?? null,
      });
      if (!body?.invitation) throw new Error('no link');
      inviteUrl = body.invitation.invite_url;
      refresh();
    } catch (err) {
      failed(err, t('bolo_access.invite_failed', locale));
    } finally {
      inviteBusy = false;
    }
  }

  async function copyInvite() {
    addToast(
      (await copyText(inviteUrl))
        ? { tone: 'success', message: t('settings.access_link_copied', locale) }
        : { tone: 'danger', message: t('settings.access_link_copy_failed', locale) },
    );
  }

  async function revokeInvitation(id: string) {
    try {
      await mutateJSON('DELETE', `/api/bolos/${boloId}/access`, { kind: 'invitation', id });
      refresh();
    } catch (err) {
      failed(err, t('bolo_access.not_saved', locale));
    }
  }

  // ── quitar ─────────────────────────────────────────────────────────────
  let removing = $state<BoloMember | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  async function confirmRemove() {
    if (!removing || removeBusy) return;
    removeBusy = true;
    try {
      await mutateJSON('DELETE', `/api/bolos/${boloId}/access`, { kind: 'member', id: removing.membership_id });
      removeOpen = false;
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['bolo-board'] });
    } catch (err) {
      failed(err, t('bolo_access.not_saved', locale));
    } finally {
      removeBusy = false;
    }
  }

  // ── la fecha ───────────────────────────────────────────────────────────
  let extending = $state<BoloMember | null>(null);
  let extendOpen = $state(false);
  let eDay = $state('');
  let extendBusy = $state(false);

  function openExtend(m: BoloMember) {
    extending = m;
    eDay = m.ends_at ? lastAccessDayISO(m.ends_at, tz) : access?.ends_at ? lastAccessDayISO(access.ends_at, tz) : '';
    extendOpen = true;
  }

  async function saveExtend(noEnd: boolean) {
    if (!extending || extendBusy) return;
    const expires_at = noEnd ? null : endOfDayInTz(eDay, tz);
    if (!noEnd && !expires_at) return;
    extendBusy = true;
    try {
      await mutateJSON('PATCH', `/api/bolos/${boloId}/access`, { membership_id: extending.membership_id, expires_at });
      extendOpen = false;
      refresh();
    } catch (err) {
      failed(err, t('bolo_access.not_saved', locale));
    } finally {
      extendBusy = false;
    }
  }

  function memberActions(m: BoloMember) {
    const items = [];
    if (m.can_manage && access?.can_extend) {
      items.push({ label: t('bolo_access.extend', locale), onclick: () => openExtend(m) });
    }
    if (m.can_manage) {
      items.push({
        label: t('bolo_access.remove', locale),
        danger: true,
        onclick: () => {
          removing = m;
          removeOpen = true;
        },
      });
    }
    return items;
  }

  let visible = $derived(
    Boolean(access) &&
      (access!.members.length > 0 || access!.invitations.length > 0 || proposals.length > 0 || inviter),
  );
</script>

{#if visible && access}
  <div class="access" aria-label={t('bolo_access.title', locale)} role="group">
    {#if access.members.length > 0}
      <ul class="access__list" role="list" aria-label={t('bolo_access.members_label', locale)}>
        {#each access.members as m (m.membership_id)}
          {@const actions = memberActions(m)}
          <li class="access__row" class:access__row--ended={!m.live}>
            <span class="access__name">{nameOf(m)}</span>
            <span class="access__term">{presetShort(m.preset)} · {memberTerm(m)}</span>
            {#if actions.length > 0}
              <Menu
                items={actions}
                align="end"
                label={t('bolo_access.member_menu', locale, { name: nameOf(m) })}
                triggerClass="btn--quiet btn--s"
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if access.invitations.length > 0}
      <ul class="access__list" role="list" aria-label={t('bolo_access.pending_label', locale)}>
        {#each access.invitations as inv (inv.id)}
          <li class="access__row access__row--pending">
            <span class="access__name">{inv.email}</span>
            <span class="access__term">{presetShort(inv.preset)} · {t('bolo_access.pending', locale)}</span>
            <button
              type="button"
              class="empty-line__act"
              aria-label={t('bolo_access.revoke_invitation_for', locale, { email: inv.email })}
              onclick={() => revokeInvitation(inv.id)}>{t('bolo_access.revoke_invitation', locale)}</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    {#each proposals as p (p.person_id)}
      <p class="access__propose">
        <span>{t('bolo_access.going_without', locale, { name: p.name })}</span>
        <button
          type="button"
          class="empty-line__act"
          aria-label={t('bolo_access.invite_person', locale, { name: p.name })}
          onclick={() => openInvite(p)}>{t('bolo_access.invite_short', locale)}</button
        >
      </p>
    {/each}

    {#if inviter}
      <div class="access__add">
        <Button variant="secondary" size="s" onclick={() => openInvite(null)}>{t('bolo_access.invite', locale)}</Button>
      </div>
    {/if}
  </div>
{/if}

<Dialog
  bind:open={inviteOpen}
  title={iPerson
    ? t('bolo_access.invite_person', locale, { name: iPerson.name })
    : t('bolo_access.invite_title', locale)}
  size="s"
>
  {#if inviteUrl}
    <div class="access__fields">
      <Input label={t('bolo_access.link_label', locale)} value={inviteUrl} />
    </div>
    <p class="access__hint">{t('bolo_access.link_hint', locale, { email: iEmail.trim() })}</p>
  {:else}
    <div class="access__fields">
      <Input label={t('bolo_access.field_email', locale)} type="email" bind:value={iEmail} required autofocus />
      {#if presetOptions.length > 1}
        <Segmented
          label={t('bolo_access.field_preset', locale)}
          options={presetOptions}
          bind:value={iPreset}
          helper={t(`bolo_access.preset_${iPreset}`, locale)}
        />
      {:else}
        <p class="access__hint">{t(`bolo_access.preset_${iPreset}`, locale)}</p>
      {/if}
    </div>
    <p class="access__hint">
      {access?.ends_at
        ? t('bolo_access.ends_note', locale, { day: day(access.ends_at) })
        : t('bolo_access.ends_note_none', locale)}
    </p>
  {/if}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (inviteOpen = false)}>{t('threads.cancel', locale)}</Button>
    {#if inviteUrl}
      <Button onclick={copyInvite}>{t('bolo_access.copy', locale)}</Button>
    {:else}
      <Button onclick={sendInvite} loading={inviteBusy} disabled={!iEmail.trim()}>{t('bolo_access.send', locale)}</Button>
    {/if}
  {/snippet}
</Dialog>

<Dialog
  bind:open={removeOpen}
  title={removing ? t('bolo_access.remove_title', locale, { name: nameOf(removing) }) : ''}
  size="s"
>
  <p class="access__hint">{t('bolo_access.remove_confirm', locale, { name: removing ? nameOf(removing) : '' })}</p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (removeOpen = false)}>{t('threads.cancel', locale)}</Button>
    <Button tone="warn" onclick={confirmRemove} loading={removeBusy}>{t('bolo_access.remove_ok', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={extendOpen}
  title={extending ? t('bolo_access.extend_title', locale, { name: nameOf(extending) }) : ''}
  size="s"
>
  <div class="access__fields">
    <Input label={t('bolo_access.extend_field', locale)} type="date" bind:value={eDay} required />
  </div>
  <p class="access__hint">{t('bolo_access.extend_hint', locale)}</p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (extendOpen = false)}>{t('threads.cancel', locale)}</Button>
    <Button variant="secondary" onclick={() => saveExtend(true)} loading={extendBusy}>{t('bolo_access.no_end_save', locale)}</Button>
    <Button onclick={() => saveExtend(false)} loading={extendBusy} disabled={!endOfDayInTz(eDay, tz)}
      >{t('threads.save', locale)}</Button
    >
  {/snippet}
</Dialog>

<style>
  @layer components {
    .access {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .access__list {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .access__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs) var(--space-s);
      font-size: var(--text-s);
    }
    .access__name {
      color: var(--text-color);
    }
    .access__term {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    .access__row--ended .access__name,
    .access__row--pending .access__name {
      color: var(--text-muted);
    }
    .access__propose {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs) var(--space-s);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .access__add {
      display: flex;
    }
    .access__fields {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .access__hint {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
      line-height: var(--text-line-height);
    }
  }
</style>
