/**
 * Marks a scroll container with `data-can-scroll-up` / `data-can-scroll-down`
 * attributes whenever there's overflow content in the corresponding direction.
 * CSS can then reveal fade overlays at the edges to indicate scrollable content.
 *
 * Listens to `scroll` for position changes and uses ResizeObserver on the
 * container + its first child to react when the viewport or content size
 * changes (e.g. pane divider drag, async data load, window resize).
 */
export function scrollFade(node: HTMLElement) {
  let raf = 0;

  function read() {
    raf = 0;
    const { scrollTop, scrollHeight, clientHeight } = node;
    node.toggleAttribute('data-can-scroll-up', scrollTop > 1);
    node.toggleAttribute(
      'data-can-scroll-down',
      scrollTop + clientHeight < scrollHeight - 1,
    );
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(read);
  }

  schedule();
  node.addEventListener('scroll', schedule, { passive: true });

  const ro = new ResizeObserver(schedule);
  ro.observe(node);
  if (node.firstElementChild) ro.observe(node.firstElementChild);

  return {
    destroy() {
      node.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
