<script lang="ts">
  import { accentVar } from '$lib/utils/accent';

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
    /** When set, fills the avatar with the workspace's hashed accent color
        (--accent-N). Overrides `tone`. */
    accentSlug?: string;
  }

  let {
    src,
    alt,
    name,
    size = 'm',
    tone = 'neutral',
    accentSlug,
  }: Props = $props();

  function deriveInitials(value?: string): string {
    if (!value) return '?';
    const parts = value.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  let initials = $derived(deriveInitials(name));
  let classes = $derived(
    accentSlug
      ? `avatar avatar--${size}`
      : `avatar avatar--${size} avatar--${tone}`,
  );
  let styleAttr = $derived(
    accentSlug
      ? `--avatar-bg: ${accentVar(accentSlug)}; --avatar-color: var(--bg);`
      : undefined,
  );
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
    style={styleAttr}
    {src}
    alt={label}
    onerror={() => (imageFailed = true)}
  />
{:else}
  <span class={classes} style={styleAttr} role="img" aria-label={label}>
    {initials}
  </span>
{/if}
