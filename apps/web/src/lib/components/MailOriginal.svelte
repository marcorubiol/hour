<!--
  @component
  El original de un correo, entero y tal como llegó (punto 111): se trae del
  buzón al abrirlo y no se guarda (ni en la base ni en el dispositivo). El
  HTML va en un iframe sandbox con su CSP (`$lib/mail-original`): sin
  scripts y sin imágenes de fuera; verlas es abrirlo aparte y pedirlo.
-->
<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import {
    attachmentSize,
    attachmentUrl,
    hasRemoteImages,
    mailDocument,
    originalUrl,
    type MailOriginal,
  } from '$lib/mail-original';

  interface Props {
    conversationId: string;
    eventId: string;
  }

  let { conversationId, eventId }: Props = $props();

  const locale = appLocale();

  const original = createQuery(
    toStore(() => ({
      queryKey: ['mail-original', conversationId, eventId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<MailOriginal>(originalUrl(conversationId, eventId), signal),
      // The whole mail stays in the tab's memory only: never on the device.
      meta: { persist: false },
      staleTime: Infinity,
      gcTime: 10 * 60 * 1000,
      // «Gone from the mailbox» or «mailbox revoked» are answers, not blips.
      retry: (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 1,
    })),
  );

  function failure(err: unknown): string {
    if (!(err instanceof ApiError)) return t('mail.original_err_failed', locale);
    if (err.status === 404) return t('mail.original_err_no_original', locale);
    switch (err.body?.error) {
      case 'original_gone':
        return t('mail.original_err_gone', locale);
      case 'mailbox_revoked':
      case 'mailbox_unavailable':
        return t('mail.original_err_mailbox', locale);
      case 'not_configured':
        return t('mail.original_err_not_configured', locale);
      default:
        return t('mail.original_err_failed', locale);
    }
  }

  let m = $derived($original.data);
  let srcdoc = $derived(m?.html ? mailDocument(m.html) : null);
  let remote = $derived(Boolean(m?.html && hasRemoteImages(m.html)));
  let attachments = $derived((m?.attachments ?? []).filter((a) => !a.inline || !m?.html));
  let inlineCount = $derived((m?.attachments.length ?? 0) - attachments.length);
</script>

<section class="original" aria-label={t('mail.original_title', locale)} data-testid="mail-original">
  {#if $original.isPending}
    <p class="original__note">{t('mail.original_loading', locale)}</p>
  {:else if $original.isError}
    <p class="original__note original__note--err" role="alert">{failure($original.error)}</p>
  {:else if m}
    <dl class="original__heads">
      {#if m.from}<dt>{t('mail.original_from', locale)}</dt><dd>{m.from}</dd>{/if}
      {#if m.to}<dt>{t('mail.original_to', locale)}</dt><dd>{m.to}</dd>{/if}
      {#if m.cc}<dt>{t('mail.original_cc', locale)}</dt><dd>{m.cc}</dd>{/if}
      {#if m.subject}<dt>{t('mail.original_subject', locale)}</dt><dd>{m.subject}</dd>{/if}
    </dl>

    {#if srcdoc}
      <iframe
        class="original__frame"
        title={t('mail.original_title', locale)}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        {srcdoc}
      ></iframe>
      {#if remote}
        <p class="original__note">
          {t('mail.original_images_blocked', locale)}
          <a
            class="fact-act"
            href={originalUrl(conversationId, eventId, '/view?images=1')}
            target="_blank"
            rel="noopener noreferrer">{t('mail.original_images_show', locale)}</a
          >
        </p>
      {/if}
    {:else if m.text}
      <p class="original__text">{m.text}</p>
    {:else}
      <p class="original__note">{t('thread.mail_empty', locale)}</p>
    {/if}

    {#if m.truncated}<p class="original__note">{t('mail.original_truncated', locale)}</p>{/if}

    {#if attachments.length}
      <ul class="original__files" aria-label={t('mail.original_attachments', locale)}>
        {#each attachments as a (a.part_id)}
          <li>
            <a class="fact-act" href={attachmentUrl(conversationId, eventId, a.part_id)} download={a.filename}
              >{a.filename}</a
            >
            <span>{attachmentSize(a.size, locale)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if inlineCount > 0}
      <p class="original__note">{t('mail.original_inline_images', locale, { n: inlineCount })}</p>
    {/if}
  {/if}
</section>

<style>
  .original {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-block-start: var(--space-xs);
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }
  .original p {
    margin: 0;
  }
  .original__note {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .original__note--err {
    color: var(--danger);
  }
  .original__heads {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2xs) var(--space-s);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .original__heads dt {
    color: var(--text-faint);
  }
  .original__heads dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .original__frame {
    inline-size: 100%;
    block-size: var(--thread-original-block);
    background: var(--thread-original-bg);
    border: var(--line-hairline) solid var(--border-color-light);
    border-radius: var(--radius-m);
    resize: vertical;
    overflow: auto;
  }
  .original__text {
    font-size: var(--text-s);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .original__files {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
  }
  .original__files li {
    display: flex;
    gap: var(--space-xs);
    align-items: baseline;
  }
  .original__files span {
    color: var(--text-faint);
  }
</style>
