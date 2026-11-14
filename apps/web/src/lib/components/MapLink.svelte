<script lang="ts">
  /**
   * «Mapa»: a link to a place in the map app this device prefers (ADR-206).
   *
   * Always a real `<a href>`: before hydration, without JS, or where the
   * browser has no `<dialog>`, it is Apple Maps, as it was (ADR-146). With a
   * saved app, the href is that app's and the tap just follows it. With
   * none, the first tap opens the chooser instead (loaded on demand, so Hoy
   * does not carry it), and the chooser's own links open the map.
   *
   * A modified click (⌘, Ctrl, Shift, the middle button) is the browser's:
   * it opens the href it shows.
   */
  import { onMount, type Component, type Snippet } from 'svelte';
  import { mapsHref } from '$lib/ahora';
  import { mapsPref, restoreMapsApp } from '$lib/maps-app.svelte';

  interface Props {
    parts: readonly (string | null | undefined)[];
    /** Where the chooser says the choice changes (`MapsChooser`). */
    changeIn: 'settings' | 'here';
    class?: string;
    testid?: string;
    ariaLabel?: string;
    children: Snippet;
  }

  let { parts, changeIn, class: cls, testid, ariaLabel, children }: Props = $props();

  onMount(restoreMapsApp);

  let href = $derived(mapsHref(parts, mapsPref.app ?? 'apple'));

  type ChooserProps = { open?: boolean; parts: Props['parts']; changeIn: Props['changeIn']; current?: typeof mapsPref.app };
  let Chooser = $state<Component<ChooserProps, object, 'open'> | null>(null);
  let chooserOpen = $state(false);

  function loadChooser() {
    if (Chooser) return Promise.resolve();
    return import('./MapsChooser.svelte').then((m) => {
      Chooser = m.default;
    });
  }

  /** Open the chooser: the first tap, or «Cambiar» next to the button. */
  export async function choose(): Promise<void> {
    await loadChooser();
    chooserOpen = true;
  }

  function onclick(event: MouseEvent) {
    if (mapsPref.app) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof HTMLDialogElement !== 'function') return;
    event.preventDefault();
    void choose();
  }
</script>

{#if href}
  <a
    class={cls}
    {href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={ariaLabel}
    aria-haspopup={mapsPref.app ? undefined : 'dialog'}
    data-testid={testid}
    {onclick}
    onpointerenter={() => !mapsPref.app && void loadChooser()}
    onfocus={() => !mapsPref.app && void loadChooser()}>{@render children()}</a
  >
{/if}

{#if Chooser}
  <Chooser bind:open={chooserOpen} {parts} {changeIn} current={mapsPref.app} />
{/if}
