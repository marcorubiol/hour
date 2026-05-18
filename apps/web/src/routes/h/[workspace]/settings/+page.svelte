<script lang="ts">
  /**
   * Settings — user-level preferences. Phase 0.1 hosts only the Master
   * View toggle (D-PRE-05). The page lives at /h/[workspace]/settings/
   * so it inherits the workspace shell, but the state itself is
   * user-global (localStorage per browser). Phase 1 may promote storage
   * to `user_profile.metadata` for cross-device sync without changing the
   * helpers in $lib/master-view.
   */

  import { onMount } from 'svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  let enabled = $state(false);
  let savedPath = $state<string | null>(null);

  function refresh() {
    enabled = isMasterViewEnabled();
    savedPath = getMasterViewPath();
  }

  onMount(refresh);

  function handleToggle() {
    setMasterViewEnabled(enabled);
    refresh();
  }

  function handleClear() {
    clearMasterViewPath();
    refresh();
  }
</script>

<svelte:head>
  <title>Settings — Hour</title>
</svelte:head>

<article class="settings">
  <header class="settings__header">
    <p class="settings__eyebrow">Settings</p>
    <h1 class="settings__title">Preferences</h1>
  </header>

  <section class="settings__section" aria-labelledby="master-view-title">
    <header class="settings__section-header">
      <h2 class="settings__section-title" id="master-view-title">Master View</h2>
      <p class="settings__section-description">
        When enabled, Hour remembers the last Room you visited and opens
        there the next time you sign in.
      </p>
    </header>

    <Checkbox
      bind:checked={enabled}
      label="Remember my last visited Room"
      onchange={handleToggle}
    />

    <p class="settings__status">
      {#if !enabled}
        Not enabled.
      {:else if !savedPath}
        Will save the next page you visit inside a Room.
      {:else}
        Will open <code>{savedPath}</code> on next sign-in.
      {/if}
    </p>

    {#if enabled && savedPath}
      <div class="settings__actions">
        <button type="button" class="btn--outline btn--xs" onclick={handleClear}>
          Clear saved view
        </button>
      </div>
    {/if}
  </section>
</article>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    max-inline-size: 48rem;
  }

  .settings__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .settings__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-dark-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .settings__title {
    margin: 0;
    font-size: var(--text-xxl);
    font-weight: 500;
    line-height: 1.1;
  }

  .settings__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    padding: var(--space-l);
    border: 1px solid var(--neutral-light);
    border-radius: var(--radius);
  }

  .settings__section-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .settings__section-title {
    margin: 0;
    font-size: var(--text-l);
    font-weight: 500;
  }

  .settings__section-description {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-dark-muted);
  }

  .settings__status {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-dark-muted);
  }

  .settings__status code {
    background: var(--neutral-ultra-light);
    padding-block: 0.1em;
    padding-inline: var(--space-xs);
    border-radius: var(--radius-s);
    font-size: 0.9em;
  }

  .settings__actions {
    display: flex;
    gap: var(--space-xs);
  }
</style>
