<script module lang="ts">
  export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

  export interface ToastItem {
    id: number;
    tone: ToastTone;
    title?: string;
    message: string;
    duration?: number;
  }

  let stack = $state<ToastItem[]>([]);
  let counter = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  export function addToast(item: Omit<ToastItem, 'id'> & { duration?: number }): number {
    const id = ++counter;
    const next: ToastItem = { duration: 4000, ...item, id };
    stack = [...stack, next];
    if (next.duration && next.duration > 0) {
      timers.set(
        id,
        setTimeout(() => removeToast(id), next.duration)
      );
    }
    return id;
  }

  export function removeToast(id: number): void {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    stack = stack.filter((t) => t.id !== id);
  }
</script>

<script lang="ts">
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();
</script>

<aside class="toast-region" aria-live="polite" aria-atomic="false">
  {#each stack as item (item.id)}
    <article class={`toast toast--${item.tone}`}>
      <div class="toast__body">
        {#if item.title}<h3 class="toast__title">{item.title}</h3>{/if}
        <p class="toast__message">{item.message}</p>
      </div>
      <button
        type="button"
        class="toast__dismiss"
        aria-label={t('ui.dismiss', locale)}
        onclick={() => removeToast(item.id)}
      >×</button>
    </article>
  {/each}
</aside>
