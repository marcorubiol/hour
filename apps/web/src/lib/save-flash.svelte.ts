/**
 * «guardado», for a moment (ADR-139 p7). A value edited in place writes on
 * its own; this is how it says so: the Field it lives in shows the word at
 * the row's end for two seconds, instead of a toast in a corner.
 *
 *   const saved = new SaveFlash();
 *   … onSuccess: () => saved.show('name')
 *   <Field id="name" saved={saved.is('name')}>
 */
export const SAVE_FLASH_MS = 2000;

export class SaveFlash {
  key = $state<string | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  show(key = '') {
    clearTimeout(this.#timer);
    this.key = key;
    this.#timer = setTimeout(() => {
      this.key = null;
    }, SAVE_FLASH_MS);
  }

  is(key = ''): boolean {
    return this.key === key;
  }
}
