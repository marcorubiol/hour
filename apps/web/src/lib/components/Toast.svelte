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

<aside class="toast-region" aria-live="polite" aria-atomic="false">
  {#each stack as t (t.id)}
    <article class={`toast toast--${t.tone}`}>
      <div class="toast__body">
        {#if t.title}<h3 class="toast__title">{t.title}</h3>{/if}
        <p class="toast__message">{t.message}</p>
      </div>
      <button
        type="button"
        class="toast__dismiss"
        aria-label="Dismiss"
        onclick={() => removeToast(t.id)}
      >×</button>
    </article>
  {/each}
</aside>
