<script module lang="ts">
  /** One next step in the margin, page-shaped: the page picks and words it. */
  export type StepVM = {
    id: string;
    /** «volver a escribir», «responder», «tarea»: what is asked, in the Desk's words. */
    verb: string;
    subject: string;
    /** «vencido» when its day has passed; nothing otherwise (the day is the row's). */
    late: string | null;
    href: string | null;
    project: { name: string; slug: string | null; initials?: string | null; accent?: string | null } | null;
  };
</script>

<script lang="ts">
  /**
   * THE MARGIN'S NEXT STEPS (ADR-138 § 6). The Planner owns what is done:
   * bolos and their performances. A conversation's next step and a task are
   * not events of the grid, so they never take a slot in it; they are
   * annotations of the day, here, each a way back to where it is resolved.
   * The rows are «Te espera» bounded to the day (`rankWaiting` with a window);
   * this only draws them, in the margin's voice.
   */
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    steps: StepVM[];
    /** Accessible name of the list («pasos»). */
    label: string;
  }

  let { steps, label }: Props = $props();
</script>

<ul class="steps" aria-label={label} data-testid="planner-steps">
  {#each steps as s (s.id)}
    <li class="steps__l">
      <svelte:element this={s.href ? 'a' : 'span'} class="steps__a" {...s.href ? { href: s.href } : {}}>
        <span class="steps__meta">
          {#if s.project}<IdentityMark
              mini
              accent={accentVarFor(s.project)}
              name={s.project.name}
              initials={s.project.initials}
            />{/if}
          <span>{s.verb}</span>
          {#if s.late}<span class="steps__late">{s.late}</span>{/if}
        </span>
        <span class="steps__s">{s.subject}</span>
      </svelte:element>
    </li>
  {/each}
</ul>

<style>
  @layer components {
    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    /* What follows in the margin (a call, a post-it) keeps its distance. */
    .steps:not(:last-child) {
      margin-block-end: var(--space-s);
    }
    .steps__l + .steps__l {
      border-block-start: var(--border-size) dotted var(--border-color-light);
    }
    .steps__a {
      display: block;
      padding-block: var(--space-2xs);
      color: inherit;
      text-decoration: none;
      min-inline-size: 0;
    }
    .steps__meta {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .steps__late {
      color: var(--danger);
    }
    .steps__s {
      display: block;
      font-size: var(--text-s);
      color: var(--text-color);
      overflow-wrap: anywhere;
      text-wrap: pretty;
    }
    a.steps__a:hover .steps__s {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }
</style>
