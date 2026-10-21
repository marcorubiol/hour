/**
 * Crear en el día que se señala (ADR-139, «después»: crear en la celda del
 * Mes). La celda no abre nada con un clic suelto (MonthGrid, «THE CELL IS NOT
 * A DOOR ANY MORE»): un clic perdido no puede proponer un bolo. Lo que sí
 * dice «aquí, este día» son tres gestos deliberados, y los tres acaban en la
 * MISMA puerta que el «+» de la celda (`onDayCreate(iso)` → `openCreate(iso)`
 * de la página), así que no hay una segunda alta:
 *
 * - el ratón: doble clic en el hueco libre de la celda;
 * - el dedo: una pulsación larga en ese hueco (el «+» no se ve sin hover);
 * - el teclado: `N` con el foco dentro de un día abre el alta en ESE día, en
 *   cualquier dibujo que marque sus días con `data-day` (Mes, Temporada,
 *   Agenda, Tablero). Sin un día enfocado, `N` sigue proponiendo el de la
 *   vista (`defaultCreateDay`).
 *
 * «Hueco libre» es lo que no es de nadie: ni una ficha, ni un enlace, ni un
 * botón. Una ficha se abre; el hueco de al lado crea.
 */
import type { Attachment } from 'svelte/attachments';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day a focused control stands in (its nearest `[data-day]`), or null. */
export function focusedDay(el: Element | null | undefined): string | null {
  const day = el?.closest<HTMLElement>('[data-day]')?.dataset.day;
  return day && ISO_DAY.test(day) ? day : null;
}

/** Whatever answers a click of its own: a press there is never the cell's. */
const OWN_TARGET = 'a, button, input, select, textarea, label, summary, [role="button"], [tabindex], .slip';

/** The pointer landed on the cell's free space, not on something in it. */
export function isFreeSpace(target: EventTarget | null, cell: Element): boolean {
  if (!(target instanceof Element) || !cell.contains(target)) return false;
  const own = target.closest(OWN_TARGET);
  return !own || !cell.contains(own) || own === cell;
}

/** How long a finger stays put to mean «here» (the platform's own order). */
export const LONG_PRESS_MS = 500;
/** How far it may drift before it is a scroll, not a press (CSS px). */
export const LONG_PRESS_SLOP = 10;

/** How long after the lift its click may still arrive. */
const LIFT_CLICK_MS = 400;

/**
 * THE LIFT IS NOT A CLICK. What a press opens is already on screen while the
 * finger is down (a dialog, over the cell), and the lift that ends the press
 * arrives as a click on whatever is under it now: a modal's backdrop, which
 * closes it. Seen in the browser on 2026-10-21: the dialog opened at 500 ms
 * and shut on the lift. So after a press fires, the one click its lift makes
 * is eaten before anything hears it.
 */
function swallowLiftClick(): void {
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  let grace: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    clearTimeout(grace);
    window.removeEventListener('click', eat, true);
  };
  const end = (e: Event) => {
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
    if (e.type !== 'pointerup') return;
    window.addEventListener('click', eat, true);
    grace = setTimeout(done, LIFT_CLICK_MS);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
}

/**
 * A long press with a finger or a pen on the element's free space calls
 * `onPress`. A mouse never does (it has the double click and the «+»). It
 * dies on lift, on cancel and on a drift past `LONG_PRESS_SLOP`, so a scroll
 * through the month never creates; once it fires, the context menu that the
 * same press would open and the click its lift makes are swallowed.
 */
export function longPress(onPress: () => void): Attachment<HTMLElement> {
  return (el) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fired = false;
    let x = 0;
    let y = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const down = (e: PointerEvent) => {
      fired = false;
      if (e.pointerType === 'mouse' || !e.isPrimary || !isFreeSpace(e.target, el)) return;
      x = e.clientX;
      y = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        fired = true;
        swallowLiftClick();
        onPress();
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (timer && Math.hypot(e.clientX - x, e.clientY - y) > LONG_PRESS_SLOP) cancel();
    };
    const menu = (e: Event) => {
      if (fired || timer) e.preventDefault();
      cancel();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('contextmenu', menu);
    return () => {
      cancel();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', cancel);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('pointerleave', cancel);
      el.removeEventListener('contextmenu', menu);
    };
  };
}
