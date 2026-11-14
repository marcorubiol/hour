<script lang="ts">
  import { accentVar } from '$lib/utils/accent';
  import { appLocale, t } from '$lib/i18n';

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
    /** A dot on the avatar's lower edge, in --success: «someone else is
        here» (ADR-204). Colour only, so whoever sets it says the same in
        words for a screen reader (the account trigger does, in its name). */
    signal?: boolean;
  }

  let {
    src,
    alt,
    name,
    size = 'm',
    tone = 'neutral',
    accentSlug,
    signal = false,
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
  let label = $derived(alt ?? name ?? t('ui.avatar', appLocale()));

  let imageFailed = $state(false);

  // Reset failure flag when src changes (allows retry on new url)
  $effect(() => {
    src;
    imageFailed = false;
  });
</script>

{#snippet face()}
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
{/snippet}

{#if signal}
  <span class="avatar-signal">
    {@render face()}
    <span class="avatar-signal__dot" aria-hidden="true"></span>
  </span>
{:else}
  {@render face()}
{/if}
