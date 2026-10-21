<script lang="ts">
  /**
   * «Nueva tarea» from anywhere in the shell (⌘K): Hoy's `TaskComposer`, the
   * one quick-add for tasks (ADR-068), in the dialog frame. Nothing is
   * re-implemented here: the composer owns the POST and the caches; this
   * only closes on a create and says it with «Deshacer» (ADR-139 p7).
   *
   * Mounted once by the /h shell, opened through the creation store. The
   * parent comes from the pinned scope (`scopeTaskTarget`), as on Hoy.
   */
  import { useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import { toastCreated } from '$lib/created';
  import { appLocale, t } from '$lib/i18n';
  import type { TaskItem, TaskTarget } from '$lib/task';
  import Dialog from '../Dialog.svelte';
  import TaskComposer from '../TaskComposer.svelte';

  interface Props {
    open?: boolean;
    target: TaskTarget;
    /** Typed in ⌘K: the task's title. */
    title?: string;
  }
  let { open = $bindable(false), target, title = '' }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  function created(task: TaskItem) {
    open = false;
    toastCreated({
      locale,
      message: t('palette.task_added', locale, { title: task.title }),
      undo: async () => {
        await mutateJSON('DELETE', `/api/tasks/${task.id}`);
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      },
    });
  }
</script>

<Dialog bind:open title={t('palette.new_task', locale)} size="m">
  <!-- Mounted per opening, so each one starts from what ⌘K brings. -->
  {#if open}
    <TaskComposer {locale} {target} presetTitle={title} onCreated={created} />
  {/if}
</Dialog>
