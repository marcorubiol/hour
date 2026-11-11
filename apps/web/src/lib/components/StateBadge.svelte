<script module lang="ts">
  import type { StatusTone } from '$lib/performance';

  /** The pill's classes, for a status that is a menu's trigger: it looks the
      same as the plain badge and its accessible name starts with the status. */
  export function stateBadgeClass(tone: StatusTone = 'neutral'): string {
    return `badge badge--xs badge--${tone}`;
  }
</script>

<script lang="ts">
  /**
   * StateBadge — the one status pill of the app (ADR-130 § 2): conversations,
   * bolos, functions, invoices, projects, lines. Conversations drew it first
   * (a soft fill in its tone, a border of the same hue, fills mixed in oklab
   * so it reads in dark); everything that had its own pill wears this one.
   *
   * Consumers pass a tone, never a colour: `statusTone()` for a conversation,
   * `performanceStatusTone()` for a bolo or a function, `invoiceTone()` for an
   * invoice. A status that opens a menu is the menu's trigger with the same
   * classes (`stateBadgeClass`), so it looks the same and its name starts
   * with the status.
   */
  interface Props {
    label: string;
    tone?: StatusTone;
  }

  let { label, tone = 'neutral' }: Props = $props();
</script>

<span class={stateBadgeClass(tone)}>{label}</span>
