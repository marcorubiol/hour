<script lang="ts">
  /**
   * El monograma de con quién se habla (ADR-176): un cuadrado suave con las
   * iniciales de la organización (ADR-102) o de la persona; un grupo (el hilo
   * de un bolo) lleva trazo discontinuo y ningún fondo, porque no es alguien
   * sino quienes lo leen. Lo dibujan la fila de la lista de chats y la
   * cabecera del hilo: un solo sitio para este tratamiento. No es la identidad
   * de un proyecto, que es `IdentityMark`.
   *
   * Decorativo: el nombre ya está al lado, así que va oculto al lector.
   * Su tamaño es `--chat-mono` (tokens.css); quien lo aloja puede cambiarlo.
   */
  import { initials } from '$lib/monogram';

  interface Props {
    name: string | null | undefined;
    group?: boolean;
  }

  let { name, group = false }: Props = $props();
</script>

<span class="mono" class:mono--group={group} aria-hidden="true">{initials(name)}</span>

<style>
  @layer components {
    .mono {
      display: inline-grid;
      flex-shrink: 0;
      place-items: center;
      inline-size: var(--chat-mono);
      block-size: var(--chat-mono);
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius-m);
      background: var(--bg-light);
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .mono--group {
      border: var(--line-hairline) dashed var(--border-color-dark);
      background: transparent;
    }
  }
</style>
