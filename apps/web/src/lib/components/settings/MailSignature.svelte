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
   *
   * Un solo modelo, en sitio (ADR-139 p7): la web, el teléfono y la firma se
   * guardan al salir del campo y lo dicen con «guardado» en su fila. Antes la
   * firma pedía su propio botón y las otras dos no: dos maneras en un bloque.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { spaceName } from '$lib/utils/identity';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { SaveFlash } from '$lib/save-flash.svelte';
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

  const saved = new SaveFlash();

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
          saved.show('signature');
        },
      },
    );
  }

  /** Al salir del campo, si cambió algo: nunca una escritura por un foco. */
  function commitSignature(ev: FocusEvent) {
    // Leaving the field FOR «volver a la propuesta» is not a save of the draft.
    if ((ev.relatedTarget as HTMLElement | null)?.closest?.('.sig__actions')) return;
    if (dirty && draft !== null) saveSignature(draft);
  }

  /** Web y teléfono de la compañía: se guardan al salir del campo. */
  function saveContact(field: 'website' | 'phone', value: string) {
    const prev = (field === 'website' ? parts?.company_website : parts?.company_phone) ?? '';
    if (value.trim() === prev.trim()) return;
    const next = value.trim() || null;
    $save.mutate(field === 'website' ? { scope: 'workspace', website: next } : { scope: 'workspace', phone: next }, {
      onSuccess: () => saved.show(field),
    });
  }
</script>

{#if workspaceId && parts}
  <section class="set-group">
    <BlockHead
      title={t('mail.signature', locale)}
      count={scope === 'personal'
        ? t('mail.signature_personal_title', locale, { company })
        : t('mail.signature_company_title', locale, { company })}
    />
    <div class="set-group__body">
      {#if scope === 'workspace'}
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{t('mail.company_website', locale)}</div>
            <div class="set-row__hint">{t('mail.company_contact_hint', locale)}</div>
          </div>
          <div class="set-row__ctrl">
            <Field id="sig-website" saved={saved.is('website')}>
              <input
                id="sig-website"
                type="url"
                inputmode="url"
                maxlength="2048"
                placeholder="https://"
                value={parts.company_website ?? ''}
                disabled={!canEdit || $save.isPending}
                onblur={(e) => saveContact('website', e.currentTarget.value)}
              />
            </Field>
          </div>
        </div>
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{t('mail.company_phone', locale)}</div>
          </div>
          <div class="set-row__ctrl">
            <Field id="sig-phone" saved={saved.is('phone')}>
              <input
                id="sig-phone"
                type="tel"
                maxlength="64"
                value={parts.company_phone ?? ''}
                disabled={!canEdit || $save.isPending}
                onblur={(e) => saveContact('phone', e.currentTarget.value)}
              />
            </Field>
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
            <div class="sig">
              <Field id="sig-text" stack saved={saved.is('signature')}>
                <textarea
                  id="sig-text"
                  aria-label={t('mail.signature', locale)}
                  rows="4"
                  maxlength="2000"
                  value={shown}
                  oninput={(ev) => (draft = ev.currentTarget.value)}
                  onblur={commitSignature}
                ></textarea>
              </Field>
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
                      onclick={() => {
                        draft = null;
                        if (stored !== null) saveSignature(null);
                      }}
                    >
                      {t('mail.signature_back_to_proposal', locale)}
                    </Button>
                  {/if}
                </span>
              </div>
            </div>
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
