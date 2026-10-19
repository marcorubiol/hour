<script lang="ts">
  /**
   * CalmLine: what calm hides, said in one line that opens it (ADR-139 § 5).
   * Calm never denies: a block it folds leaves this line in its place, in the
   * quiet voice of an empty block (base.css `.empty-line`), so a screen reader
   * hears what is not drawn and a finger has a way to it.
   *
   * Two doors. With `expanded`, the line opens what it names right here
   * (the overdue, «5 vencidas · ver»); without it, the door leaves calm
   * («… esperan fuera de calma →»).
   */
  interface Props {
    /** The one figure of the line that asks for attention, in danger. */
    lead?: string | null;
    text?: string | null;
    action: string;
    onclick: () => void;
    /** Opens in place: the state of what it opens. */
    expanded?: boolean;
    controls?: string;
  }

  let { lead = null, text = null, action, onclick, expanded, controls }: Props = $props();
</script>

<p class="empty-line calm-line">
  {#if lead}<span class="calm-line__lead">{lead}</span>{/if}{#if text}<span class="empty-line__text">{text}</span>{/if}<button
    type="button"
    class="empty-line__act"
    aria-expanded={expanded}
    aria-controls={controls}
    {onclick}
    >{action}{#if expanded === undefined}&nbsp;<span aria-hidden="true">→</span>{/if}</button
  >
</p>

<style>
  /* A line under a block, or under another such line: a step of air, as a row. */
  .calm-line {
    margin-block-start: var(--space-xs);
  }
  .calm-line__lead {
    color: var(--danger);
  }
</style>
