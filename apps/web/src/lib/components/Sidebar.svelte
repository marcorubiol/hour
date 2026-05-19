<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  type Side = 'start' | 'end';

  interface Props {
    open?: boolean;
    /** Rail mode — desktop only. When true, the sidebar collapses to a
        narrow strip (default ~56px). The consumer decides what to render
        in this mode via its snippets; the component just supplies the
        layout slot and the modifier class. Resize is disabled while
        collapsed (the rail width is fixed). */
    collapsed?: boolean;
    side?: Side;
    closeOnBackdrop?: boolean;
    label?: string;
    /** When true, shows a thin drag handle on the inline-end edge that
        lets the user resize the sidebar with the mouse. Persists the
        chosen width to localStorage under `storageKey` (if provided). */
    resizable?: boolean;
    storageKey?: string;
    minWidth?: number;
    maxWidth?: number;
    /** Cursor distance from the rail edge below which the sidebar
        snap-collapses. Both thresholds are measured from the rail width
        so they share an axis and produce hysteresis (expand > collapse,
        with a dead zone in between to prevent flicker). */
    collapseThreshold?: number;
    /** Cursor distance from the rail edge above which the sidebar
        snap-expands from rail back to expanded. MUST be larger than
        collapseThreshold — otherwise the snap zones overlap and the
        drag oscillates in the gap. */
    expandThreshold?: number;
    /** Pixel width of the rail when collapsed. Must match the value of
        `--sidebar-collapsed-width` declared in base.css (default 3.5rem
        = 56px). Used by the drag logic to anchor both snap thresholds. */
    railWidthPx?: number;
    onclose?: () => void;
    onCollapse?: () => void;
    onExpand?: () => void;
    header?: Snippet;
    children?: Snippet<[{ close: () => void }]>;
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    collapsed = false,
    side = 'start',
    closeOnBackdrop = true,
    label = 'Navigation',
    resizable = false,
    storageKey,
    minWidth = 200,
    maxWidth = 480,
    collapseThreshold = 30,
    expandThreshold = 100,
    railWidthPx = 56,
    onclose,
    onCollapse,
    onExpand,
    header,
    children,
    footer,
  }: Props = $props();

  let sidebarEl: HTMLElement | undefined = $state();

  // Resize state — `customWidth` overrides --sidebar-width when set.
  let customWidth = $state<number | null>(null);
  let dragging = $state(false);

  onMount(() => {
    if (!resizable || !storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) {
          customWidth = n;
        }
      }
    } catch {
      // Storage disabled — fall back to default width.
    }
  });

  function clamp(n: number): number {
    return Math.max(minWidth, Math.min(maxWidth, n));
  }

  function startResize(event: MouseEvent) {
    if (!resizable || !sidebarEl) return;
    event.preventDefault();
    dragging = true;

    const cleanup = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    const persist = () => {
      if (storageKey && customWidth !== null) {
        try {
          localStorage.setItem(storageKey, String(customWidth));
        } catch {
          // ignore
        }
      }
    };

    // Width the cursor "wants" — distance from the cursor to the
    // sidebar's start edge. Lets the drag survive snap events: after
    // collapsing, the same drag can keep moving and pull the rail back
    // out without releasing the mouse.
    function targetFor(e: MouseEvent): number {
      const rect = sidebarEl!.getBoundingClientRect();
      return side === 'end' ? rect.right - e.clientX : e.clientX - rect.left;
    }

    // Both snap thresholds anchored to the same axis (rail edge) with
    // expandAt > collapseAt — guarantees a dead zone in the middle so
    // the drag never oscillates between rail and expanded while the
    // cursor sits in the gap.
    const collapseAt = railWidthPx + collapseThreshold;
    const expandAt = railWidthPx + expandThreshold;

    function onMove(e: MouseEvent) {
      if (!sidebarEl) return;
      const target = targetFor(e);

      if (collapsed) {
        if (target > expandAt) {
          customWidth = clamp(target);
          onExpand?.();
        }
        // Otherwise: rail unchanged.
        return;
      }

      // Expanded
      if (target < collapseAt) {
        onCollapse?.();
        return;
      }
      // Follow the cursor within [min, max].
      customWidth = clamp(target);
    }

    function onUp() {
      cleanup();
      persist();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function resetWidth() {
    customWidth = null;
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }

  // Drawer-semantic close — only acts on mobile, where the sidebar is a
  // dismissable overlay. On desktop the sidebar is static; navigation inside
  // it shouldn't hide it. To hide it on desktop, mutate `open` from outside.
  function close() {
    if (open && isMobile()) {
      open = false;
      onclose?.();
    }
  }

  function handleBackdropClick() {
    if (closeOnBackdrop) close();
  }

  function isMobile(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 47.999rem)').matches
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open && isMobile()) {
      event.preventDefault();
      close();
    }
  }

  // Body scroll lock — only when drawer is open on mobile.
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!open || !isMobile()) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });

  // Move focus into the drawer on mobile open so keyboard users land inside.
  $effect(() => {
    if (!open || !sidebarEl || !isMobile()) return;
    const focusable = sidebarEl.querySelector<HTMLElement>(
      'a, button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  });

  let classes = $derived(
    [
      'sidebar',
      `sidebar--${side}`,
      open && 'sidebar--open',
      collapsed && 'sidebar--collapsed',
      dragging && 'sidebar--dragging',
    ]
      .filter(Boolean)
      .join(' ')
  );

  // When collapsed, the rail width is fixed by CSS — ignore the custom
  // resize width so re-expanding restores the user's chosen size.
  let styleAttr = $derived(
    !collapsed && customWidth !== null
      ? `--sidebar-width: ${customWidth}px;`
      : undefined,
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<aside
  bind:this={sidebarEl}
  class={classes}
  aria-label={label}
  style={styleAttr}
>
  {#if header}<header class="sidebar__header">{@render header()}</header>{/if}
  {#if children}
    <div class="sidebar__body">{@render children({ close })}</div>
  {/if}
  {#if footer}<footer class="sidebar__footer">{@render footer()}</footer>{/if}
  {#if resizable}
    <button
      type="button"
      class="sidebar__resizer"
      aria-label={collapsed ? 'Drag to expand' : 'Drag to resize'}
      title={collapsed
        ? 'Drag right to expand'
        : 'Drag to resize · drag past minimum to collapse · double-click to reset'}
      onmousedown={startResize}
      ondblclick={resetWidth}
    ></button>
  {/if}
</aside>

<button
  type="button"
  class="sidebar__backdrop"
  aria-label="Close navigation"
  aria-hidden={!open}
  tabindex={open ? 0 : -1}
  data-open={open || undefined}
  onclick={handleBackdropClick}
></button>
