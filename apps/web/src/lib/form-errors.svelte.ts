/**
 * A form's own words for what is wrong, each under its field (ADR-139 p7):
 * the checks a native constraint cannot say (a blank name, an amount that
 * is not positive, a range that runs backwards). Never a toast.
 *
 * Keys are the fields' ids, so one listener on the form drops the word the
 * moment that field changes, and the caret can go to the first one:
 *
 *   const errors = new FormErrors();
 *   if (!amount) errors.set('exp-amount', t('books.amount_positive', locale));
 *   if (errors.any) return errors.focusFirst();
 *   <form oninput={errors.onedit} onchange={errors.onedit}>
 *     <Input id="exp-amount" error={errors.of('exp-amount')} />
 */
import { tick } from 'svelte';

export class FormErrors {
  map = $state<Record<string, string>>({});

  get any(): boolean {
    return Object.keys(this.map).length > 0;
  }

  of(id: string): string | undefined {
    return this.map[id];
  }

  set(id: string, message: string) {
    this.map = { ...this.map, [id]: message };
  }

  clear() {
    this.map = {};
  }

  /** Bound to the form: a field that changes loses its word. */
  onedit = (event: Event) => {
    const id = (event.target as { id?: string } | null)?.id;
    if (id && id in this.map) {
      const { [id]: _gone, ...rest } = this.map;
      this.map = rest;
    }
  };

  async focusFirst() {
    await tick();
    const first = Object.keys(this.map)[0];
    if (first) document.getElementById(first)?.focus();
  }
}
