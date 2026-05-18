<script lang="ts">
  /**
   * StateBadge — show lifecycle indicator.
   *
   * Maps the show.status enum to a visual tone. Border-only, lowercase mono.
   * Tone via data-tone (see base.css for the variable swap).
   *
   * Status → tone mapping (centralised here so consumers pass status, not tone):
   * - proposed       → neutral
   * - hold/1st/2nd   → info (blue)
   * - confirmed      → success (green)
   * - invoiced       → warning (amber)
   * - paid/done      → faint
   * - cancelled      → danger (red)
   */

  type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'faint';

  interface Props {
    label: string;
    tone?: Tone;
  }

  let { label, tone = 'neutral' }: Props = $props();
</script>

<span class="state-badge" data-tone={tone}>{label}</span>
