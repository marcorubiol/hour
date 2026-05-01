<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  let authChecked = $state(false);

  onMount(() => {
    if (!localStorage.getItem('hour_jwt')) {
      goto('/login', { replaceState: true });
      return;
    }
    authChecked = true;
  });
</script>

{#if authChecked && children}
  {@render children()}
{/if}
