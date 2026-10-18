<script lang="ts" module>
  /** The figures a mailout can show, in one vocabulary (`mailout.f_*`). */
  export type MailoutFigureKey =
    | 'queued'
    | 'sent'
    | 'delivered'
    | 'replies'
    | 'bounced'
    | 'complained'
    | 'unsubscribed'
    | 'failed'
    | 'excluded';

  export interface MailoutFigure {
    key: MailoutFigureKey;
    n: number;
    /** A figure that names someone leads to them (the list filtered). */
    href?: string | null;
    /** Something went wrong (bounces, spam, failures): drawn in the warning ink. */
    warn?: boolean;
  }
</script>

<script lang="ts">
  /**
   * The figures of a mailout, one treatment and one word per figure wherever
   * they appear: the «Último envío» block and the mailout screen (diseño M3).
   * A number in the display face and its word after it, in a line that wraps;
   * a figure with a link is underlined softly.
   */
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    figures: MailoutFigure[];
    locale: Locale;
    testid?: string;
  }

  let { figures, locale, testid }: Props = $props();
</script>

<ul class="mfigs" data-testid={testid}>
  {#each figures as f (f.key)}
    <li class:is-warn={f.warn && f.n > 0} data-figure={f.key}>
      {#if f.href}
        <a href={f.href}><b>{f.n}</b>{t(`mailout.f_${f.key}`, locale)}</a>
      {:else}
        <b>{f.n}</b>{t(`mailout.f_${f.key}`, locale)}
      {/if}
    </li>
  {/each}
</ul>

<style>
  @layer components {
    .mfigs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    b {
      margin-inline-end: 0.25em;
      color: var(--heading-color);
      font-family: var(--font-display);
      font-size: var(--stat-inline);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
    a {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    a:hover {
      color: var(--text-color);
      text-decoration-color: currentColor;
    }
    .is-warn b {
      color: var(--warning-dark);
    }
  }
</style>
