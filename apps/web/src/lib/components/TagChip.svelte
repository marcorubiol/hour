<script lang="ts">
  /**
   * TagChip — small pastel task-type tag (#travel, #press, ...).
   *
   * Tone via data-tone attribute (consumed by CSS variable swap in base.css).
   * Default tone is neutral. Label is rendered verbatim — caller decides
   * whether to prefix `#`.
   */

  type Tone =
    | 'amber'
    | 'blue'
    | 'teal'
    | 'green'
    | 'purple'
    | 'red'
    | 'neutral';

  interface Props {
    label: string;
    tone?: Tone;
  }

  let { label, tone = 'neutral' }: Props = $props();
</script>

<span class="tag-chip" data-tone={tone}>{label}</span>
