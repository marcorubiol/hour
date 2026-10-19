/**
 * One submit, one caret (ADR-139 p7). A form that fails its native
 * constraints fires `invalid` on every bad field in document order, all in
 * the same task; the first Field to ask takes the focus and the rest only
 * show their message. The claim resets on the next microtask, so the next
 * submit starts clean.
 */
let claimed = false;

export function claimInvalidFocus(): boolean {
  if (claimed) return false;
  claimed = true;
  queueMicrotask(() => {
    claimed = false;
  });
  return true;
}
