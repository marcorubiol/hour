<script lang="ts">
  /**
   * El editor del correo diseñado de una invitación (tarea 99, ADR-192):
   * Templatical (`@templatical/editor`, FSL-1.1-MIT, embebido como permite su
   * licencia) en una capa a toda pantalla. Se carga al abrir, no con la
   * pantalla del envío: pesa unos 200 KB gzip, más el compilador de MJML.
   *
   * Lo que se le cierra: la paleta (DESIGN_BLOCKS, sin HTML, vídeo, redes ni
   * cuenta atrás), los ajustes del documento (ni ancho ni idioma ni texto de
   * previsualización: los pone Hour), las fuentes web (solo las del sistema)
   * y las imágenes (se suben a la ruta pública de Hour, ADR-172; el editor no
   * tiene biblioteca). Los campos son los de la carta, `{nombre}`…
   *
   * «Listo» compila aquí mismo: Templatical da MJML y `mjml-browser` lo pasa
   * a HTML. El Worker no puede (10 ms de CPU en el plan Free y medio mega
   * más de código); el servidor comprueba el JSON y limpia el HTML al guardar.
   */
  import { onDestroy, onMount } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import { uploadBlob } from '$lib/api';
  import { shrinkImage } from '$lib/image-shrink';
  import { DESIGN_BLOCKS, type DesignContent } from '$lib/mail-design';
  import Button from '$lib/components/Button.svelte';

  interface Props {
    /** El diseño de partida; null empieza uno nuevo con `starter`. */
    content: DesignContent | null;
    /** Si no hay diseño: los bloques con que empieza (la carta que ya había). */
    starter: { title: string | null; paragraphs: string[] };
    mailoutId: string;
    locale: Locale;
    fields: readonly string[];
    ondone: (design: { content: DesignContent; html: string }) => void;
    oncancel: () => void;
  }

  let { content, starter, mailoutId, locale, fields, ondone, oncancel }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let layer = $state<HTMLDialogElement | null>(null);
  let status = $state<'loading' | 'ready' | 'failed' | 'compiling'>('loading');
  /** Compiling failed: the editor stays open and «Listo» can be tried again. */
  let compileFailed = $state(false);
  // Raw: the instance lives outside Svelte, only the reference is tracked.
  let editor = $state.raw<{ getContent(): unknown; toMjml(): Promise<string>; unmount(): void } | null>(null);

  const EDITOR_LOCALES = ['es', 'ca', 'en', 'fr'];

  /**
   * The editor's chrome from Hour's tokens: custom properties cross the
   * shadow boundary, so a `var()` resolves against the page and follows its
   * theme and mode without a value written here.
   */
  const THEME = {
    bg: 'var(--bg)',
    bgElevated: 'var(--bg-ultra-light)',
    bgHover: 'var(--bg-hover)',
    bgActive: 'var(--bg-active)',
    border: 'var(--border-color-dark)',
    borderLight: 'var(--border-color-light)',
    text: 'var(--text-color)',
    textMuted: 'var(--text-muted)',
    textDim: 'var(--text-faint)',
    primary: 'var(--tone-primary-accent)',
    primaryHover: 'var(--tone-primary-fg)',
    primaryLight: 'var(--tone-primary-bg)',
    secondary: 'var(--tone-neutral-accent)',
    secondaryHover: 'var(--tone-neutral-fg)',
    secondaryLight: 'var(--tone-neutral-bg)',
    success: 'var(--tone-success-accent)',
    successLight: 'var(--tone-success-bg)',
    warning: 'var(--tone-warning-accent)',
    warningLight: 'var(--tone-warning-bg)',
    danger: 'var(--tone-danger-accent)',
    dangerLight: 'var(--tone-danger-bg)',
    canvasBg: 'var(--bg-light)',
  };

  /** Un archivo elegido o soltado → la ruta pública de Hour, como la imagen del espectáculo. */
  async function upload(file: File) {
    const blob = await shrinkImage(file, { maxWidth: 1200, maxHeight: 2400, type: 'image/jpeg', maxBytes: 600_000 });
    const r = await uploadBlob<{ image_url: string }>(`/api/mailout/${mailoutId}/image`, blob);
    if (!r) return null;
    const size = /-(\d+)x(\d+)\.[a-z]+$/i.exec(r.image_url);
    return {
      url: r.image_url,
      ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    };
  }

  function pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  onMount(() => {
    layer?.showModal();
    let gone = false;
    void (async () => {
      try {
        const [{ init }, types] = await Promise.all([import('@templatical/editor'), import('@templatical/types')]);
        if (gone || !host) return;
        const start =
          (content as unknown as Parameters<typeof init>[0]['content']) ??
          (() => {
            const c = types.createDefaultTemplateContent();
            c.blocks = [
              ...(starter.title ? [types.createTitleBlock({ content: starter.title, level: 1 })] : []),
              ...starter.paragraphs.map((p) => types.createParagraphBlock({ content: p })),
            ];
            return c;
          })();
        const instance = await init({
          container: host,
          content: start,
          locale: EDITOR_LOCALES.includes(locale) ? locale : 'en',
          branding: false,
          paletteBlocks: [...DESIGN_BLOCKS],
          sectionWrapper: false,
          templateSettings: { fields: ['backgroundColor', 'textColor', 'linkColor', 'fontFamily'] },
          fonts: { customFonts: [] },
          theme: THEME,
          uiTheme: document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light',
          // Relative Hour paths in the design; absolute only to paint the canvas.
          resolveImageUrl: (src: string) => (src.startsWith('/') ? `${location.origin}${src}` : null),
          onRequestMedia: async (ctx) => {
            const file = ctx?.files?.[0] ?? (await pickFile());
            return file ? upload(file) : null;
          },
          mergeTags: {
            syntax: { value: /\{([a-z_]+)\}/g, logic: /(?!)/g, opener: '{', closer: '}' },
            tags: fields.map((f) => ({ label: f.replace('_', ' '), value: `{${f}}` })),
          },
        });
        if (gone) instance.unmount();
        else {
          editor = instance as unknown as typeof editor;
          status = 'ready';
        }
      } catch (err) {
        console.error(err);
        if (!gone) status = 'failed';
      }
    })();
    return () => {
      gone = true;
    };
  });

  onDestroy(() => editor?.unmount());

  async function done() {
    if (!editor) return;
    status = 'compiling';
    compileFailed = false;
    try {
      const [mjml, { default: mjml2html }] = await Promise.all([editor.toMjml(), import('mjml-browser')]);
      // mjml 5 compiles asynchronously.
      const out = await mjml2html(mjml, { validationLevel: 'soft' });
      if (!out.html?.trim()) throw new Error('empty mjml output');
      ondone({ content: editor.getContent() as DesignContent, html: out.html });
    } catch (err) {
      console.error(err);
      compileFailed = true;
      status = 'ready';
    }
  }
</script>

<dialog
  bind:this={layer}
  class="mde"
  aria-label={t('mailout.design_title', locale)}
  data-testid="mail-design-editor"
  oncancel={(e) => {
    e.preventDefault();
    oncancel();
  }}
>
  <header class="mde__bar">
    <h2 class="eyebrow">{t('mailout.design_title', locale)}</h2>
    <p class="mde__hint">{t('mailout.design_hint', locale)}</p>
    <div class="mde__acts">
      <Button size="s" variant="quiet" onclick={oncancel}>{t('mailout.design_cancel', locale)}</Button>
      <Button size="s" disabled={status !== 'ready'} loading={status === 'compiling'} onclick={done}>
        {t('mailout.design_done', locale)}
      </Button>
    </div>
  </header>
  {#if status === 'loading'}
    <p class="mde__msg">{t('mailout.design_loading', locale)}</p>
  {:else if status === 'failed'}
    <p class="mde__msg" role="alert">{t('mailout.design_failed', locale)}</p>
  {:else if compileFailed}
    <p class="mde__msg" role="alert">{t('mailout.design_compile_failed', locale)}</p>
  {/if}
  <div class="mde__host" bind:this={host}></div>
</dialog>

<style>
  .mde {
    inline-size: 100vw;
    block-size: 100dvh;
    max-inline-size: none;
    max-block-size: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--bg);
    color: var(--text-color);
    display: flex;
    flex-direction: column;
  }
  .mde:not([open]) {
    display: none;
  }
  .mde::backdrop {
    background: var(--bg);
  }
  .mde__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs) var(--space-m);
    padding: var(--space-s) var(--space-m);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .mde__bar .eyebrow {
    margin: 0;
  }
  .mde__hint {
    margin: 0;
    flex: 1 1 20rem;
    color: var(--text-muted);
    font-size: var(--text-s);
  }
  .mde__acts {
    display: flex;
    gap: var(--space-xs);
  }
  .mde__msg {
    margin: 0;
    padding: var(--space-m);
    color: var(--text-muted);
  }
  .mde__host {
    flex: 1;
    min-block-size: 0;
  }
</style>
