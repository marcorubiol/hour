<script lang="ts">
  /**
   * La firma de correo en un espacio (ADR-099, añadido: la firma es de la
   * persona en cada compañía, no del buzón).
   *
   * `personal`: «Tu firma en <compañía>», en Perfil. La edita cada uno.
   * `workspace`: la de la compañía, con su web y su teléfono, en Espacios. La
   * edita un admin; los demás la ven. Con ella firma el buzón común.
   *
   * Hour siempre propone una con lo que exista; guardada vacía o igual que la
   * propuesta es la propuesta (null), que sigue al día si cambian los datos.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { spaceName } from '$lib/utils/identity';
  import Button from '$lib/components/Button.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { proposedSignature, type MailAccountScope, type SignatureSettings } from '$lib/mail';

  interface Props {
    scope: MailAccountScope;
    workspaceId: string | undefined;
  }
  let { scope, workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey: ['mail-signature', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<SignatureSettings>(`/api/mail/signature?workspace_id=${workspaceId}`, signal),
    })),
  );

  let parts = $derived($query.data?.parts ?? null);
  let canEdit = $derived(scope === 'personal' ? Boolean(parts) : ($query.data?.can_edit_company ?? false));
  let stored = $derived((scope === 'personal' ? parts?.signature : parts?.company_signature) ?? null);
  let proposal = $derived(parts ? proposedSignature(parts, scope) : '');
  let company = $derived(spaceName(parts?.company_name));

  /** Lo que se escribe; null mientras no se toca. */
  let draft = $state<string | null>(null);
  let shown = $derived(draft ?? stored ?? proposal);
  let dirty = $derived(draft !== null && draft.trim() !== (stored ?? proposal).trim());

  type Body = { scope: MailAccountScope; signature?: string | null; website?: string | null; phone?: string | null };

  const save = createMutation({
    mutationFn: (body: Body) =>
      mutateJSON('PUT', '/api/mail/signature', { workspace_id: workspaceId, ...body }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('edit.not_saved', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail-signature'] });
      void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] });
    },
  });

  function saveSignature(value: string | null) {
    // Igual que la propuesta es la propuesta: así sigue al día.
    const next = value === null || value.trim() === proposal.trim() ? null : value.trim();
    $save.mutate(
      { scope, signature: next },
      {
        onSuccess: () => {
          draft = null;
          addToast({ tone: 'success', message: t('mail.signature_saved', locale) });
        },
      },
    );
  }

  /** Web y teléfono de la compañía: se guardan al salir del campo. */
  function saveContact(field: 'website' | 'phone', value: string) {
    const prev = (field === 'website' ? parts?.company_website : parts?.company_phone) ?? '';
    if (value.trim() === prev.trim()) return;
    const next = value.trim() || null;
    $save.mutate(field === 'website' ? { scope: 'workspace', website: next } : { scope: 'workspace', phone: next });
  }
</script>

{#if workspaceId && parts}
  <section class="set-group">
    <div class="set-group__head">
      <span class="eyebrow set-group__kicker">{t('mail.signature', locale)}</span>
      <h2 class="set-group__title">
        {scope === 'personal'
          ? t('mail.signature_personal_title', locale, { company })
          : t('mail.signature_company_title', locale, { company })}
      </h2>
    </div>
    <div class="set-group__body">
      {#if scope === 'workspace'}
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{t('mail.company_website', locale)}</div>
            <div class="set-row__hint">{t('mail.company_contact_hint', locale)}</div>
          </div>
          <div class="set-row__ctrl">
            <input
              type="url"
              inputmode="url"
              maxlength="2048"
              placeholder="https://"
              value={parts.company_website ?? ''}
              disabled={!canEdit || $save.isPending}
              onblur={(e) => saveContact('website', e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{t('mail.company_phone', locale)}</div>
          </div>
          <div class="set-row__ctrl">
            <input
              type="tel"
              maxlength="64"
              value={parts.company_phone ?? ''}
              disabled={!canEdit || $save.isPending}
              onblur={(e) => saveContact('phone', e.currentTarget.value)}
            />
          </div>
        </div>
      {/if}

      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">{t('mail.signature', locale)}</div>
          <div class="set-row__hint">
            {scope === 'personal' ? t('mail.signature_personal_hint', locale) : t('mail.signature_company_hint', locale)}
          </div>
        </div>
        <div class="set-row__ctrl">
          {#if canEdit}
            <form
              class="sig"
              onsubmit={(ev) => {
                ev.preventDefault();
                saveSignature(shown);
              }}
            >
              <textarea
                aria-label={t('mail.signature', locale)}
                rows="4"
                maxlength="2000"
                value={shown}
                oninput={(ev) => (draft = ev.currentTarget.value)}
              ></textarea>
              <div class="sig__row">
                <span class="sig__state">
                  {stored === null && !dirty ? t('mail.signature_is_proposal', locale) : t('mail.signature_is_own', locale)}
                </span>
                <span class="sig__actions">
                  {#if stored !== null || dirty}
                    <Button
                      size="s"
                      variant="secondary"
                      disabled={$save.isPending}
                      onclick={() => (stored === null ? (draft = null) : saveSignature(null))}
                    >
                      {t('mail.signature_back_to_proposal', locale)}
                    </Button>
                  {/if}
                  <Button size="s" variant="secondary" type="submit" disabled={!dirty || $save.isPending}>
                    {t('mail.signature_save', locale)}
                  </Button>
                </span>
              </div>
            </form>
          {:else}
            <p class="sig__ro">{shown}</p>
          {/if}
        </div>
      </div>
    </div>
  </section>
{/if}

<style>
  @layer components {
    .sig {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      inline-size: 100%;
    }
    .sig textarea {
      inline-size: 100%;
      padding: var(--space-xs) var(--space-s);
      color: var(--text-color);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font: inherit;
      font-size: var(--text-s);
      line-height: 1.5;
      resize: vertical;
    }
    .sig__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-xs);
    }
    .sig__state {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .sig__actions {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .sig__ro {
      margin: 0;
      font-size: var(--text-s);
      line-height: 1.5;
      white-space: pre-line;
    }
  }
</style>
