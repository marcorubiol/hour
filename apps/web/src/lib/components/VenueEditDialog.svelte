<script module lang="ts">
  import type { VenueContact } from '$lib/venue';

  /** What the editor reads and writes: `VENUE_COLS` of a venue row. */
  export interface VenueEditable {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
    contacts: VenueContact[] | null;
    notes: string | null;
    /** 92: who programs it. Absent in an older cached row: then unknown. */
    organization_id?: string | null;
  }
</script>

<script lang="ts">
  /**
   * The one editor of a venue (ADR-053): name, city, country, capacity,
   * address, timezone (it feeds the road sheet's dual time), its contacts and
   * notes. PATCH /api/venues/:id. Two callers draw it: the performance's
   * «Editar sala…» (stacked on its details dialog) and the venue's own
   * record (ADR-164 § 1).
   *
   * «La programa» (92, ADR-170): the organization of the same space that
   * programs the room. Sent only when it changes, so a venue whose
   * organization was deleted later still saves its other fields.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { FormErrors } from '$lib/form-errors.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { organizationsQueryOptions } from '$lib/organizations';

  interface Props {
    open: boolean;
    /** The venue as it is now; the form fills from it each time it opens. */
    venue: VenueEditable | null;
    /** The venue's space: its organizations are the ones offered. */
    workspaceId: string;
    onsaved?: (venue: VenueEditable) => void;
  }

  let { open = $bindable(false), venue, workspaceId, onsaved }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const formErrors = new FormErrors();

  type ContactDraft = { name: string; role: string; email: string; phone: string };

  let vName = $state('');
  let vCity = $state('');
  let vCountry = $state('');
  let vAddress = $state('');
  let vCapacity = $state('');
  let vTimezone = $state('');
  let vNotes = $state('');
  let vContacts = $state<ContactDraft[]>([]);
  let vOrganization = $state('');

  const orgsQuery = createQuery(toStore(() => ({ ...organizationsQueryOptions(), enabled: open })));
  let orgOptions = $derived(
    ($orgsQuery.data?.items ?? [])
      .filter((o) => o.workspace_id === workspaceId)
      .map((o) => ({ value: o.id, label: o.name })),
  );

  // The native medium already knows every IANA zone: no bundled list.
  const timezoneOptions = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  // Fill from the venue on every opening, never while it is open (a refetch
  // under the dialog must not overwrite what is being typed).
  let filled = false;
  $effect(() => {
    if (!open) {
      filled = false;
      return;
    }
    if (filled || !venue) return;
    filled = true;
    formErrors.clear();
    vName = venue.name;
    vCity = venue.city ?? '';
    vCountry = venue.country ?? '';
    vAddress = venue.address ?? '';
    vCapacity = venue.capacity != null ? String(venue.capacity) : '';
    vTimezone = venue.timezone ?? '';
    vNotes = venue.notes ?? '';
    vOrganization = venue.organization_id ?? '';
    vContacts = (venue.contacts ?? []).map((c) => ({
      name: c.name ?? '',
      role: c.role ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    }));
  });

  function addContactRow() {
    vContacts = [...vContacts, { name: '', role: '', email: '', phone: '' }];
  }

  function removeContactRow(index: number) {
    vContacts = vContacts.filter((_, i) => i !== index);
  }

  const venuePatch = createMutation({
    mutationFn: () =>
      mutateJSON<{ venue: VenueEditable }>('PATCH', `/api/venues/${venue!.id}`, {
        name: vName.trim(),
        city: vCity.trim() || null,
        country: vCountry.trim() || null,
        address: vAddress.trim() || null,
        capacity: vCapacity.trim() ? Number(vCapacity) : null,
        timezone: vTimezone.trim() || null,
        notes: vNotes.trim() || null,
        contacts: vContacts
          .filter((c) => c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            role: c.role.trim() || null,
            email: c.email.trim() || null,
            phone: c.phone.trim() || null,
          })),
        ...(vOrganization !== (venue!.organization_id ?? '') ? { organization_id: vOrganization || null } : {}),
      }),
    onSuccess: (result) => {
      open = false;
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
      void queryClient.invalidateQueries({ queryKey: ['venue'] });
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
      // The organization's record lists its rooms.
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
      addToast({
        tone: 'success',
        message: t('venue.updated', locale, { name: result?.venue.name ?? vName }),
      });
      if (result?.venue) onsaved?.(result.venue);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('venue.not_saved', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function save() {
    formErrors.clear();
    if (!vName.trim()) {
      formErrors.set('v-name', t('venue.needs_name', locale));
      return void formErrors.focusFirst();
    }
    $venuePatch.mutate();
  }
</script>

<Dialog bind:open title={t('venue.edit_title', locale)} size="m">
  <p class="venue-edit__hint">{t('venue.edit_hint', locale)}</p>
  <div class="venue-edit__grid" oninput={formErrors.onedit}>
    <Input id="v-name" label={t('venue.name', locale)} bind:value={vName} required error={formErrors.of('v-name')} />
    <Input label={t('create.city', locale)} bind:value={vCity} />
    <Input label={t('perf.country', locale)} bind:value={vCountry} placeholder="ES" />
    <Input label={t('venue.capacity', locale)} type="number" bind:value={vCapacity} />
    <Select
      label={t('venue.programmed_by', locale)}
      bind:value={vOrganization}
      options={[{ value: '', label: t('venue.programmed_by_none', locale) }, ...orgOptions]}
    />
  </div>
  <div class="venue-edit__grid">
    <Input label={t('venue.address', locale)} bind:value={vAddress} placeholder={t('venue.address_placeholder', locale)} />
    <Input id="v-timezone" label={t('venue.timezone', locale)} list="v-timezone-list" bind:value={vTimezone} placeholder="Europe/Madrid" />
    <datalist id="v-timezone-list">
      {#each timezoneOptions as tz (tz)}
        <option value={tz}></option>
      {/each}
    </datalist>
  </div>
  <div class="venue-edit__contacts">
    <p class="eyebrow">{t('venue.contacts', locale)}</p>
    {#each vContacts as _, i (i)}
      <div class="venue-edit__contact-row">
        <Input label={i === 0 ? t('venue.name', locale) : undefined} bind:value={vContacts[i].name} placeholder={t('venue.name', locale)} />
        <Input
          label={i === 0 ? t('venue.contact_role', locale) : undefined}
          bind:value={vContacts[i].role}
          placeholder={t('venue.contact_role_placeholder', locale)}
        />
        <Input
          label={i === 0 ? t('settings.email', locale) : undefined}
          type="email"
          bind:value={vContacts[i].email}
          placeholder={t('settings.email', locale)}
        />
        <Input label={i === 0 ? t('venue.phone', locale) : undefined} type="tel" bind:value={vContacts[i].phone} placeholder={t('venue.phone', locale)} />
        <button type="button" class="venue-edit__contact-remove" aria-label={t('venue.remove_contact', locale)} onclick={() => removeContactRow(i)}
          >×</button
        >
      </div>
    {/each}
    <Button variant="secondary" size="xs" onclick={addContactRow}>{t('venue.add_contact', locale)}</Button>
  </div>
  <div class="venue-edit__notes">
    <Textarea id="v-notes" label={t('perf.notes', locale)} rows={3} bind:value={vNotes} />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={save} loading={$venuePatch.isPending}>{t('venue.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .venue-edit__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .venue-edit__grid {
      display: flex;
      flex-direction: column;
      margin-block-start: var(--space-s);
    }

    .venue-edit__contacts {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-m);
    }

    .venue-edit__contact-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr auto;
      gap: var(--space-xs);
      align-items: end;
      --field-label-width: 100%;
    }

    .venue-edit__contact-remove {
      inline-size: 2rem;
      block-size: 2rem;
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-s);
      background: none;
      color: var(--text-faint);
      cursor: pointer;
    }
    .venue-edit__contact-remove:hover {
      color: var(--danger);
      border-color: var(--danger);
    }

    .venue-edit__notes {
      margin-block-start: var(--space-m);
    }
  }
</style>
