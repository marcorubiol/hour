<script lang="ts">
  type Size = 'xs' | 's' | 'm' | 'l';
  type Tone =
    | 'neutral'
    | 'primary'
    | 'info'
    | 'success'
    | 'warning'
    | 'danger';

  interface Props {
    src?: string;
    alt?: string;
    name?: string;
    size?: Size;
    tone?: Tone;
  }

  let {
    src,
    alt,
    name,
    size = 'm',
    tone = 'neutral',
  }: Props = $props();

  function deriveInitials(value?: string): string {
    if (!value) return '?';
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  let initials = $derived(deriveInitials(name));
  let classes = $derived(`avatar avatar--${size} avatar--${tone}`);
  let label = $derived(alt ?? name ?? 'avatar');

  let imageFailed = $state(false);

  // Reset failure flag when src changes (allows retry on new url)
  $effect(() => {
    src;
    imageFailed = false;
  });
</script>

{#if src && !imageFailed}
  <img
    class={classes}
    {src}
    alt={label}
    onerror={() => (imageFailed = true)}
  />
{:else}
  <span class={classes} role="img" aria-label={label}>{initials}</span>
{/if}
